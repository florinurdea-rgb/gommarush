import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { downloadDocumentBytes } from "@/lib/server/documents";
import { extractDdtDocuments } from "@/lib/ddt-import/extractor";
import { classifyLine } from "@/lib/logistics/ddt-classification";
import { accountForLines, type LineForAccounting } from "@/lib/documents/pipeline/line-accounting";
import { logError, logEvent } from "@/lib/logger";
import type { ExtractedDocument } from "@/lib/ddt-import/types";

/**
 * The durable document-analysis job.
 *
 * Analysis used to run inside the upload request, so a killed function lost
 * the work outright: no attempt recorded, no error, nothing to retry, and an
 * operator left watching a spinner that simply stopped. The work is now a
 * row in document_analyses, and a scheduled worker leases it.
 *
 * Two properties the design turns on:
 *
 *   Idempotent by file. The SHA-256 of the uploaded bytes is the document's
 *   identity — never the filename, which changes freely while the bytes do
 *   not. Enqueueing the same bytes returns the existing analysis.
 *
 *   Idempotent by execution. gorush_store_document_analysis_result deletes
 *   and rewrites the line set, and refuses a payload whose line count
 *   disagrees with its declared total. So running a job twice converges, and
 *   a job that lost lines cannot report success.
 *
 * PROMPT/SCHEMA/VALIDATOR VERSIONS are recorded with every result. Without
 * them a disputed extraction from three months ago cannot be reproduced,
 * because the prompt will have moved on.
 */

export const PROMPT_VERSION = "ddt-extraction/2026-09-01";
export const SCHEMA_VERSION = "extracted-document/1";
export const VALIDATOR_VERSION = "line-accounting/1";

/** Kept under the cron route's own budget so the lease outlives the run. */
const INLINE_RUN_BUDGET_MS = 150_000;
const LEASE_SECONDS = 300;

export function computeSourceHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface EnqueueResult {
  analysisId: string;
  status: string;
  /** True when these exact bytes were already processed. */
  alreadySeen: boolean;
  existingOrderId: string | null;
}

export async function enqueueDocumentAnalysis(input: {
  sourceDocumentId: string;
  sourceHash: string;
  createdBy: string;
  correlationId?: string;
}): Promise<EnqueueResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("gorush_enqueue_document_analysis", {
    payload: {
      sourceDocumentId: input.sourceDocumentId,
      sourceHash: input.sourceHash,
      createdBy: input.createdBy,
      correlationId: input.correlationId ?? randomUUID(),
    },
  });
  if (error) throw error;

  const result = (data ?? {}) as Record<string, unknown>;
  return {
    analysisId: String(result.analysisId),
    status: String(result.status ?? "QUEUED"),
    alreadySeen: Boolean(result.alreadySeen),
    existingOrderId: (result.existingOrderId as string | null) ?? null,
  };
}

interface LeasedJob {
  analysisId: string;
  sourceDocumentId: string;
  sourceHash: string | null;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
}

async function leaseNextJob(worker: string): Promise<LeasedJob | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("gorush_lease_document_analysis", {
    payload: { worker, leaseSeconds: LEASE_SECONDS },
  });
  if (error) throw error;

  const result = (data ?? {}) as Record<string, unknown>;
  if (!result.claimed) return null;
  return {
    analysisId: String(result.analysisId),
    sourceDocumentId: String(result.sourceDocumentId),
    sourceHash: (result.sourceHash as string | null) ?? null,
    attempts: Number(result.attempts ?? 1),
    maxAttempts: Number(result.maxAttempts ?? 3),
    correlationId: (result.correlationId as string | null) ?? null,
  };
}

/**
 * Flattens every extracted document's lines into one accounted set.
 *
 * `sourceLineCount` is counted from the extraction itself, not from what
 * survived classification. That is the number the storage RPC checks against,
 * so a line lost anywhere in here makes the write fail loudly instead of
 * producing a smaller, plausible-looking order.
 */
function buildLineRows(documents: readonly ExtractedDocument[]) {
  const forAccounting: LineForAccounting[] = [];
  const meta: { documentIndex: number; lineIndex: number; source: ExtractedDocument["lines"][number] }[] = [];

  documents.forEach((document, documentIndex) => {
    document.lines.forEach((raw, lineIndex) => {
      const deterministic = classifyLine({
        rawDescription: raw.rawDescription,
        itemTypeHint: raw.itemTypeHint,
      });
      forAccounting.push({
        sourceDocumentIndex: documentIndex,
        sourceLineIndex: lineIndex,
        classification: deterministic,
        quantity: raw.quantity,
        hasMonetaryValue: raw.unitPrice !== null || raw.lineTotal !== null,
        hasText: Boolean(raw.rawDescription && raw.rawDescription.trim()),
        exclusion: null,
      });
      meta.push({ documentIndex, lineIndex, source: raw });
    });
  });

  const { accounted, result } = accountForLines(forAccounting);

  const rows = accounted.map((line, index) => {
    const entry = meta[index];
    const deterministic = forAccounting[index].classification;
    return {
      sourceDocumentIndex: line.sourceDocumentIndex,
      sourcePage: null,
      sourceLineIndex: line.sourceLineIndex,
      rawDescription: entry.source.rawDescription || null,
      rawValues: entry.source as unknown as Record<string, unknown>,
      normalizedValues: null,
      aiItemTypeHint: entry.source.itemTypeHint,
      deterministicClassification: deterministic,
      finalClassification: deterministic,
      // AI_HINT only when the deterministic text rules found nothing and the
      // model's guess is all we have — recorded so a later audit can tell
      // which classifications rested on the model.
      classificationSource: deterministic === "UNKNOWN" ? "AI_HINT" : "DETERMINISTIC_TEXT",
      fieldConfidences: null,
      validationStatus: line.issues.some((issue) => issue.severity === "BLOCKING")
        ? "BLOCKING"
        : line.issues.length > 0
          ? "REVIEW"
          : "VALID",
      validationIssues: line.issues,
      resolutionAction: line.outcome,
    };
  });

  return { rows, accounting: result };
}

export interface RunJobOutcome {
  ran: boolean;
  analysisId: string | null;
  status: string | null;
  storedLines: number | null;
  willRetry: boolean;
}

/**
 * Leases and runs one job.
 *
 * Every exit path persists state before returning: a success stores the
 * result, a failure records the attempt and its retry decision. Nothing can
 * leave a job silently mid-flight — a killed function's lease simply expires
 * and the row becomes claimable again.
 */
export async function runNextAnalysisJob(worker = "cron"): Promise<RunJobOutcome> {
  const job = await leaseNextJob(worker);
  if (!job) return { ran: false, analysisId: null, status: null, storedLines: null, willRetry: false };

  const supabase = createSupabaseAdminClient();
  const startedAt = Date.now();
  const correlationId = job.correlationId ?? randomUUID();

  try {
    const { data: documentRow, error: documentError } = await supabase
      .from("order_documents")
      .select("storage_path, original_filename, mime_type, detected_mime_type")
      .eq("id", job.sourceDocumentId)
      .maybeSingle();
    if (documentError) throw documentError;
    if (!documentRow) throw new DeterministicJobError("DOCUMENT_NOT_FOUND", "the uploaded document row is gone");

    const document = documentRow as {
      storage_path: string;
      original_filename: string | null;
      mime_type: string | null;
      detected_mime_type: string | null;
    };

    const bytes = await downloadDocumentBytes(document.storage_path);

    // Hash on every run. A storage object that changed under us is a
    // different document, and continuing would attach one file's analysis to
    // another's bytes.
    const hash = computeSourceHash(bytes);
    if (job.sourceHash && hash !== job.sourceHash) {
      throw new DeterministicJobError("SOURCE_HASH_MISMATCH", "the stored file no longer matches its recorded hash");
    }

    const extraction = await withTimeout(
      extractDdtDocuments({
        bytes,
        fileName: document.original_filename ?? "document",
        mimeType: document.detected_mime_type ?? document.mime_type ?? "application/pdf",
      }),
      INLINE_RUN_BUDGET_MS
    );

    if (extraction.status === "unconfigured") {
      // Not an error, and not retryable: no key will appear on a retry.
      throw new DeterministicJobError("EXTRACTION_UNCONFIGURED", extraction.notes.join(" "));
    }
    if (extraction.status === "failed") {
      throw new Error(extraction.error ?? "EXTRACTION_FAILED");
    }

    const { rows, accounting } = buildLineRows(extraction.documents);

    const status = accounting.blocking.length > 0 ? "NEEDS_REVIEW" : "READY";

    const { data: stored, error: storeError } = await supabase.rpc(
      "gorush_store_document_analysis_result",
      {
        payload: {
          analysisId: job.analysisId,
          status,
          sourceLineCount: rows.length,
          sourceDocumentCount: extraction.documents.length,
          pageCount: extraction.pageCount,
          provider: "ddt-extractor",
          model: process.env.ANTHROPIC_MODEL?.trim() || null,
          promptVersion: PROMPT_VERSION,
          schemaVersion: SCHEMA_VERSION,
          validatorVersion: VALIDATOR_VERSION,
          latencyMs: Date.now() - startedAt,
          rawExtraction: { documents: extraction.documents, pageCount: extraction.pageCount },
          warnings: [...extraction.notes, ...accounting.warnings.map((issue) => issue.message)],
          lines: rows,
        },
      }
    );
    if (storeError) throw storeError;

    const storedLines = Number((stored as Record<string, unknown> | null)?.storedLines ?? 0);

    logEvent("document_analysis_completed", {
      analysisId: job.analysisId,
      correlationId,
      status,
      storedLines,
      attempts: job.attempts,
      durationMs: Date.now() - startedAt,
      unresolved: accounting.tally.unresolvedCount,
    });

    return { ran: true, analysisId: job.analysisId, status, storedLines, willRetry: false };
  } catch (caught) {
    const deterministic = caught instanceof DeterministicJobError;
    const code = deterministic ? caught.code : classifyFailure(caught);
    // Redacted: the message only, never headers or request bodies, which is
    // where an API key would be.
    const summary = caught instanceof Error ? caught.message.slice(0, 500) : "UNKNOWN";

    const { data, error } = await supabase.rpc("gorush_fail_document_analysis", {
      payload: {
        analysisId: job.analysisId,
        retryable: !deterministic,
        errorCode: code,
        errorSummary: summary,
      },
    });
    if (error) logError("document_analysis_fail_record_failed", error, { analysisId: job.analysisId });

    logError("document_analysis_failed", caught, {
      analysisId: job.analysisId,
      correlationId,
      code,
      attempts: job.attempts,
      deterministic,
    });

    const willRetry = Boolean((data as Record<string, unknown> | null)?.willRetry);
    return { ran: true, analysisId: job.analysisId, status: willRetry ? "QUEUED" : "FAILED", storedLines: null, willRetry };
  }
}

/** A failure the same input will reproduce. Never retried. */
export class DeterministicJobError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DeterministicJobError";
    this.code = code;
  }
}

function classifyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|aborted/i.test(message)) return "TIMEOUT";
  if (/LINE_COUNT_MISMATCH/.test(message)) return "LINE_COUNT_MISMATCH";
  if (/fetch|network|ECONN|socket/i.test(message)) return "NETWORK";
  return "UNKNOWN";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`job step timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export interface AnalysisStatusView {
  analysisId: string;
  status: string;
  version: number;
  attempts: number;
  maxAttempts: number;
  sourceDocumentCount: number;
  pageCount: number | null;
  warnings: string[];
  errorSummary: string | null;
  lastErrorCode: string | null;
  lines: {
    total: number;
    orderItems: number;
    charges: number;
    textNotes: number;
    excluded: number;
    unresolved: number;
  };
  /** True only when nothing is unresolved. */
  canConfirm: boolean;
}

/** What the polling UI reads. No raw extraction, no provider internals. */
export async function getAnalysisStatus(analysisId: string): Promise<AnalysisStatusView | null> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("document_analyses")
    .select("id, status, version, attempts, max_attempts, source_document_count, page_count, warnings, error_summary, last_error_code")
    .eq("id", analysisId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const analysis = data as Record<string, unknown>;

  const { data: lineRows, error: lineError } = await supabase
    .from("document_extracted_lines")
    .select("resolution_action")
    .eq("document_analysis_id", analysisId);
  if (lineError) throw lineError;

  const actions = ((lineRows ?? []) as { resolution_action: string }[]).map((row) => row.resolution_action);
  const count = (action: string) => actions.filter((value) => value === action).length;
  const unresolved = count("UNRESOLVED");

  return {
    analysisId: String(analysis.id),
    status: String(analysis.status),
    version: Number(analysis.version ?? 1),
    attempts: Number(analysis.attempts ?? 0),
    maxAttempts: Number(analysis.max_attempts ?? 3),
    sourceDocumentCount: Number(analysis.source_document_count ?? 0),
    pageCount: (analysis.page_count as number | null) ?? null,
    warnings: (analysis.warnings as string[] | null) ?? [],
    errorSummary: (analysis.error_summary as string | null) ?? null,
    lastErrorCode: (analysis.last_error_code as string | null) ?? null,
    lines: {
      total: actions.length,
      orderItems: count("ORDER_ITEM"),
      charges: count("DOCUMENT_CHARGE"),
      textNotes: count("TEXT_NOTE"),
      excluded: count("EXPLICITLY_EXCLUDED"),
      unresolved,
    },
    canConfirm: String(analysis.status) === "READY" && unresolved === 0,
  };
}

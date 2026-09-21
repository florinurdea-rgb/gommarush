/**
 * Supplier ingestion pipeline.
 *
 *   fetch -> validate -> normalize -> stage -> verify -> commit
 *
 * Live normalized state is NEVER mutated while parsing. Rows are staged and
 * verified first, and only a run that passes verification is committed. A
 * failed or partial feed therefore cannot corrupt the last known good
 * catalogue: the previous data simply remains current.
 *
 * The pipeline is storage-agnostic (see IngestStore) so it can be exercised
 * deterministically in tests without a database.
 */

import type { ParseOutcome, SupplierOffer } from "../types";

export type RunStatus =
  | "uploaded"
  | "analyzing"
  | "previewed"
  | "committing"
  | "committed"
  | "failed"
  | "cancelled";

/** Never deactivate listings from a partial file - only a COMPLETE snapshot may. */
export type ImportMode = "complete" | "partial" | "manual_correction";

export interface IngestRequest {
  laneCode: string;
  adapterName: string;
  originalFilename: string | null;
  /** Content checksum. The idempotency key for a run. */
  fileChecksum: string;
  importMode: ImportMode;
  /** True for supplier sample/test material. Propagates to every observation. */
  isTestData: boolean;
  uploadedBy: string | null;
  rows: unknown[];
  observedAt?: string;
}

export interface IngestCounters {
  sourceRowCount: number;
  accepted: number;
  rejected: number;
  missingEan: number;
  invalidEan: number;
  recoveredEan: number;
  missingWeight: number;
  reviewRequired: number;
  duplicateListingKeys: number;
  priceObservations: number;
  stockObservations: number;
}

export interface IngestResult {
  runId: string | null;
  status: RunStatus;
  /** True when an identical run had already been committed - nothing re-applied. */
  replayed: boolean;
  counters: IngestCounters;
  rejections: Array<{ sourceRow: number | null; errors: string[] }>;
  /** Populated when the run did not commit. */
  errorSummary: string | null;
}

/** Persistence seam. Implemented against Supabase in production code. */
export interface IngestStore {
  /** Returns an existing COMMITTED run for this (lane, adapter, checksum), if any. */
  findCommittedRun(args: {
    laneCode: string;
    adapterName: string;
    fileChecksum: string;
  }): Promise<{ runId: string } | null>;
  createRun(args: IngestRequest & { observedAt: string }): Promise<{ runId: string }>;
  stageRows(args: {
    runId: string;
    outcomes: ParseOutcome[];
  }): Promise<void>;
  commitOffers(args: {
    runId: string;
    laneCode: string;
    offers: SupplierOffer[];
    importMode: ImportMode;
    isTestData: boolean;
  }): Promise<void>;
  finishRun(args: {
    runId: string;
    status: RunStatus;
    counters: IngestCounters;
    errorSummary: string | null;
  }): Promise<void>;
}

export interface VerificationIssue {
  code: string;
  detail: string;
}

function emptyCounters(sourceRowCount: number): IngestCounters {
  return {
    sourceRowCount,
    accepted: 0,
    rejected: 0,
    missingEan: 0,
    invalidEan: 0,
    recoveredEan: 0,
    missingWeight: 0,
    reviewRequired: 0,
    duplicateListingKeys: 0,
    priceObservations: 0,
    stockObservations: 0,
  };
}

export function countOutcomes(
  outcomes: readonly ParseOutcome[],
  sourceRowCount: number,
): IngestCounters {
  const counters = emptyCounters(sourceRowCount);
  const seenListingKeys = new Set<string>();

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      counters.rejected += 1;
      continue;
    }
    const offer = outcome.offer;
    counters.accepted += 1;

    if (offer.eanStatus === "missing") counters.missingEan += 1;
    if (offer.eanStatus === "invalid_check_digit") counters.invalidEan += 1;
    if (offer.eanStatus === "recovered_leading_zero") counters.recoveredEan += 1;
    if (offer.reviewReasons.includes("WEIGHT_MISSING")) counters.missingWeight += 1;
    if (offer.reviewReasons.length > 0) counters.reviewRequired += 1;
    if (offer.purchasePriceNet !== null) counters.priceObservations += 1;
    if (offer.stockExact !== null || offer.stockStatus !== "unknown") {
      counters.stockObservations += 1;
    }

    if (seenListingKeys.has(offer.supplierListingKey)) {
      counters.duplicateListingKeys += 1;
    } else {
      seenListingKeys.add(offer.supplierListingKey);
    }
  }
  return counters;
}

/**
 * Gate between stage and commit.
 *
 * Refusing to commit is always safer than half-applying a feed: the previous
 * catalogue stays authoritative. A run is rejected when the file is empty,
 * when nothing at all parsed, when duplicate listing keys would make the commit
 * ambiguous, or when a "complete" snapshot lost so much of the file that
 * treating it as complete would wrongly deactivate live listings.
 */
export function verifyRun(
  counters: IngestCounters,
  importMode: ImportMode,
): VerificationIssue[] {
  const issues: VerificationIssue[] = [];

  if (counters.sourceRowCount === 0) {
    issues.push({ code: "EMPTY_FILE", detail: "The source file contained no rows." });
  }
  if (counters.sourceRowCount > 0 && counters.accepted === 0) {
    issues.push({
      code: "NO_ROWS_ACCEPTED",
      detail: `All ${counters.sourceRowCount} rows were rejected; the file does not match the expected contract.`,
    });
  }
  if (counters.duplicateListingKeys > 0) {
    issues.push({
      code: "DUPLICATE_LISTING_KEYS",
      detail: `${counters.duplicateListingKeys} duplicate supplier listing keys - the commit would be ambiguous.`,
    });
  }
  if (
    importMode === "complete" &&
    counters.sourceRowCount > 0 &&
    counters.accepted / counters.sourceRowCount < 0.5
  ) {
    issues.push({
      code: "COMPLETE_SNAPSHOT_TOO_LOSSY",
      detail:
        `Only ${counters.accepted}/${counters.sourceRowCount} rows accepted. ` +
        "Committing this as a COMPLETE snapshot could deactivate live listings.",
    });
  }
  return issues;
}

/**
 * Run one ingestion.
 *
 * Idempotent by file checksum: re-ingesting a file that already committed for
 * the same lane and adapter is a no-op that reports `replayed: true`, so a
 * retried or re-scheduled feed cannot double-apply.
 */
export async function runIngestion(
  store: IngestStore,
  request: IngestRequest,
  parse: (rows: unknown[], options: { isTestData: boolean; observedAt: string }) => ParseOutcome[],
): Promise<IngestResult> {
  const observedAt = request.observedAt ?? new Date().toISOString();

  // --- idempotency -------------------------------------------------------
  const existing = await store.findCommittedRun({
    laneCode: request.laneCode,
    adapterName: request.adapterName,
    fileChecksum: request.fileChecksum,
  });
  if (existing) {
    return {
      runId: existing.runId,
      status: "committed",
      replayed: true,
      counters: emptyCounters(request.rows.length),
      rejections: [],
      errorSummary: null,
    };
  }

  const { runId } = await store.createRun({ ...request, observedAt });

  // --- validate + normalize ---------------------------------------------
  let outcomes: ParseOutcome[];
  try {
    outcomes = parse(request.rows, { isTestData: request.isTestData, observedAt });
  } catch (error) {
    const summary = `PARSE_FAILED: ${error instanceof Error ? error.message : String(error)}`;
    const counters = emptyCounters(request.rows.length);
    await store.finishRun({ runId, status: "failed", counters, errorSummary: summary });
    return { runId, status: "failed", replayed: false, counters, rejections: [], errorSummary: summary };
  }

  const counters = countOutcomes(outcomes, request.rows.length);
  const rejections = outcomes
    .filter((o): o is Extract<ParseOutcome, { ok: false }> => !o.ok)
    .map((o) => ({ sourceRow: o.sourceRow, errors: o.errors }));

  // --- stage (never touches live normalized state) -----------------------
  await store.stageRows({ runId, outcomes });

  // --- verify ------------------------------------------------------------
  const issues = verifyRun(counters, request.importMode);
  if (issues.length > 0) {
    const summary = issues.map((i) => `${i.code}: ${i.detail}`).join(" | ");
    await store.finishRun({ runId, status: "failed", counters, errorSummary: summary });
    return { runId, status: "failed", replayed: false, counters, rejections, errorSummary: summary };
  }

  // --- commit ------------------------------------------------------------
  const offers = outcomes
    .filter((o): o is Extract<ParseOutcome, { ok: true }> => o.ok)
    .map((o) => o.offer);

  try {
    await store.commitOffers({
      runId,
      laneCode: request.laneCode,
      offers,
      importMode: request.importMode,
      isTestData: request.isTestData,
    });
  } catch (error) {
    const summary = `COMMIT_FAILED: ${error instanceof Error ? error.message : String(error)}`;
    await store.finishRun({ runId, status: "failed", counters, errorSummary: summary });
    return { runId, status: "failed", replayed: false, counters, rejections, errorSummary: summary };
  }

  await store.finishRun({ runId, status: "committed", counters, errorSummary: null });
  return { runId, status: "committed", replayed: false, counters, rejections, errorSummary: null };
}

import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError, logEvent } from "@/lib/logger";
import { analyzeDocument } from "@/lib/documents";
import type { AnalysisResult } from "@/lib/documents/analyzer";
import type { DocumentSourceType, OrderDocumentRow } from "@/lib/types/logistics";

/**
 * Original supplier documents: stored first, analysed second.
 *
 * The source document is NEVER discarded after extraction — it is the evidence
 * behind every field on the review screen, and the only way to re-check an
 * import later. Storage happens before analysis so a failing analyser can never
 * lose the upload.
 */

const BUCKET = "order-documents";

function sourceTypeFor(mimeType: string, fileName: string): DocumentSourceType {
  const lower = fileName.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (mimeType.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/.test(lower)) return "image";
  return "manual";
}

/** Keeps the storage path predictable and free of anything user-controlled. */
function storagePathFor(fileName: string): string {
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(fileName)?.[1]?.toLowerCase() ?? "bin";
  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${folder}/${randomUUID()}.${extension}`;
}

export interface StoredDocument {
  id: string;
  storagePath: string;
  sourceType: DocumentSourceType;
}

export async function storeOrderDocument(input: {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
  uploadedBy: string;
}): Promise<StoredDocument> {
  const supabase = createSupabaseAdminClient();
  const storagePath = storagePathFor(input.fileName);
  const sourceType = sourceTypeFor(input.mimeType, input.fileName);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: input.mimeType || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    logError("document_upload_failed", uploadError, { fileName: input.fileName });
    throw uploadError;
  }

  const { data, error } = await supabase
    .from("order_documents")
    .insert({
      source_type: sourceType,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      original_filename: input.fileName.slice(0, 255),
      mime_type: input.mimeType,
      file_size: input.bytes.byteLength,
      extraction_status: "pending",
      uploaded_by_label: input.uploadedBy,
    })
    .select("id")
    .single();

  if (error) {
    logError("document_record_failed", error, { storagePath });
    throw error;
  }

  const id = (data as { id: string }).id;
  logEvent("document_stored", { documentId: id, sourceType, bytes: input.bytes.byteLength });
  return { id, storagePath, sourceType };
}

/**
 * Runs the analysis pipeline and records the outcome on the document row.
 *
 * The analysis result is persisted in `raw_extracted_data` so the review screen
 * can be reloaded (or revisited) without paying for a second AI call.
 */
export async function analyzeStoredDocument(input: {
  documentId: string;
  bytes: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<AnalysisResult> {
  const supabase = createSupabaseAdminClient();

  await supabase
    .from("order_documents")
    .update({ extraction_status: "processing" })
    .eq("id", input.documentId);

  const result = await analyzeDocument({
    bytes: input.bytes,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });

  // Map our analysis status onto the database's extraction vocabulary.
  const extractionStatus =
    result.status === "analysed"
      ? "review_required"
      : result.status === "unconfigured"
        ? "unconfigured"
        : "failed";

  // The extracted text can be large and is only diagnostic; keep the row lean.
  const { extractedText, ...persisted } = result;

  const { error } = await supabase
    .from("order_documents")
    .update({
      extraction_status: extractionStatus,
      raw_extracted_data: persisted,
      analysis_provider: result.provider,
      analysis_error: result.error,
      analysed_at: new Date().toISOString(),
      extraction_confidence:
        result.products.length > 0
          ? result.products.reduce((sum, line) => sum + (line.confidence ?? 0), 0) /
            result.products.length
          : null,
    })
    .eq("id", input.documentId);

  if (error) logError("document_analysis_record_failed", error, { documentId: input.documentId });

  logEvent("document_analysis_complete", {
    documentId: input.documentId,
    status: result.status,
    provider: result.provider,
    products: result.products.length,
  });

  return { ...result, extractedText: extractedText ?? null };
}

export async function getOrderDocument(documentId: string): Promise<OrderDocumentRow | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("order_documents")
    .select(
      "id, order_id, supplier_id, source_type, storage_bucket, storage_path, original_filename, mime_type, file_size, extraction_status, extraction_confidence, raw_extracted_data, analysis_provider, analysis_error, analysed_at, created_at"
    )
    .eq("id", documentId)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as unknown as OrderDocumentRow | null;
}

/**
 * A short-lived signed URL for viewing the original. The bucket is private, so
 * this is the only way to see the file — and the link expires, which keeps it
 * from being forwarded around indefinitely.
 */
export async function getDocumentDownloadUrl(
  documentId: string,
  expiresInSeconds = 300
): Promise<string | null> {
  const document = await getOrderDocument(documentId);
  if (!document?.storage_path) return null;

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(document.storage_bucket ?? BUCKET)
    .createSignedUrl(document.storage_path, expiresInSeconds);

  if (error) {
    logError("document_signed_url_failed", error, { documentId });
    return null;
  }
  return data?.signedUrl ?? null;
}

export async function listRecentDocuments(limit = 25) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("order_documents")
    .select("id, original_filename, source_type, extraction_status, order_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as {
    id: string;
    original_filename: string | null;
    source_type: DocumentSourceType;
    extraction_status: string;
    order_id: string | null;
    created_at: string;
  }[];
}

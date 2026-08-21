import type { createClient as CreateClient } from "@supabase/supabase-js";

/**
 * Uploads a file straight to Supabase Storage from the browser, using a
 * one-time signed URL our server issues (see /api/admin/documents/upload-url
 * and createUploadSlot() in src/lib/server/documents.ts). The raw bytes
 * never pass through our own serverless function — Vercel's request-body
 * limit on Serverless Functions is a few MB, well under what a scanned
 * multi-page DDT commonly weighs, so the old "POST the file as multipart
 * form data" flow silently failed on real documents ("Eroare de rețea").
 *
 * The anon key below has no storage write permission on its own — the
 * bucket is private. Authorization for this one upload comes entirely from
 * the signed token our server (using the service-role key) generated for
 * this exact path; that's the point of Supabase's signed-upload-URL flow.
 */

let browserSupabase: ReturnType<typeof CreateClient> | null = null;

// Dynamically imported — @supabase/supabase-js is ~60KB and only needed at
// the moment of an actual upload, not on every page that might show the
// "Comandă nouă" button.
async function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_CLIENT_CONFIG");
  if (!browserSupabase) {
    const { createClient } = await import("@supabase/supabase-js");
    browserSupabase = createClient(url, key);
  }
  return browserSupabase;
}

export interface DirectUploadResult {
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export class DocumentUploadError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function uploadDocumentDirect(file: File): Promise<DirectUploadResult> {
  const mimeType = file.type || "application/octet-stream";

  const slotResponse = await fetch("/api/admin/documents/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType }),
  });
  const slotPayload = (await slotResponse.json()) as {
    ok: boolean;
    code?: string;
    bucket?: string;
    storagePath?: string;
    token?: string;
  };
  if (!slotPayload.ok || !slotPayload.bucket || !slotPayload.storagePath || !slotPayload.token) {
    throw new DocumentUploadError(slotPayload.code ?? "UPLOAD_SLOT_FAILED");
  }

  const supabase = await getBrowserSupabase();
  const { error } = await supabase.storage
    .from(slotPayload.bucket)
    .uploadToSignedUrl(slotPayload.storagePath, slotPayload.token, file, { contentType: mimeType });
  if (error) throw new DocumentUploadError("STORAGE_UPLOAD_FAILED");

  return { storagePath: slotPayload.storagePath, fileName: file.name, mimeType, fileSize: file.size };
}

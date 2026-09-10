import { NextRequest } from "next/server";
import { analyzeDdtUpload } from "@/lib/server/ddt-import";
import { analyzeUploadedDocumentSchema } from "@/lib/validation/logistics";
import { isSupportedUpload, MAX_UPLOAD_BYTES } from "@/lib/documents/analyzer";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
// A multi-page, multi-document PDF plus a vision round-trip comfortably
// exceeds the default serverless limit.
export const maxDuration = 170;

/**
 * POST /api/admin/ddt-import/analyze — step 2 of the multi-DDT import.
 *
 * The browser already uploaded the file straight to Supabase Storage (see
 * /api/admin/documents/upload-url and src/lib/client/document-upload.ts) —
 * this route only receives the small JSON pointer to it, downloads the
 * bytes server-side, and runs AI extraction + the deterministic pipeline
 * for every document found. Nothing is written as an order here. See
 * src/lib/server/ddt-import.ts.
 */
export async function POST(request: NextRequest) {
  return runAdminRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = analyzeUploadedDocumentSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const { storagePath, fileName, mimeType, fileSize } = parsed.data;
    if (fileSize > MAX_UPLOAD_BYTES) return fail(413, "FILE_TOO_LARGE");
    if (!isSupportedUpload(mimeType, fileName)) return fail(415, "UNSUPPORTED_FILE_TYPE");

    const result = await analyzeDdtUpload({
      storagePath,
      fileName,
      mimeType,
      fileSize,
      uploadedBy: session.subject,
    });
    if (result.error) return fail(500, "ANALYSIS_FAILED", [result.error]);

    return ok({ ...result }, 201);
  });
}

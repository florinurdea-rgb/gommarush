import { NextRequest } from "next/server";
import { analyzeDdtUpload } from "@/lib/server/ddt-import";
import { isSupportedUpload, MAX_UPLOAD_BYTES } from "@/lib/documents/analyzer";
import { fail, ok, runAdminRoute } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
// A multi-page, multi-document PDF plus a vision round-trip comfortably
// exceeds the default serverless limit.
export const maxDuration = 170;

/**
 * POST /api/admin/ddt-import/analyze — step 1 of the multi-DDT import.
 *
 * Stores the upload, runs AI extraction + the deterministic pipeline for
 * every document found in it, and returns a proposal for each — nothing is
 * written as an order here. See src/lib/server/ddt-import.ts.
 */
export async function POST(request: NextRequest) {
  return runAdminRoute(async (session) => {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return fail(415, "UNSUPPORTED_MEDIA_TYPE");
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return fail(400, "VALIDATION_FAILED");
    }

    const file = formData.get("file");
    if (!(file instanceof File)) return fail(400, "VALIDATION_FAILED");
    if (file.size === 0) return fail(400, "VALIDATION_FAILED");
    if (file.size > MAX_UPLOAD_BYTES) return fail(413, "FILE_TOO_LARGE");

    const fileName = file.name || "document";
    const mimeType = file.type || "application/octet-stream";
    if (!isSupportedUpload(mimeType, fileName)) return fail(415, "UNSUPPORTED_FILE_TYPE");

    const bytes = Buffer.from(await file.arrayBuffer());

    const result = await analyzeDdtUpload({ bytes, fileName, mimeType, uploadedBy: session.subject });
    if (result.error) return fail(500, "ANALYSIS_FAILED", [result.error]);

    return ok({ ...result }, 201);
  });
}

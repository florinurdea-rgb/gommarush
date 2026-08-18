import { NextRequest } from "next/server";
import { documentUploadSlotSchema } from "@/lib/validation/logistics";
import { createUploadSlot } from "@/lib/server/documents";
import { isSupportedUpload } from "@/lib/documents/analyzer";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST — step 1 of a direct-to-storage upload: issues a one-time signed
 * Supabase Storage upload URL/token so the browser can send the file bytes
 * straight to storage, never through this (or any) serverless function's
 * request body. See createUploadSlot() in src/lib/server/documents.ts for
 * why this exists.
 */
export async function POST(request: NextRequest) {
  return runAdminRoute(async () => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = documentUploadSlotSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    if (!isSupportedUpload(parsed.data.mimeType, parsed.data.fileName)) {
      return fail(415, "UNSUPPORTED_FILE_TYPE");
    }

    const slot = await createUploadSlot(parsed.data.fileName);
    return ok({ bucket: slot.bucket, storagePath: slot.storagePath, token: slot.token });
  });
}

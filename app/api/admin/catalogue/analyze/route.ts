import { NextRequest } from "next/server";
import { analyzeCatalogueImport } from "@/lib/server/catalogue-import";
import { downloadDocumentBytes } from "@/lib/server/documents";
import { analyzeCatalogueSchema } from "@/lib/validation/catalogue";
import { MAX_UPLOAD_BYTES, isSupportedUpload } from "@/lib/documents/analyzer";
import { WorkbookError } from "@/lib/catalogue/xlsx-reader";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
// Reading 9,500 rows, matching them against the whole catalogue and staging
// the result is comfortably past the default serverless limit.
export const maxDuration = 170;

/**
 * POST /api/admin/catalogue/analyze — step 2 of a catalogue import.
 *
 * The browser has already put the workbook in Supabase Storage (see
 * /api/admin/documents/upload-url); this receives the pointer, reads the
 * bytes server-side and produces a preview. It writes staging rows and an
 * import run, and NOTHING in the catalogue itself — an operator can look at
 * the numbers and walk away.
 */
export async function POST(request: NextRequest) {
  return runAdminRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = analyzeCatalogueSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const { storagePath, fileName, fileSize, supplierId, adapterId, importMode } = parsed.data;
    if (fileSize > MAX_UPLOAD_BYTES) return fail(413, "FILE_TOO_LARGE");
    if (!isSupportedUpload("", fileName)) return fail(415, "UNSUPPORTED_FILE_TYPE");

    const bytes = await downloadDocumentBytes(storagePath);

    try {
      const result = await analyzeCatalogueImport({
        bytes,
        fileName,
        adapterId,
        supplierId,
        importMode,
        uploadedBy: session.displayName,
        storagePath,
      });
      return ok({ ...result }, 201);
    } catch (error) {
      // A malformed or wrong-shaped workbook is the operator's problem to
      // fix, not a server fault: it comes back as a 400 naming what is wrong.
      if (error instanceof WorkbookError) {
        return fail(400, error.code, error.message ? [error.message] : undefined);
      }
      throw error;
    }
  });
}

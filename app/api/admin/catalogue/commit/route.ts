import { NextRequest } from "next/server";
import { commitCatalogueImport } from "@/lib/server/catalogue-import";
import { commitCatalogueSchema } from "@/lib/validation/catalogue";
import { WorkbookError } from "@/lib/catalogue/xlsx-reader";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 170;

/**
 * POST /api/admin/catalogue/commit — applies a previewed run, in batches.
 *
 * Returns `finished: false` while staged rows remain, and the client calls
 * again. That is what keeps a 9,500-row import inside Vercel's time limit
 * without ever leaving a half-applied run looking successful: the run only
 * reaches 'committed' when nothing is left to apply.
 */
export async function POST(request: NextRequest) {
  return runAdminRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = commitCatalogueSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    try {
      const result = await commitCatalogueImport(parsed.data.runId, session.displayName, {
        maxBatches: parsed.data.maxBatches,
      });
      return ok({ ...result });
    } catch (error) {
      if (error instanceof WorkbookError) {
        return fail(400, error.code, error.message ? [error.message] : undefined);
      }
      throw error;
    }
  });
}

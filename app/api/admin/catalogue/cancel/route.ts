import { NextRequest } from "next/server";
import { cancelCatalogueImport } from "@/lib/server/catalogue-import";
import { cancelCatalogueSchema } from "@/lib/validation/catalogue";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/** POST /api/admin/catalogue/cancel — abandons a previewed run, applying nothing. */
export async function POST(request: NextRequest) {
  return runAdminRoute(async () => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = cancelCatalogueSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    await cancelCatalogueImport(parsed.data.runId);
    return ok({ cancelled: true });
  });
}

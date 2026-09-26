import { NextRequest } from "next/server";
import { fail, ok, runAdminRoute } from "@/lib/server/route-helpers";
import {
  isSearchableSeason,
  searchCatalogue,
  type CatalogueSearchQuery,
} from "@/lib/server/catalogue-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/catalogue/search — internal commercial preview.
 *
 * ADMIN ONLY, and the guard is here rather than inherited: `runAdminRoute`
 * re-checks the session independently of the /admin layout, because a layout
 * guard protects pages and does nothing at all for a direct fetch of this URL.
 *
 * This route answers with the INTERNAL projection, which includes supplier
 * cost, supplier name, markup and gross profit. That is its purpose — it
 * exists so an operator can judge whether GommaRush is competitive. It must
 * therefore never be reused to back a public page; the customer projection in
 * src/lib/pricing/projection.ts is the one for that, and it is a different
 * type precisely so the two cannot be confused.
 */

/** A dimension from a query string, or null. Rejects junk rather than NaN. */
function dimension(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  if (!/^\d{1,4}$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest) {
  return runAdminRoute(async () => {
    const params = new URL(request.url).searchParams;

    const seasonRaw = params.get("season");
    // An unrecognised season is refused rather than ignored. Silently dropping
    // the filter would answer a different question than the one asked and the
    // operator would have no way to tell.
    if (seasonRaw !== null && seasonRaw !== "" && !isSearchableSeason(seasonRaw)) {
      return fail(400, "VALIDATION_FAILED");
    }

    const query: CatalogueSearchQuery = {
      widthMm: dimension(params.get("width")),
      aspectRatio: dimension(params.get("aspect")),
      rimInch: dimension(params.get("rim")),
      season: isSearchableSeason(seasonRaw) ? seasonRaw : null,
      brand: params.get("brand")?.trim() || null,
      limit: dimension(params.get("limit")) ?? undefined,
      offset: dimension(params.get("offset")) ?? undefined,
    };

    const result = await searchCatalogue(query);

    return ok({
      results: result.internal,
      schemaAvailable: result.schemaAvailable,
      settings: {
        markupPercent: result.settings.markupPercent,
        markupProvenance: result.settings.markupProvenance,
        minimumProfitCents: result.settings.minimumProfitCents,
        vatRatePercent: result.settings.vatRatePercent,
        vatRateProvenance: result.settings.vatRateProvenance,
        pfuVatBase: result.settings.pfuVatBase,
      },
    });
  });
}

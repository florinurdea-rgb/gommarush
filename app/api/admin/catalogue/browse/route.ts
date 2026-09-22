import { NextRequest } from "next/server";
import { fail, ok, runAdminRoute } from "@/lib/server/route-helpers";
import {
  browseCatalogue,
  getCatalogueFacets,
  isSearchableSeason,
  type CatalogueBrowseQuery,
  type VehicleFilter,
} from "@/lib/server/catalogue-browse";
import { isLaneCode } from "@/lib/catalogue/supplier-lanes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/catalogue/browse — the admin Catalogue workspace.
 *
 * ADMIN ONLY, re-checked here by `runAdminRoute` rather than inherited from
 * the page layout: a layout guard protects pages and does nothing for a direct
 * fetch of this URL.
 *
 * It answers with supplier cost, supplier identity, article codes and stock
 * internals — which is the point of an operational workspace, and exactly why
 * it must never back a customer surface. The customer projection lives in
 * src/lib/pricing/projection.ts and is a different type.
 */

function dimension(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  if (!/^\d{1,4}$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return parsed > 0 ? parsed : null;
}

function vehicleFilter(value: string | null): VehicleFilter {
  return value === "truck" || value === "car_van" ? value : "all";
}

export async function GET(request: NextRequest) {
  return runAdminRoute(async () => {
    const params = new URL(request.url).searchParams;

    const seasonRaw = params.get("season");
    // An unrecognised season is refused rather than dropped: silently ignoring
    // it would answer a different question than the operator asked.
    if (seasonRaw !== null && seasonRaw !== "" && !isSearchableSeason(seasonRaw)) {
      return fail(400, "VALIDATION_FAILED");
    }

    const laneRaw = params.get("lane");
    if (laneRaw !== null && laneRaw !== "" && !isLaneCode(laneRaw)) {
      return fail(400, "VALIDATION_FAILED");
    }

    const query: CatalogueBrowseQuery = {
      lane: isLaneCode(laneRaw) ? laneRaw : null,
      vehicle: vehicleFilter(params.get("vehicle")),
      needsReviewOnly: params.get("needsReview") === "1",
      widthMm: dimension(params.get("width")),
      aspectRatio: dimension(params.get("aspect")),
      rimInch: dimension(params.get("rim")),
      season: isSearchableSeason(seasonRaw) ? seasonRaw : null,
      brand: params.get("brand")?.trim() || null,
      search: params.get("q")?.trim() || null,
      limit: dimension(params.get("limit")) ?? undefined,
      offset: dimension(params.get("offset")) ?? undefined,
    };

    const [result, facets] = await Promise.all([
      browseCatalogue(query),
      getCatalogueFacets(query),
    ]);

    return ok({
      rows: result.rows,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      schemaAvailable: result.schemaAvailable,
      facets,
      settings: {
        markupPercent: result.settings.markupPercent,
        pfuVatBase: result.settings.pfuVatBase,
      },
      minimumOfferQuantity: result.sellingPolicy.minimumOfferQuantity,
    });
  });
}

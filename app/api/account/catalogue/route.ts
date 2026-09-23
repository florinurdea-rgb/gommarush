import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/auth/customer-session";
import { isBrandTier, BRAND_TIERS_CONFIGURED } from "@/lib/catalogue/brand-tiers";
import { isSearchableSeason, getCatalogueFacets } from "@/lib/server/catalogue-browse";
import { isCustomerSort, searchCustomerCatalogue } from "@/lib/server/customer-catalogue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function n(v: string | null): number | null {
  if (!v) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * The customer catalogue.
 *
 * SECURITY BOUNDARY: everything returned under `offers` is a
 * `CustomerTyreOffer`, produced by `toCustomerOffer`. Supplier identity,
 * article codes, purchase cost, raw stock and margin are not withheld by this
 * route — they have no field to occupy in the type it returns.
 *
 * Pagination and ordering are decided over the whole offerable selection in
 * src/lib/server/customer-catalogue.ts, not over the page. See the note there
 * for why that distinction is a pricing correctness issue and not a cosmetic
 * one.
 */
export async function GET(request: NextRequest) {
  try {
    await requireCustomerSession();
  } catch {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  const p = request.nextUrl.searchParams;
  const season = p.get("season");
  const tier = p.get("tier");
  const sort = p.get("sort");

  const filters = {
    widthMm: n(p.get("width")),
    aspectRatio: n(p.get("aspect")),
    rimInch: n(p.get("rim")),
    season: isSearchableSeason(season) ? season : null,
    brand: p.get("brand")?.trim() || null,
    // A tier is only ever a filter where an approved mapping exists. Accepting
    // one while the taxonomy is empty would return nothing and look like an
    // empty catalogue rather than an unconfigured classification.
    brandTier: BRAND_TIERS_CONFIGURED && isBrandTier(tier) ? tier : null,
  };

  const [result, facets] = await Promise.all([
    searchCustomerCatalogue({
      ...filters,
      sort: isCustomerSort(sort) ? sort : "price_asc",
      limit: Math.min(Math.max(n(p.get("limit")) ?? 24, 1), 100),
      offset: Math.max(n(p.get("offset")) ?? 0, 0),
    }),
    getCatalogueFacets({
      widthMm: filters.widthMm,
      aspectRatio: filters.aspectRatio,
      rimInch: filters.rimInch,
      season: filters.season,
      brand: filters.brand,
      vehicle: "all",
      lane: null,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    offers: result.offers,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    sort: result.sort,
    // Surfaced rather than silently truncated: a selection too large to page
    // correctly asks the customer to narrow it.
    refused: result.refused,
    tiersConfigured: BRAND_TIERS_CONFIGURED,
    facets: {
      widths: facets.widths,
      aspectRatios: facets.aspectRatios,
      rims: facets.rims,
      seasons: facets.seasons,
      brands: facets.brands,
    },
    schemaAvailable: result.schemaAvailable && facets.schemaAvailable,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/auth/customer-session";
import { isBrandTier, BRAND_TIERS_CONFIGURED } from "@/lib/catalogue/brand-tiers";
import { DEFAULT_FULFILMENT_CLASS, fulfilmentPromise } from "@/lib/commerce/fulfilment";
import { DEFAULT_PRICING_SETTINGS } from "@/lib/pricing/settings";
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
 * DELIBERATE SEARCH. Results are not returned until width, aspect ratio and rim
 * are all chosen. The gate is HERE, not only in the component: a browse of the
 * whole catalogue is both commercially meaningless (a tyre shop buys a size,
 * not a category) and the one shape that exceeds the sort bound and gets
 * refused. Enforcing it server-side means the expensive read cannot be
 * triggered by a hand-written query string either.
 *
 * Facets are still computed while dimensions are incomplete — they are what the
 * customer chooses FROM, and they narrow as each dimension is picked.
 *
 * Pagination and ordering are decided over the whole offerable selection in
 * src/lib/server/customer-catalogue.ts. See the note there for why that is a
 * pricing correctness issue and not a cosmetic one.
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

  const widthMm = n(p.get("width"));
  const aspectRatio = n(p.get("aspect"));
  const rimInch = n(p.get("rim"));

  const filters = {
    widthMm,
    aspectRatio,
    rimInch,
    season: isSearchableSeason(season) ? season : null,
    brand: p.get("brand")?.trim() || null,
    // A tier is only ever a filter where an approved mapping exists. Accepting
    // one while the taxonomy is empty would return nothing and look like an
    // empty catalogue rather than an unconfigured classification.
    brandTier: BRAND_TIERS_CONFIGURED && isBrandTier(tier) ? tier : null,
  };

  const dimensionsComplete = widthMm !== null && aspectRatio !== null && rimInch !== null;

  const facetQuery = {
    widthMm,
    aspectRatio,
    rimInch,
    season: filters.season,
    brand: filters.brand,
    vehicle: "all" as const,
    lane: null,
  };

  /**
   * What the customer is promised about delivery.
   *
   * A GommaRush service commitment attached to the fulfilment class, NOT a
   * supplier lead time — see src/lib/commerce/fulfilment.ts for why publishing
   * a per-offer lead time would leak sourcing.
   */
  const promise = fulfilmentPromise(DEFAULT_FULFILMENT_CLASS);

  const shared = {
    ok: true as const,
    tiersConfigured: BRAND_TIERS_CONFIGURED,
    fulfilment: { class: promise.class, maxDays: promise.maxDays },
    // Statutory and public. This is the RATE, not the engine's internal
    // `vatRatePercentApplied` resolution field, which stays internal.
    vatRatePercent: DEFAULT_PRICING_SETTINGS.vatRatePercent,
    pfuInVatBase: DEFAULT_PRICING_SETTINGS.pfuVatBase === "inside_vat_base",
  };

  if (!dimensionsComplete) {
    const facets = await getCatalogueFacets(facetQuery);
    return NextResponse.json({
      ...shared,
      awaitingDimensions: true,
      offers: [],
      total: 0,
      limit: 0,
      offset: 0,
      sort: isCustomerSort(sort) ? sort : "price_asc",
      refused: null,
      facets: {
        widths: facets.widths,
        aspectRatios: facets.aspectRatios,
        rims: facets.rims,
        seasons: facets.seasons,
        brands: facets.brands,
      },
      schemaAvailable: facets.schemaAvailable,
    });
  }

  const [result, facets] = await Promise.all([
    searchCustomerCatalogue({
      ...filters,
      sort: isCustomerSort(sort) ? sort : "price_asc",
      limit: Math.min(Math.max(n(p.get("limit")) ?? 24, 1), 100),
      offset: Math.max(n(p.get("offset")) ?? 0, 0),
    }),
    getCatalogueFacets(facetQuery),
  ]);

  return NextResponse.json({
    ...shared,
    awaitingDimensions: false,
    offers: result.offers,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    sort: result.sort,
    // Surfaced rather than silently truncated: a selection too large to page
    // correctly asks the customer to narrow it.
    refused: result.refused,
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

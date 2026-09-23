import "server-only";
import { OFFER_SORT_MAX_PRODUCTS } from "@/lib/catalogue/catalogue-sort";
import { tierForBrand } from "@/lib/catalogue/brand-tiers";
import type { BrandTier } from "@/lib/catalogue/brand-tiers";
import {
  selectCatalogueRows,
  type CatalogueBrowseQuery,
  type CatalogueRow,
  type SearchableSeason,
  type SortRefusal,
  type SupplierOffer,
} from "@/lib/server/catalogue-browse";
import { DEFAULT_PRICING_SETTINGS, type PricingSettings } from "@/lib/pricing/settings";
import { DEFAULT_SELLING_POLICY, type SellingPolicy } from "@/lib/commerce/selling-policy";
import {
  toCustomerOffer,
  type AvailabilityView,
  type CustomerTyreOffer,
} from "@/lib/pricing/projection";

/**
 * The customer's view of the catalogue.
 *
 * ONE ENGINE, TWO AUDIENCES. This reads through src/lib/server/catalogue-browse.ts
 * — the same product-rooted query, the same lane attribution, the same pricing
 * engine and the same selling policy the admin workspace uses — and then
 * narrows each row to `CustomerTyreOffer`. It deliberately does NOT read the
 * database itself: a second customer-facing catalogue read would be a second
 * catalogue, and the two would disagree about what is available the first time
 * either changed.
 *
 * WHY THE WHOLE SELECTION IS MATERIALISED. Two of the things a customer page
 * must be true about — which products are offerable at all, and which is
 * cheapest — are decided by the latest supplier observation, which lives in a
 * different table from the product. Neither can be pushed into the product
 * query. Paging the products first and applying them afterwards is what the
 * previous implementation did, and it produced:
 *
 *   - pages of varying and unpredictable size,
 *   - a total that counted products the customer could not buy,
 *   - and, worst, a "price" that was only the cheapest offer ON THAT PAGE —
 *     a customer could be quoted more than GommaRush's own best price because
 *     the cheaper listing for the same tyre happened to sort onto page two.
 *
 * So the filtered selection is materialised whole, bounded by the cap M11B
 * already established, then filtered, sorted and sliced. Above the cap the
 * request is REFUSED with a message asking for a narrower search, which is the
 * same honest failure the admin sort takes.
 */

/**
 * Orders a customer may choose.
 *
 * `price_asc` is the GommaRush SELLING price, not the supplier cost. Today a
 * flat markup makes the two orders identical, which is exactly why this is
 * stated explicitly: the moment markup varies by brand or lane, ordering by
 * cost would quietly stop meaning "cheapest for the customer".
 *
 * There is no "recommended" order. A recommendation is a commercial position,
 * and inventing one here would put an unapproved ranking in front of customers.
 */
export const CUSTOMER_SORTS = ["price_asc", "brand_asc"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export function isCustomerSort(value: unknown): value is CustomerSort {
  return typeof value === "string" && (CUSTOMER_SORTS as readonly string[]).includes(value);
}

export interface CustomerCatalogueQuery {
  readonly widthMm?: number | null;
  readonly aspectRatio?: number | null;
  readonly rimInch?: number | null;
  readonly season?: SearchableSeason | null;
  readonly brand?: string | null;
  /** Only narrows when an approved brand-tier mapping exists. */
  readonly brandTier?: BrandTier | null;
  readonly sort?: CustomerSort;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CustomerCatalogueResult {
  readonly offers: readonly CustomerTyreOffer[];
  /** Products GommaRush will actually offer. Not "products that matched". */
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: CustomerSort;
  readonly schemaAvailable: boolean;
  /** Set when the selection was too large to page correctly. */
  readonly refused: SortRefusal | null;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 24;

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit as number), 1), MAX_LIMIT);
}

/**
 * The offer a customer is quoted for one tyre.
 *
 * Cheapest SELLABLE offer, chosen across every supplier lane that stocks the
 * product. An unsellable offer is not a cheaper alternative — the selling
 * policy already refused it — so it can never win here.
 */
function bestSellableOffer(row: CatalogueRow): SupplierOffer | null {
  let best: SupplierOffer | null = null;
  for (const offer of row.offers) {
    if (!offer.sellable) continue;
    const net = offer.pricing.tyreSaleNetCents;
    if (net === null) continue;
    const bestNet = best?.pricing.tyreSaleNetCents ?? null;
    if (best === null || bestNet === null || net < bestNet) best = offer;
  }
  return best;
}

function availabilityOf(offer: SupplierOffer): AvailabilityView {
  if (offer.stockExact !== null && offer.stockExact > 0) return "in_stock";
  if (offer.stockMinimum !== null && offer.stockMinimum > 0) return "in_stock";
  if (offer.stockRaw !== null && offer.stockRaw.trim() !== "") return "on_request";
  return "unknown";
}

/**
 * Narrows a chosen offer to the customer projection.
 *
 * Goes through `toCustomerOffer`, the same audited narrowing the rest of the
 * system uses, rather than assembling a customer object by hand. A hand-built
 * one is where a supplier field eventually gets added "just for debugging".
 */
function projectForCustomer(row: CatalogueRow, offer: SupplierOffer): CustomerTyreOffer {
  return toCustomerOffer({
    tyre: { ...row.product, oldDot: offer.oldDot },
    availability: availabilityOf(offer),
    // Present because PricedListing carries them; discarded by toCustomerOffer,
    // which is the point of routing through it.
    supplierListingId: offer.listingId,
    supplierName: offer.supplierName,
    supplierArticleId: offer.supplierArticleId,
    costObservedAt: offer.observedAt,
    breakdown: offer.pricing,
    supplierStockExact: offer.stockExact,
    supplierStockMinimum: offer.stockMinimum,
    supplierStockRaw: offer.stockRaw,
    sellability: {
      sellable: offer.sellable,
      reason: offer.sellabilityReason,
      assessedQuantity: offer.stockExact ?? offer.stockMinimum,
      minimumApplied: 0,
    },
  });
}

interface RankedOffer {
  readonly offer: CustomerTyreOffer;
  readonly netCents: number;
}

/**
 * Deterministic order over the WHOLE offerable selection.
 *
 * Every comparator falls through to brand, then model, then product id, so two
 * tyres at the same price come back in the same order on every request and a
 * page boundary cannot drift between page one and page two.
 */
function sortOffers(entries: RankedOffer[], sort: CustomerSort): RankedOffer[] {
  const byName = (a: RankedOffer, b: RankedOffer): number => {
    const brand = (a.offer.tyre.brand ?? "").localeCompare(b.offer.tyre.brand ?? "");
    if (brand !== 0) return brand;
    const model = (a.offer.tyre.modelPattern ?? "").localeCompare(b.offer.tyre.modelPattern ?? "");
    if (model !== 0) return model;
    return a.offer.tyre.productId.localeCompare(b.offer.tyre.productId);
  };

  const sorted = [...entries];
  if (sort === "price_asc") sorted.sort((a, b) => a.netCents - b.netCents || byName(a, b));
  else sorted.sort(byName);
  return sorted;
}

export async function searchCustomerCatalogue(
  query: CustomerCatalogueQuery = {},
  settings: PricingSettings = DEFAULT_PRICING_SETTINGS,
  sellingPolicy: SellingPolicy = DEFAULT_SELLING_POLICY,
  now: Date = new Date()
): Promise<CustomerCatalogueResult> {
  const limit = clampLimit(query.limit);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
  const sort: CustomerSort = query.sort ?? "price_asc";

  const browseQuery: CatalogueBrowseQuery = {
    widthMm: query.widthMm ?? null,
    aspectRatio: query.aspectRatio ?? null,
    rimInch: query.rimInch ?? null,
    season: query.season ?? null,
    brand: query.brand ?? null,
    brandTier: query.brandTier ?? null,
    // A customer browses everything GommaRush can sell, not one supplier's
    // shelf. Lane is a sourcing concept and must never reach this audience.
    lane: null,
    vehicle: "all",
    limit: OFFER_SORT_MAX_PRODUCTS,
  };

  const selection = await selectCatalogueRows(browseQuery, settings, sellingPolicy, now);

  if (selection.kind === "schema_missing") {
    return { offers: [], total: 0, limit, offset, sort, schemaAvailable: false, refused: null };
  }
  if (selection.kind === "refused") {
    return {
      offers: [], total: 0, limit, offset, sort, schemaAvailable: true,
      refused: selection.refusal,
    };
  }

  const ranked: RankedOffer[] = [];
  for (const row of selection.rows) {
    // A tier filter that matched nothing would be indistinguishable from an
    // empty catalogue, so it only narrows where an approved mapping exists.
    if (query.brandTier && tierForBrand(row.product.brand) !== query.brandTier) continue;

    const best = bestSellableOffer(row);
    if (!best) continue;

    const offer = projectForCustomer(row, best);
    if (offer.tyreSaleNetCents === null) continue;
    ranked.push({ offer, netCents: offer.tyreSaleNetCents });
  }

  const ordered = sortOffers(ranked, sort);

  return {
    // The total is the number of tyres the customer can actually buy, counted
    // after the sellability filter — not the number of products that matched
    // the size, which would promise results the next page cannot deliver.
    offers: ordered.slice(offset, offset + limit).map((entry) => entry.offer),
    total: ordered.length,
    limit,
    offset,
    sort,
    schemaAvailable: true,
    refused: null,
  };
}

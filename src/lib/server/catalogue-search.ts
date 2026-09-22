import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { isMissingSchemaError } from "@/lib/server/schema-errors";
import { logError } from "@/lib/logger";
import { DEFAULT_PRICING_SETTINGS, type PricingSettings } from "@/lib/pricing/settings";
import { calculateTyrePrice } from "@/lib/pricing/calculate";
import { resolvePfu } from "@/lib/pricing/pfu";
import { laneForAdapter } from "@/lib/catalogue/supplier-lanes";
import {
  assessSellability,
  DEFAULT_SELLING_POLICY,
  type SellingPolicy,
} from "@/lib/commerce/selling-policy";
import {
  toCustomerOffer,
  toInternalOffer,
  type AvailabilityView,
  type CustomerTyreOffer,
  type InternalTyreOffer,
  type PricedListing,
  type TyreSpecView,
} from "@/lib/pricing/projection";

/**
 * Tyre search over the existing normalised catalogue.
 *
 * Reuses catalogue_products / supplier_product_listings / supplier_listing_prices
 * as they stand. It deliberately builds NO parallel product table: a second
 * catalogue would immediately disagree with the first about what a tyre is.
 *
 * The search returns SUPPLIER LISTINGS, not products. One tyre may be listed
 * twice by the same supplier — new stock and old-DOT stock — at two different
 * costs, and collapsing those to one row would hide the cheaper option and
 * misprice the other. Identity here is the listing, which is also what a
 * sourcing decision and a purchase order will later attach to.
 *
 * Pricing is applied ABOVE this layer's data access and below its projections,
 * so the same rows can be served to an operator with full cost visibility or
 * to a customer with none, from one query.
 *
 * SCOPE, since M11B: this module owns the LISTING-level read and the
 * customer/internal projection pair. The admin browse workspace is
 * src/lib/server/catalogue-browse.ts, which reads the same tables rooted at
 * catalogue_products so it can paginate and group canonically. They are two
 * reads of ONE catalogue, not two catalogues — nothing here is duplicated
 * there, and the pricing engine and selling policy are shared.
 */

/** Season values the catalogue actually holds, verified against the data. */
export const SEARCHABLE_SEASONS = ["summer", "winter", "all_season"] as const;
export type SearchableSeason = (typeof SEARCHABLE_SEASONS)[number];

export function isSearchableSeason(value: unknown): value is SearchableSeason {
  return typeof value === "string" && (SEARCHABLE_SEASONS as readonly string[]).includes(value);
}

export interface CatalogueSearchQuery {
  widthMm?: number | null;
  aspectRatio?: number | null;
  rimInch?: number | null;
  season?: SearchableSeason | null;
  brand?: string | null;
  /** Exact canonical product for server-side basket/checkout revalidation. */
  productId?: string | null;
  /** Preserve the customer-visible stock condition when revalidating. */
  oldDot?: boolean | null;
  /** Page size. Clamped; a search is a preview, not an export. */
  limit?: number;
  offset?: number;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/** Columns of the tyre itself. Safe for either audience. */
const PRODUCT_COLUMNS = [
  "id",
  "brand",
  "model_pattern",
  "description",
  "size_display",
  "width_mm",
  "aspect_ratio",
  "rim_inch",
  "load_index",
  "speed_rating",
  "load_speed_raw",
  "season",
  "product_class",
  "xl",
  "run_flat",
  "old_dot",
  "eprel_id",
  "weight_kg",
  "active",
].join(", ");

interface PriceRow {
  purchase_price: number | string | null;
  currency: string | null;
  stock_raw: string | null;
  stock_exact: number | null;
  stock_minimum: number | null;
  observed_at: string | null;
}

interface ListingRow {
  id: string;
  supplier_article_id: string | null;
  old_dot: boolean | null;
  catalogue_products: Record<string, unknown> | null;
  suppliers: { name: string | null } | null;
  catalogue_import_runs: { adapter: string | null } | null;
  supplier_listing_prices: PriceRow[] | null;
}

function toTyreSpec(product: Record<string, unknown>, listingOldDot: boolean): TyreSpecView {
  return {
    productId: String(product.id ?? ""),
    brand: (product.brand as string | null) ?? null,
    modelPattern: (product.model_pattern as string | null) ?? null,
    description: (product.description as string | null) ?? null,
    sizeDisplay: (product.size_display as string | null) ?? null,
    widthMm: (product.width_mm as number | null) ?? null,
    aspectRatio: (product.aspect_ratio as number | null) ?? null,
    rimInch: (product.rim_inch as number | null) ?? null,
    loadIndex: (product.load_index as string | null) ?? null,
    speedRating: (product.speed_rating as string | null) ?? null,
    loadSpeedRaw: (product.load_speed_raw as string | null) ?? null,
    season: (product.season as string | null) ?? null,
    productClass: (product.product_class as string | null) ?? null,
    xl: (product.xl as boolean | null) ?? null,
    runFlat: (product.run_flat as boolean | null) ?? null,
    // Old DOT is a property of the LISTING (that batch of stock), not of the
    // tyre design. The product flag is kept in step by the importer, but the
    // listing is the authority here.
    oldDot: listingOldDot,
    eprelId: (product.eprel_id as string | null) ?? null,
  };
}

/**
 * Turns supplier stock data into something we are willing to say out loud.
 *
 * The ISB catalogue currently carries no stock at all, so this answers
 * "unknown" for every row today. Where a figure does exist it is treated as a
 * signal of availability, never republished as a quantity: ISB ships
 * thresholds ('>20') and the Deldo sample is banded between 3 and 100, so
 * neither is a count a customer could rely on.
 */
function toAvailability(price: PriceRow | null): AvailabilityView {
  if (!price) return "unknown";
  if (price.stock_exact !== null && price.stock_exact > 0) return "in_stock";
  if (price.stock_minimum !== null && price.stock_minimum > 0) return "in_stock";
  if (price.stock_raw !== null && price.stock_raw.trim() !== "") return "on_request";
  return "unknown";
}

/**
 * Supplier cost in integer cents.
 *
 * `purchase_price` is numeric(12,4) and arrives from PostgREST as a string or
 * a number depending on driver version. It is parsed through the string form
 * either way so a value like 61.2350 cannot pick up a float artefact, and
 * anything unparseable resolves to null — which downstream means "no price",
 * never "free".
 */
function toCostCents(price: PriceRow | null): number | null {
  if (!price || price.purchase_price === null || price.purchase_price === undefined) return null;
  const numeric = Number(price.purchase_price);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100);
}

export interface CatalogueSearchResult {
  /** Listings priced and expanded for an authorized operator. */
  internal: InternalTyreOffer[];
  /** The same listings narrowed to what a customer may see. */
  customer: CustomerTyreOffer[];
  /** True when the catalogue tables are not present in this environment. */
  schemaAvailable: boolean;
  settings: PricingSettings;
  sellingPolicy: SellingPolicy;
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? NaN)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit as number), 1), MAX_LIMIT);
}

async function fetchListings(query: CatalogueSearchQuery): Promise<ListingRow[] | null> {
  const supabase = createSupabaseAdminClient();

  let request = supabase
    .from("supplier_product_listings")
    .select(
      `id, supplier_article_id, old_dot,
       catalogue_products!inner(${PRODUCT_COLUMNS}),
       suppliers(name),
       catalogue_import_runs(adapter),
       supplier_listing_prices(purchase_price, currency, stock_raw, stock_exact, stock_minimum, observed_at)`
    )
    .eq("active", true)
    .eq("catalogue_products.active", true);

  if (query.widthMm != null) request = request.eq("catalogue_products.width_mm", query.widthMm);
  if (query.aspectRatio != null)
    request = request.eq("catalogue_products.aspect_ratio", query.aspectRatio);
  if (query.rimInch != null) request = request.eq("catalogue_products.rim_inch", query.rimInch);
  if (query.season) request = request.eq("catalogue_products.season", query.season);
  if (query.brand) request = request.eq("catalogue_products.brand", query.brand);
  if (query.productId) request = request.eq("catalogue_products.id", query.productId);
  if (query.oldDot != null) request = request.eq("old_dot", query.oldDot);

  const limit = clampLimit(query.limit);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);

  const { data, error } = await request
    // Only the most recent observation matters; older ones are history. Sorted
    // and limited in the database rather than fetching every price row ever
    // recorded for a listing and discarding them here.
    .order("observed_at", { referencedTable: "supplier_listing_prices", ascending: false })
    .limit(1, { referencedTable: "supplier_listing_prices" })
    // Parent ordering is by the listing's own id, which is stable and makes
    // pagination correct. It is NOT the display order: PostgREST cannot order
    // parent rows by an embedded table's column, so presentation sorting
    // happens after the fetch. Once supplier costs exist, ordering by cheapest
    // becomes the useful default and belongs in SQL, not here.
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    if (isMissingSchemaError(error)) {
      logError("catalogue_search_schema_missing", error);
      return null;
    }
    throw error;
  }

  return (data ?? []) as unknown as ListingRow[];
}

/**
 * Searches the catalogue and prices every result.
 *
 * Both projections are built from the SAME priced listing, so an operator and
 * a customer can never be looking at prices derived differently — the only
 * difference between them is which fields exist on the object.
 */
export async function searchCatalogue(
  query: CatalogueSearchQuery,
  settings: PricingSettings = DEFAULT_PRICING_SETTINGS,
  sellingPolicy: SellingPolicy = DEFAULT_SELLING_POLICY
): Promise<CatalogueSearchResult> {
  const rows = await fetchListings(query);

  if (rows === null) {
    return { internal: [], customer: [], schemaAvailable: false, settings, sellingPolicy };
  }

  const priced: PricedListing[] = [];

  for (const row of rows) {
    const product = row.catalogue_products;
    if (!product) continue;

    const price = row.supplier_listing_prices?.[0] ?? null;
    const supplierCostCents = toCostCents(price);

    // PFU is resolved per listing rather than once per search: a supplier may
    // state an exact PFU for one article and not another, and today's uniform
    // TO_CONFIRM is a fact about the data, not a shortcut worth baking in.
    const pfu = resolvePfu({
      weightKg: (product.weight_kg as number | null) ?? null,
      productClass: (product.product_class as string | null) ?? null,
    });

    const stockExact = price?.stock_exact ?? null;
    const stockMinimum = price?.stock_minimum ?? null;

    // The offer decision is taken here, once, against the supplier's real
    // figures — and it changes NOTHING about them. A listing showing 3 keeps
    // showing 3 internally; it simply does not reach the customer projection.
    // The lane comes from the adapter that wrote this listing, never from a
    // constant. Hard-coding "intersprint" was true while Inter-Sprint was the
    // only supplier with data and would have silently applied its offer policy
    // to every other lane the moment a second one had any.
    const laneCode = laneForAdapter(row.catalogue_import_runs?.adapter ?? null);

    const sellability = assessSellability(
      { stock: { stockExact, stockMinimum }, laneCode },
      sellingPolicy
    );

    priced.push({
      tyre: toTyreSpec(product, row.old_dot === true),
      availability: toAvailability(price),
      supplierListingId: row.id,
      supplierName: row.suppliers?.name ?? null,
      supplierArticleId: row.supplier_article_id ?? null,
      costObservedAt: price?.observed_at ?? null,
      breakdown: calculateTyrePrice({ supplierCostCents, pfu }, settings),
      supplierStockExact: stockExact,
      supplierStockMinimum: stockMinimum,
      supplierStockRaw: price?.stock_raw ?? null,
      sellability,
    });
  }

  // Presentation order: brand, then pattern, then size. Applied to the fetched
  // page rather than in SQL, for the reason given in fetchListings.
  priced.sort((a, b) => {
    const byBrand = (a.tyre.brand ?? "").localeCompare(b.tyre.brand ?? "");
    if (byBrand !== 0) return byBrand;
    const byModel = (a.tyre.modelPattern ?? "").localeCompare(b.tyre.modelPattern ?? "");
    if (byModel !== 0) return byModel;
    return (a.tyre.sizeDisplay ?? "").localeCompare(b.tyre.sizeDisplay ?? "");
  });

  return {
    // The operator sees everything, including what is suppressed and why.
    internal: priced.map(toInternalOffer),
    // The customer sees only what GommaRush is willing to offer. Filtering
    // here rather than in the UI means a future export, feed or API cannot
    // accidentally publish a listing the policy excluded.
    customer: priced.filter((row) => row.sellability.sellable).map(toCustomerOffer),
    schemaAvailable: true,
    settings,
    sellingPolicy,
  };
}

export interface CatalogueFacets {
  widths: number[];
  aspectRatios: number[];
  rims: number[];
  schemaAvailable: boolean;
}

/**
 * The distinct dimensions present in the catalogue, for the search selectors.
 *
 * Offering only sizes that exist means a search can always return something.
 * A free-text width box would let an operator type 215 and get an empty result
 * without knowing whether the tyre is absent or the catalogue is.
 */
export async function getCatalogueFacets(): Promise<CatalogueFacets> {
  const supabase = createSupabaseAdminClient();

  try {
    const { data, error } = await supabase
      .from("catalogue_products")
      .select("width_mm, aspect_ratio, rim_inch")
      .eq("active", true)
      .not("width_mm", "is", null)
      .not("aspect_ratio", "is", null)
      .not("rim_inch", "is", null)
      .limit(20000);

    if (error) {
      if (isMissingSchemaError(error)) {
        logError("catalogue_facets_schema_missing", error);
        return { widths: [], aspectRatios: [], rims: [], schemaAvailable: false };
      }
      throw error;
    }

    const widths = new Set<number>();
    const aspectRatios = new Set<number>();
    const rims = new Set<number>();

    for (const row of (data ?? []) as { width_mm: number; aspect_ratio: number; rim_inch: number }[]) {
      widths.add(row.width_mm);
      aspectRatios.add(row.aspect_ratio);
      rims.add(row.rim_inch);
    }

    const ascending = (a: number, b: number) => a - b;
    return {
      widths: [...widths].sort(ascending),
      aspectRatios: [...aspectRatios].sort(ascending),
      rims: [...rims].sort(ascending),
      schemaAvailable: true,
    };
  } catch (error) {
    logError("catalogue_facets_failed", error);
    throw error;
  }
}

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { isMissingSchemaError } from "@/lib/server/schema-errors";
import { logError } from "@/lib/logger";
import { DEFAULT_PRICING_SETTINGS, type PricingSettings } from "@/lib/pricing/settings";
import { calculateTyrePrice, type PriceBreakdown } from "@/lib/pricing/calculate";
import { resolvePfu } from "@/lib/pricing/pfu";
import {
  assessSellability,
  DEFAULT_SELLING_POLICY,
  type SellabilityDecision,
  type SellingPolicy,
} from "@/lib/commerce/selling-policy";
import { laneForAdapter, type LaneCode } from "@/lib/catalogue/supplier-lanes";
import {
  classifyVehicle,
  deriveListingState,
  productClassesFor,
  type ListingState,
  type VehicleClass,
} from "@/lib/catalogue/listing-state";
import { brandsInTier, isBrandTier, type BrandTier } from "@/lib/catalogue/brand-tiers";
import {
  isDatabaseNativeSort,
  OFFER_SORT_MAX_PRODUCTS,
  sortRows,
  type CatalogueSort,
} from "@/lib/catalogue/catalogue-sort";
import type { TyreSpecView } from "@/lib/pricing/projection";

// The admin Catalogue workspace: browse tyres, compare supplier offers.
//
// Built ON the existing normalised catalogue, not beside it. The tables, the
// identity rules and the pricing engine are all the ones that were already
// there; what is new is the shape of the read.
//
// THE STRUCTURAL CHANGE FROM catalogue-search.ts: the query is rooted at
// catalogue_products rather than at supplier_product_listings. That buys three
// things the listing-rooted version could not have:
//
//   * DATABASE-CORRECT PAGINATION. Ordering by brand now happens in SQL on an
//     indexed column of the root table. The old version ordered the page by
//     listing id and then sorted that page by brand in JavaScript, which
//     produces a *locally* sorted page in a globally unsorted sequence — page
//     2 could contain brands that belong on page 1.
//   * CANONICAL GROUPING FOR FREE. One display row is one catalogue_product_id
//     because the product IS the row, so comparison never needs to merge
//     anything by brand/size similarity.
//   * FACETS FROM THE INDEXED TUPLE. width/aspect/rim/season live on the root.
//
// Reads are split into three narrow queries rather than one deep embed:
// products (paginated), then their listings with the latest observation, then
// open conflicts. Each uses an index that already exists, and none depends on
// PostgREST ordering a parent by a nested table's column.

export const SEARCHABLE_SEASONS = ["summer", "winter", "all_season"] as const;
export type SearchableSeason = (typeof SEARCHABLE_SEASONS)[number];

export function isSearchableSeason(value: unknown): value is SearchableSeason {
  return typeof value === "string" && (SEARCHABLE_SEASONS as readonly string[]).includes(value);
}

export type VehicleFilter = "car_van" | "truck" | "all";

export interface CatalogueBrowseQuery {
  /** Restrict to one supplier lane. Null means compare across all of them. */
  readonly lane?: LaneCode | null;
  readonly vehicle?: VehicleFilter;
  /** Only products the catalogue has flagged as incomplete. */
  readonly needsReviewOnly?: boolean;
  readonly widthMm?: number | null;
  readonly aspectRatio?: number | null;
  readonly rimInch?: number | null;
  readonly season?: SearchableSeason | null;
  readonly brand?: string | null;
  /** EAN, model/pattern or supplier article. Exact-ish, never fuzzy. */
  readonly search?: string | null;
  /**
   * Products resolved from an exact supplier-article match, filled in by
   * browseCatalogue before the page query. Internal; callers do not set it.
   */
  readonly searchProductIds?: readonly string[];
  /** Commercial brand tier. Only narrows when an approved mapping exists. */
  readonly brandTier?: BrandTier | null;
  /** Display order. Offer-derived orders need a narrowed selection. */
  readonly sort?: CatalogueSort;
  readonly limit?: number;
  readonly offset?: number;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
/** Facet lists are for choosing, not browsing; a long one is unusable anyway. */
const MAX_FACET_VALUES = 400;

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
  "ean",
  "review_required",
  "review_reasons",
].join(", ");

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface ProductRow {
  id: string;
  brand: string | null;
  model_pattern: string | null;
  description: string | null;
  size_display: string | null;
  width_mm: number | null;
  aspect_ratio: number | null;
  rim_inch: number | null;
  load_index: string | null;
  speed_rating: string | null;
  load_speed_raw: string | null;
  season: string | null;
  product_class: string | null;
  xl: boolean | null;
  run_flat: boolean | null;
  old_dot: boolean | null;
  eprel_id: string | null;
  weight_kg: number | string | null;
  ean: string | null;
  review_required: boolean | null;
  review_reasons: string[] | null;
}

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
  catalogue_product_id: string;
  supplier_article_id: string | null;
  supplier_item_code: string | null;
  old_dot: boolean | null;
  suppliers: { id: string; name: string | null } | null;
  catalogue_import_runs: { adapter: string | null; notes: string | null } | null;
  supplier_listing_prices: PriceRow[] | null;
}

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

/** One supplier's offer of one tyre, as an operator sees it. INTERNAL ONLY. */
export interface SupplierOffer {
  readonly listingId: string;
  readonly laneCode: LaneCode | null;
  readonly supplierId: string | null;
  /** The supplier row's current name. May still be a placeholder. */
  readonly supplierName: string | null;
  readonly supplierArticleId: string | null;
  readonly supplierItemCode: string | null;

  readonly state: ListingState;
  readonly vehicle: VehicleClass;

  readonly purchasePriceCents: number | null;
  readonly currency: string | null;
  /** Exact where the supplier gave a count; null for a band. Never resolved. */
  readonly stockExact: number | null;
  readonly stockMinimum: number | null;
  readonly stockRaw: string | null;
  readonly observedAt: string | null;
  readonly ageMs: number | null;

  readonly sellable: boolean;
  readonly sellabilityReason: SellabilityDecision["reason"];

  /** Secondary. PFU is unresolved, so no customer total is ever produced. */
  readonly pricing: PriceBreakdown;
  readonly oldDot: boolean;
}

/** One canonical tyre with every supplier offer of it grouped underneath. */
export interface CatalogueRow {
  readonly product: TyreSpecView & {
    readonly ean: string | null;
    readonly weightKg: number | null;
    readonly reviewRequired: boolean;
    readonly reviewReasons: readonly string[];
  };
  readonly vehicle: VehicleClass;
  readonly offers: readonly SupplierOffer[];
  readonly hasOpenConflict: boolean;
  /** The best state across the offers, for a single row-level badge. */
  readonly state: ListingState;
}

export interface CatalogueFacets {
  readonly widths: readonly number[];
  readonly aspectRatios: readonly number[];
  readonly rims: readonly number[];
  readonly seasons: readonly string[];
  readonly brands: readonly string[];
}

/** Why an offer-derived sort could not be honoured. */
export type SortRefusal = {
  readonly reason: "selection_too_large";
  readonly matched: number;
  readonly maximum: number;
};

export interface CatalogueBrowseResult {
  readonly rows: readonly CatalogueRow[];
  /** Total canonical products matching, for correct pagination controls. */
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly schemaAvailable: boolean;
  readonly settings: PricingSettings;
  readonly sellingPolicy: SellingPolicy;
  /** The order actually applied. May differ from the one requested. */
  readonly sort: CatalogueSort;
  /**
   * Set when an offer-derived sort was refused and the default was used
   * instead. Surfaced rather than silently substituted: a page that claims to
   * be cheapest-first and is not is worse than one that says why it cannot be.
   */
  readonly sortRefused: SortRefusal | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? NaN)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit as number), 1), MAX_LIMIT);
}

function toCostCents(price: PriceRow | null): number | null {
  if (!price || price.purchase_price === null || price.purchase_price === undefined) return null;
  const numeric = Number(price.purchase_price);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100);
}

/** `category=pcr|truck` as the feed worker recorded it on the import run. */
const CATEGORY_NOTE_PREFIX = "intersprint-feed:category=";

function feedCategoryOf(run: { adapter: string | null; notes: string | null } | null): string | null {
  const notes = run?.notes ?? "";
  return notes.startsWith(CATEGORY_NOTE_PREFIX)
    ? notes.slice(CATEGORY_NOTE_PREFIX.length).trim()
    : null;
}

function toProductView(row: ProductRow): CatalogueRow["product"] {
  return {
    productId: row.id,
    brand: row.brand,
    modelPattern: row.model_pattern,
    description: row.description,
    sizeDisplay: row.size_display,
    widthMm: row.width_mm,
    aspectRatio: row.aspect_ratio,
    rimInch: row.rim_inch,
    loadIndex: row.load_index,
    speedRating: row.speed_rating,
    loadSpeedRaw: row.load_speed_raw,
    season: row.season,
    productClass: row.product_class,
    xl: row.xl,
    runFlat: row.run_flat,
    oldDot: row.old_dot === true,
    eprelId: row.eprel_id,
    ean: row.ean,
    weightKg: row.weight_kg === null || row.weight_kg === undefined ? null : Number(row.weight_kg),
    reviewRequired: row.review_required === true,
    reviewReasons: row.review_reasons ?? [],
  };
}

/**
 * Applies the filters that live on catalogue_products.
 *
 * Shared by the page query, the count query and every facet query, so a facet
 * can never disagree with the results it is meant to describe.
 */
function applyProductFilters<
  T extends { eq: (c: string, v: unknown) => T; or: (f: string) => T }
>(
  request: T,
  query: CatalogueBrowseQuery
): T {
  let out = request;
  if (query.widthMm != null) out = out.eq("width_mm", query.widthMm);
  if (query.aspectRatio != null) out = out.eq("aspect_ratio", query.aspectRatio);
  if (query.rimInch != null) out = out.eq("rim_inch", query.rimInch);
  if (query.season) out = out.eq("season", query.season);
  if (query.brand) out = out.eq("brand", query.brand);
  if (query.needsReviewOnly) out = out.eq("review_required", true);

  // A tier narrows to its approved brands. With no approved mapping the list
  // is empty, and an empty tier must match NOTHING rather than everything —
  // silently ignoring the filter would show premium and value as identical.
  if (query.brandTier && isBrandTier(query.brandTier)) {
    const brands = brandsInTier(query.brandTier);
    out = brands.length > 0
      ? (out as unknown as { in: (c: string, v: unknown[]) => typeof out }).in("brand", brands)
      : out.eq("brand", "\u0000__no_brand_is_classified__");
  }

  const term = query.search?.trim();
  if (term) {
    // Exact on identifiers, prefix on the pattern. Deliberately NOT a fuzzy
    // match: two tyres whose model codes merely look alike are two tyres, and
    // the truncated `Type` field makes near-matches actively misleading.
    const escaped = term.replace(/[%,()]/g, "");
    if (query.searchProductIds && query.searchProductIds.length > 0) {
      // The term also matched a supplier article, so those products join the
      // result by id alongside the root matches.
      const ids = query.searchProductIds.join(",");
      out = out.or(`ean.eq.${escaped},model_pattern.ilike.${escaped}%,id.in.(${ids})`);
    } else {
      out = out.or(`ean.eq.${escaped},model_pattern.ilike.${escaped}%`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

interface RunRow {
  id: string;
  adapter: string | null;
  notes: string | null;
}

export interface RunIndex {
  /** Run ids whose adapter belongs to a lane. */
  readonly byLane: ReadonlyMap<LaneCode, string[]>;
  /** Run ids whose recorded feed category resolves to a vehicle class. */
  readonly byVehicle: ReadonlyMap<VehicleClass, string[]>;
  /** Runs that recorded no category, so their listings fall back to class. */
  readonly uncategorised: readonly string[];
}

/**
 * Indexes the import runs so lane and vehicle become filters on a COLUMN.
 *
 * This is what makes membership database-correct. Lane lives on the run's
 * adapter and vehicle on its category note, neither of which PostgREST can
 * filter a product by — but `supplier_product_listings.last_import_run_id` is
 * a plain indexed column, and a run id set is something a query can use.
 *
 * The table is tiny (three rows in production, one per import) and read once
 * per request.
 */
export async function loadRunIndex(): Promise<RunIndex> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("catalogue_import_runs")
    .select("id, adapter, notes");

  if (error) {
    if (isMissingSchemaError(error)) {
      return { byLane: new Map(), byVehicle: new Map(), uncategorised: [] };
    }
    throw error;
  }

  const byLane = new Map<LaneCode, string[]>();
  const byVehicle = new Map<VehicleClass, string[]>();
  const uncategorised: string[] = [];

  for (const run of (data ?? []) as unknown as RunRow[]) {
    const lane = laneForAdapter(run.adapter);
    if (lane) byLane.set(lane, [...(byLane.get(lane) ?? []), run.id]);

    const category = feedCategoryOf({ adapter: run.adapter, notes: run.notes });
    if (category) {
      const vehicle = classifyVehicle({ feedCategory: category, productClass: null });
      byVehicle.set(vehicle, [...(byVehicle.get(vehicle) ?? []), run.id]);
    } else {
      uncategorised.push(run.id);
    }
  }

  return { byLane, byVehicle, uncategorised };
}

/**
 * The run ids a lane/vehicle selection admits, or null for "no constraint".
 *
 * An empty array is NOT the same as null: a lane with no imports must match
 * nothing, exactly as an unpopulated brand tier does. Returning null there
 * would show every product under an empty supplier tab.
 */
export function allowedRunIds(
  index: RunIndex,
  lane: LaneCode | null | undefined,
  vehicle: VehicleFilter | undefined
): string[] | null {
  const laneRuns = lane ? (index.byLane.get(lane) ?? []) : null;

  let vehicleRuns: string[] | null = null;
  if (vehicle === "truck" || vehicle === "car_van") {
    // Categorised runs state the vehicle outright. Uncategorised ones are
    // admitted too, because their listings fall back to product_class — which
    // the caller pairs with a root-level class filter.
    vehicleRuns = [...(index.byVehicle.get(vehicle) ?? []), ...index.uncategorised];
  }

  if (laneRuns === null && vehicleRuns === null) return null;
  if (laneRuns === null) return vehicleRuns as string[];
  if (vehicleRuns === null) return laneRuns;

  const allowed = new Set(vehicleRuns);
  return laneRuns.filter((id) => allowed.has(id));
}

/**
 * The page of canonical products, ordered and paginated IN THE DATABASE.
 *
 * Lane, vehicle and article filters constrain the product set through an inner
 * embed on supplier_product_listings, which PostgREST resolves as a join — so
 * "Inter-Sprint winter tyres" is one indexed query, not a fetch-then-filter.
 */
async function fetchProductPage(
  query: CatalogueBrowseQuery,
  runIndex: RunIndex,
  materialiseAll = false
): Promise<{ rows: ProductRow[]; total: number } | null> {
  const supabase = createSupabaseAdminClient();
  const limit = clampLimit(query.limit);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);

  // Run ids are resolved BEFORE the query so lane and vehicle become filters
  // on an indexed column of the joined relation. With !inner, PostgREST turns
  // that into a join predicate, so it decides which PRODUCTS exist — and
  // therefore the count and the page boundaries — rather than being applied to
  // offers after a page has already been chosen.
  const runIds = allowedRunIds(runIndex, query.lane, query.vehicle);
  const needsListingJoin = runIds !== null;

  const embed = needsListingJoin
    ? `, supplier_product_listings!inner(id, active, last_import_run_id)`
    : "";

  let request = supabase
    .from("catalogue_products")
    .select(`${PRODUCT_COLUMNS}${embed}`, { count: "exact" })
    .eq("active", true);

  request = applyProductFilters(request as never, query) as never;

  if (needsListingJoin) {
    request = request.eq("supplier_product_listings.active", true);

    if (runIds.length === 0) {
      // A lane with no imports, or a vehicle no run can satisfy. Must match
      // NOTHING; an unconstrained join here would show the whole catalogue
      // under an empty supplier tab.
      request = (request as unknown as { in: (c: string, v: unknown[]) => typeof request }).in(
        "supplier_product_listings.last_import_run_id",
        ["00000000-0000-0000-0000-000000000000"]
      );
    } else {
      request = (request as unknown as { in: (c: string, v: unknown[]) => typeof request }).in(
        "supplier_product_listings.last_import_run_id",
        runIds
      );
    }

    // Uncategorised runs recorded no vehicle, so their listings fall back to
    // the product's own class. That fallback is a ROOT column, so it is
    // constrained here rather than after the fact.
    //
    // A product with NO class is admitted: every class in production was set
    // by the legacy import, so a class-less product can only have come from a
    // categorised run, which already stated its vehicle.
    if (
      (query.vehicle === "truck" || query.vehicle === "car_van") &&
      runIndex.uncategorised.length > 0
    ) {
      const classes = productClassesFor(query.vehicle);
      request = (request as unknown as { or: (f: string) => typeof request }).or(
        `product_class.in.(${classes.join(",")}),product_class.is.null`
      );
    }
  }

  const ordered = request
    // Ordering on indexed root columns. Stable through id so a page boundary
    // can never repeat or skip a row between requests.
    .order("brand", { ascending: true, nullsFirst: false })
    .order("model_pattern", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  // An offer-derived sort cannot be expressed here — the key lives on a
  // different table — so the whole filtered set is fetched and ordered above
  // the database. Bounded by the caller, which checks the count first.
  const { data, error, count } = materialiseAll
    ? await ordered.range(0, OFFER_SORT_MAX_PRODUCTS - 1)
    : await ordered.range(offset, offset + limit - 1);

  if (error) {
    if (isMissingSchemaError(error)) {
      logError("catalogue_browse_schema_missing", error);
      return null;
    }
    throw error;
  }

  return { rows: (data ?? []) as unknown as ProductRow[], total: count ?? 0 };
}

/**
 * Products whose supplier article matches the search term exactly.
 *
 * Bounded by construction: `(supplier_id, supplier_article_id)` is unique, so
 * an exact term resolves to at most one listing per supplier. This keeps
 * article search a real, database-side filter instead of the claim the join
 * used to make and not honour.
 */
async function resolveArticleProductIds(term: string): Promise<string[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("supplier_product_listings")
    .select("catalogue_product_id")
    .eq("supplier_article_id", term)
    .eq("active", true)
    .limit(50);

  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
  return [
    ...new Set(
      ((data ?? []) as { catalogue_product_id: string | null }[])
        .map((row) => row.catalogue_product_id)
        .filter((id): id is string => !!id)
    ),
  ];
}

/** Every active listing for the products on this page, with its latest price. */
async function fetchListingsFor(productIds: string[]): Promise<ListingRow[]> {
  if (productIds.length === 0) return [];
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("supplier_product_listings")
    .select(
      `id, catalogue_product_id, supplier_article_id, supplier_item_code, old_dot,
       suppliers(id, name),
       catalogue_import_runs(adapter, notes),
       supplier_listing_prices(purchase_price, currency, stock_raw, stock_exact, stock_minimum, observed_at)`
    )
    .in("catalogue_product_id", productIds)
    .eq("active", true)
    // ONE observation per listing. The index (supplier_listing_id,
    // observed_at DESC) makes this an ordered scan, and it is why browse never
    // loads a listing's whole price history.
    .order("observed_at", { referencedTable: "supplier_listing_prices", ascending: false })
    .limit(1, { referencedTable: "supplier_listing_prices" });

  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
  return (data ?? []) as unknown as ListingRow[];
}

/** Product ids on this page that carry an unresolved import conflict. */
async function fetchConflictedProductIds(productIds: string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("catalogue_conflicts")
    .select("catalogue_product_id")
    .in("catalogue_product_id", productIds)
    .eq("status", "open");

  if (error) {
    if (isMissingSchemaError(error)) return new Set();
    throw error;
  }
  return new Set(
    ((data ?? []) as { catalogue_product_id: string | null }[])
      .map((row) => row.catalogue_product_id)
      .filter((id): id is string => !!id)
  );
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function buildOffer(
  listing: ListingRow,
  product: ProductRow,
  hasOpenConflict: boolean,
  settings: PricingSettings,
  sellingPolicy: SellingPolicy,
  now: Date
): SupplierOffer {
  const price = listing.supplier_listing_prices?.[0] ?? null;
  const purchasePriceCents = toCostCents(price);
  const stockExact = price?.stock_exact ?? null;
  const stockMinimum = price?.stock_minimum ?? null;

  // THE FIX for the hard-coded lane: it comes from the adapter that wrote this
  // listing, so a second supplier's rows are never judged by Inter-Sprint's
  // policy.
  const laneCode = laneForAdapter(listing.catalogue_import_runs?.adapter ?? null);

  const sellability = assessSellability(
    { stock: { stockExact, stockMinimum }, laneCode },
    sellingPolicy
  );

  const observedAt = price?.observed_at ?? null;
  const ageMs = observedAt ? now.getTime() - new Date(observedAt).getTime() : null;

  return {
    listingId: listing.id,
    laneCode,
    supplierId: listing.suppliers?.id ?? null,
    supplierName: listing.suppliers?.name ?? null,
    supplierArticleId: listing.supplier_article_id ?? null,
    supplierItemCode: listing.supplier_item_code ?? null,
    state: deriveListingState({
      hasCurrentPrice: purchasePriceCents !== null,
      reviewRequired: product.review_required === true,
      hasOpenConflict,
    }),
    vehicle: classifyVehicle({
      feedCategory: feedCategoryOf(listing.catalogue_import_runs),
      productClass: product.product_class,
    }),
    purchasePriceCents,
    currency: price?.currency ?? null,
    stockExact,
    stockMinimum,
    stockRaw: price?.stock_raw ?? null,
    observedAt,
    ageMs: ageMs !== null && ageMs >= 0 ? ageMs : null,
    sellable: sellability.sellable,
    sellabilityReason: sellability.reason,
    pricing: calculateTyrePrice(
      { supplierCostCents: purchasePriceCents, pfu: resolvePfu({ weightKg: Number(product.weight_kg) || null }) },
      settings
    ),
    oldDot: listing.old_dot === true,
  };
}

/** The least reassuring state among a product's offers. */
function worstState(offers: readonly SupplierOffer[], hasOpenConflict: boolean): ListingState {
  if (hasOpenConflict) return "CONFLICT";
  if (offers.length === 0) return "NO_CURRENT_PRICE";
  if (offers.some((offer) => offer.state === "CURRENT")) return "CURRENT";
  if (offers.some((offer) => offer.state === "NEEDS_REVIEW")) return "NEEDS_REVIEW";
  return "NO_CURRENT_PRICE";
}

/**
 * Groups a page of products with their offers.
 *
 * Extracted so the customer catalogue can reuse the SAME row construction —
 * same pricing engine, same selling policy, same lane attribution — instead of
 * growing a second one that would drift. Callers differ only in which rows
 * they then keep and how they project them.
 */
async function buildCatalogueRows(
  products: readonly ProductRow[],
  query: CatalogueBrowseQuery,
  settings: PricingSettings,
  sellingPolicy: SellingPolicy,
  now: Date
): Promise<CatalogueRow[]> {
  const productIds = products.map((row) => row.id);
  const [listings, conflicted] = await Promise.all([
    fetchListingsFor(productIds),
    fetchConflictedProductIds(productIds),
  ]);

  const byProduct = new Map<string, ListingRow[]>();
  for (const listing of listings) {
    const bucket = byProduct.get(listing.catalogue_product_id);
    if (bucket) bucket.push(listing);
    else byProduct.set(listing.catalogue_product_id, [listing]);
  }

  return products.map((product) => {
    const hasOpenConflict = conflicted.has(product.id);
    let offers = (byProduct.get(product.id) ?? []).map((listing) =>
      buildOffer(listing, product, hasOpenConflict, settings, sellingPolicy, now)
    );

    // DISPLAY ONLY. Membership, the total and the page boundaries were all
    // decided by the run-id join in fetchProductPage; this narrows which
    // offers appear UNDER an already-correct row. It is not a substitute for
    // the join and must never become one — filtering here alone would page
    // over the wrong set, which is precisely the defect this replaced.
    if (query.lane) offers = offers.filter((offer) => offer.laneCode === query.lane);
    if (query.vehicle === "truck" || query.vehicle === "car_van") {
      offers = offers.filter((offer) => offer.vehicle === query.vehicle);
    }

    offers.sort((a, b) => {
      if (a.purchasePriceCents === null) return 1;
      if (b.purchasePriceCents === null) return -1;
      return a.purchasePriceCents - b.purchasePriceCents;
    });

    return {
      product: toProductView(product),
      vehicle:
        offers[0]?.vehicle ??
        classifyVehicle({ feedCategory: null, productClass: product.product_class }),
      offers,
      hasOpenConflict,
      state: worstState(offers, hasOpenConflict),
    };
  });
}

/**
 * Browses the catalogue, grouping supplier offers under canonical products.
 *
 * ONE ROW IS ONE catalogue_product_id — the identity the catalogue already
 * guarantees through its unique index on validated EAN and on product_key.
 * Two suppliers converge on a row only when they resolve to the same product.
 * Where they do not, they stay separate rows: merging on brand/size similarity
 * would silently claim two tyres are one.
 */
export async function browseCatalogue(
  query: CatalogueBrowseQuery = {},
  settings: PricingSettings = DEFAULT_PRICING_SETTINGS,
  sellingPolicy: SellingPolicy = DEFAULT_SELLING_POLICY,
  now: Date = new Date()
): Promise<CatalogueBrowseResult> {
  const limit = clampLimit(query.limit);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);

  const requestedSort: CatalogueSort = query.sort ?? "brand_asc";
  const offerDerived = !isDatabaseNativeSort(requestedSort);

  // Probe the size before materialising anything. One cheap count decides
  // between a normal paged read and the bounded whole-set read, so an
  // offer-derived sort over the entire catalogue is refused rather than
  // attempted and truncated.
  let sortRefused: SortRefusal | null = null;
  let materialise = offerDerived;

  const runIndex = await loadRunIndex();

  // Resolve a supplier-article match once, before any page query, so every
  // subsequent read (probe, page, facets) sees the same search scope.
  const term = query.search?.trim();
  const effectiveQuery: CatalogueBrowseQuery = term
    ? { ...query, searchProductIds: await resolveArticleProductIds(term) }
    : query;

  if (offerDerived) {
    const probe = await fetchProductPage({ ...effectiveQuery, limit: 1, offset: 0 }, runIndex);
    if (probe === null) {
      return {
        rows: [], total: 0, limit, offset, schemaAvailable: false,
        settings, sellingPolicy, sort: requestedSort, sortRefused: null,
      };
    }
    if (probe.total > OFFER_SORT_MAX_PRODUCTS) {
      sortRefused = {
        reason: "selection_too_large",
        matched: probe.total,
        maximum: OFFER_SORT_MAX_PRODUCTS,
      };
      materialise = false;
    }
  }

  const effectiveSort: CatalogueSort = sortRefused ? "brand_asc" : requestedSort;

  const page = await fetchProductPage(effectiveQuery, runIndex, materialise);
  if (page === null) {
    return {
      rows: [], total: 0, limit, offset,
      schemaAvailable: false, settings, sellingPolicy,
      sort: effectiveSort, sortRefused,
    };
  }

  const rows = await buildCatalogueRows(page.rows, query, settings, sellingPolicy, now);

  // A database-native order is already correct and is NOT re-sorted here;
  // re-sorting a page would reintroduce the local-order bug. Only the
  // materialised path sorts, and it sorts the whole filtered set before
  // slicing, so its pages are genuine slices of a globally ordered sequence.
  const finalRows = materialise
    ? sortRows(
        rows.map((row) => ({
          brand: row.product.brand,
          modelPattern: row.product.modelPattern,
          productId: row.product.productId,
          offers: row.offers,
          row,
        })),
        effectiveSort
      )
        .slice(offset, offset + limit)
        .map((entry) => entry.row)
    : rows;

  return {
    rows: finalRows,
    total: page.total,
    limit,
    offset,
    schemaAvailable: true,
    settings,
    sellingPolicy,
    sort: effectiveSort,
    sortRefused,
  };
}

/** The whole filtered selection, or a refusal when it is too large to hold. */
export type CatalogueSelection =
  | { readonly kind: "selection"; readonly rows: readonly CatalogueRow[]; readonly matched: number }
  | { readonly kind: "refused"; readonly refusal: SortRefusal }
  | { readonly kind: "schema_missing" };

/**
 * Materialises every product matching a query, bounded.
 *
 * Needed wherever a predicate cannot be pushed into the product query because
 * its key lives on the observation — an offer-derived sort, or the customer
 * catalogue's sellability filter. Both must see the WHOLE filtered set before
 * slicing, because paging first and filtering after produces pages of varying
 * size and, worse, a "cheapest" that is only the cheapest on the page.
 *
 * Above the cap the request is REFUSED rather than truncated, which is the
 * same honest failure the admin sort takes: "narrow your search" beats a page
 * that silently describes part of the catalogue as all of it.
 */
export async function selectCatalogueRows(
  query: CatalogueBrowseQuery = {},
  settings: PricingSettings = DEFAULT_PRICING_SETTINGS,
  sellingPolicy: SellingPolicy = DEFAULT_SELLING_POLICY,
  now: Date = new Date()
): Promise<CatalogueSelection> {
  const runIndex = await loadRunIndex();

  const term = query.search?.trim();
  const effectiveQuery: CatalogueBrowseQuery = term
    ? { ...query, searchProductIds: await resolveArticleProductIds(term) }
    : query;

  const probe = await fetchProductPage({ ...effectiveQuery, limit: 1, offset: 0 }, runIndex);
  if (probe === null) return { kind: "schema_missing" };

  if (probe.total > OFFER_SORT_MAX_PRODUCTS) {
    return {
      kind: "refused",
      refusal: {
        reason: "selection_too_large",
        matched: probe.total,
        maximum: OFFER_SORT_MAX_PRODUCTS,
      },
    };
  }

  const page = await fetchProductPage(effectiveQuery, runIndex, true);
  if (page === null) return { kind: "schema_missing" };

  const rows = await buildCatalogueRows(page.rows, query, settings, sellingPolicy, now);
  return { kind: "selection", rows, matched: probe.total };
}

/**
 * Facet values available UNDER THE CURRENT SELECTION.
 *
 * Dependent by construction: each facet is computed with every filter applied
 * except itself, so choosing width 205 narrows the rim list to rims that
 * actually exist in 205, and a combination that would return nothing is not
 * offered in the first place.
 */
export type CatalogueFacetField = keyof CatalogueFacets;

const ALL_FACET_FIELDS: readonly CatalogueFacetField[] = [
  "widths",
  "aspectRatios",
  "rims",
  "seasons",
  "brands",
];

export async function getCatalogueFacets(
  query: CatalogueBrowseQuery = {},
  runIndex?: RunIndex,
  /**
   * Which facets to actually read. Each one is its own scan, so a caller that
   * needs only the brand list should say so rather than paying for four
   * others it will discard — the customer catalogue fills its size selectors
   * from getTyreDimensions and wants exactly that. A field left out comes back
   * empty, never stale.
   */
  fields: readonly CatalogueFacetField[] = ALL_FACET_FIELDS
): Promise<CatalogueFacets & { schemaAvailable: boolean }> {
  const wanted = new Set(fields);
  const supabase = createSupabaseAdminClient();
  const index = runIndex ?? (await loadRunIndex());
  // Lane and vehicle constrain the facets too, through the same run-id join
  // the page query uses. Without this a supplier tab would offer widths that
  // exist only in another supplier's catalogue and return nothing when picked.
  const runIds = allowedRunIds(index, query.lane, query.vehicle);

  async function distinct<K extends keyof ProductRow>(
    column: K,
    omit: keyof CatalogueBrowseQuery
  ): Promise<unknown[]> {
    const scoped: CatalogueBrowseQuery = { ...query, [omit]: null };
    const embed = runIds !== null ? `, supplier_product_listings!inner(id)` : "";

    let request = supabase
      .from("catalogue_products")
      .select(`${column as string}${embed}`)
      .eq("active", true)
      .not(column as string, "is", null);
    request = applyProductFilters(request as never, scoped) as never;

    if (runIds !== null) {
      request = request.eq("supplier_product_listings.active", true);
      request = (request as unknown as { in: (c: string, v: unknown[]) => typeof request }).in(
        "supplier_product_listings.last_import_run_id",
        runIds.length > 0 ? runIds : ["00000000-0000-0000-0000-000000000000"]
      );
    }

    const { data, error } = await request.limit(20000);
    if (error) {
      if (isMissingSchemaError(error)) return [];
      throw error;
    }
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(
      (row) => row[column as string]
    );
  }

  const skip = Promise.resolve([] as unknown[]);

  try {
    const [widths, aspects, rims, seasons, brands] = await Promise.all([
      wanted.has("widths") ? distinct("width_mm", "widthMm") : skip,
      wanted.has("aspectRatios") ? distinct("aspect_ratio", "aspectRatio") : skip,
      wanted.has("rims") ? distinct("rim_inch", "rimInch") : skip,
      wanted.has("seasons") ? distinct("season", "season") : skip,
      wanted.has("brands") ? distinct("brand", "brand") : skip,
    ]);

    const numbers = (values: unknown[]) =>
      [...new Set(values.filter((v): v is number => typeof v === "number"))]
        .sort((a, b) => a - b)
        .slice(0, MAX_FACET_VALUES);
    const strings = (values: unknown[]) =>
      [...new Set(values.filter((v): v is string => typeof v === "string" && v !== ""))]
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_FACET_VALUES);

    return {
      widths: numbers(widths),
      aspectRatios: numbers(aspects),
      rims: numbers(rims),
      seasons: strings(seasons),
      brands: strings(brands),
      schemaAvailable: true,
    };
  } catch (error) {
    logError("catalogue_facets_failed", error);
    return { widths: [], aspectRatios: [], rims: [], seasons: [], brands: [], schemaAvailable: false };
  }
}

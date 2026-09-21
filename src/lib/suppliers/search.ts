/**
 * Unified internal supplier search.
 *
 * INTERNAL ONLY. Results carry supplier identity and supplier purchase cost,
 * which must never reach a customer-facing surface
 * (docs/architecture/01_SUPPLIER_ARCHITECTURE.md).
 *
 * This module shapes and ranks rows that ALREADY came from
 * `supplier_commercial_observations` — the database view that performs the
 * test-data exclusion. Shaping is pure and deterministic so it is fully
 * testable; nothing here computes a customer price.
 */

import { classifyFreshness, ageHours, type Freshness } from "./freshness";
import type {
  DeliveryClass,
  PfuStatus,
  SourceType,
  StockConfidence,
  StockStatus,
} from "./types";

/** A row as returned by public.supplier_commercial_observations. */
export interface CommercialObservationRow {
  observation_id: string;
  supplier_listing_id: string;
  supplier_id: string;
  lane_code: string | null;
  supplier_name: string;
  catalogue_product_id: string;
  supplier_article_id: string;
  supplier_listing_key: string;
  old_dot: boolean;
  purchase_price: number | string | null;
  currency: string;
  stock_exact: number | null;
  stock_raw: string | null;
  stock_status: StockStatus | null;
  stock_confidence: StockConfidence | null;
  lead_time_days: number | null;
  delivery_class: DeliveryClass | null;
  observed_at: string;
  price_verified_at: string | null;
  stock_verified_at: string | null;
  source_type: SourceType;
  pfu_amount: number | string | null;
  pfu_status: PfuStatus | null;
  pfu_source: string | null;
  dot_code: string | null;
  observed_by: string | null;
  observation_note: string | null;
  price_ttl_hours: number | null;
  stock_ttl_hours: number | null;
  stale_multiplier: number | string | null;
  /** Guard column. Any row arriving with true is a bug and is rejected. */
  is_test_data?: boolean;
}

export interface SourcingOption {
  laneCode: string | null;
  supplierName: string;
  supplierListingKey: string;
  supplierArticleId: string;
  oldDot: boolean;

  /** SUPPLIER COST, internal only. null = the lane did not supply a price. */
  purchasePriceNet: number | null;
  currency: string;
  /** True when this lane has no usable price - render as "no price", not 0. */
  priceUnavailable: boolean;

  stockExact: number | null;
  stockStatus: StockStatus;
  stockConfidence: StockConfidence;
  /** Operator-facing stock text that never implies more precision than exists. */
  stockLabel: string;

  leadTimeDays: number | null;
  deliveryClass: DeliveryClass;

  observedAt: string;
  ageHours: number | null;
  priceFreshness: Freshness;
  stockFreshness: Freshness;

  sourceType: SourceType;
  observedBy: string | null;

  pfuAmount: number | null;
  pfuStatus: PfuStatus;
  /** True when PFU is unresolved, so any derived total is provisional. */
  pfuProvisional: boolean;

  /** True when this option carries enough to be quoted at all. */
  quotable: boolean;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Stock text that never overstates precision.
 * A boolean-only or unknown-confidence figure is never rendered as a count.
 */
export function stockLabel(
  stockExact: number | null,
  status: StockStatus,
  confidence: StockConfidence,
): string {
  if (confidence === "exact" && stockExact !== null) return `${stockExact} in stock`;
  if (confidence === "approximate" && stockExact !== null) return `~${stockExact} in stock`;
  switch (status) {
    case "in_stock": return "In stock";
    case "low": return "Low stock";
    case "out_of_stock": return "Out of stock";
    case "on_request": return "On request";
    default: return "Stock unknown";
  }
}

/**
 * Shape one observation into an operator-facing sourcing option.
 *
 * Throws if a test-data row reaches this function. That is deliberate: the
 * exclusion is a query boundary, and a breach is a defect that must fail loudly
 * rather than silently price fictional stock.
 */
export function toSourcingOption(
  row: CommercialObservationRow,
  now: Date = new Date(),
): SourcingOption {
  if (row.is_test_data === true) {
    throw new Error(
      `Test-data observation ${row.observation_id} reached the commercial path. ` +
        "Query supplier_commercial_observations, never supplier_listing_prices.",
    );
  }

  const price = toNumber(row.purchase_price);
  const stockStatus = row.stock_status ?? "unknown";
  const stockConfidence = row.stock_confidence ?? "unknown";
  const staleMultiplier = toNumber(row.stale_multiplier) ?? 2;
  const pfuStatus = row.pfu_status ?? "TO_CONFIRM";

  return {
    laneCode: row.lane_code,
    supplierName: row.supplier_name,
    supplierListingKey: row.supplier_listing_key,
    supplierArticleId: row.supplier_article_id,
    oldDot: row.old_dot,

    purchasePriceNet: price,
    currency: row.currency,
    priceUnavailable: price === null,

    stockExact: row.stock_exact,
    stockStatus,
    stockConfidence,
    stockLabel: stockLabel(row.stock_exact, stockStatus, stockConfidence),

    leadTimeDays: row.lead_time_days,
    deliveryClass: row.delivery_class ?? "unknown",

    observedAt: row.observed_at,
    ageHours: ageHours(row.observed_at, now),
    priceFreshness: classifyFreshness(
      row.price_verified_at ?? row.observed_at,
      { ttlHours: row.price_ttl_hours, staleMultiplier },
      now,
    ),
    stockFreshness: classifyFreshness(
      row.stock_verified_at ?? row.observed_at,
      { ttlHours: row.stock_ttl_hours, staleMultiplier },
      now,
    ),

    sourceType: row.source_type,
    observedBy: row.observed_by,

    pfuAmount: toNumber(row.pfu_amount),
    pfuStatus,
    pfuProvisional: pfuStatus === "TO_CONFIRM",

    // A lane with no price cannot be quoted, however fresh the row is.
    quotable: price !== null && stockStatus !== "out_of_stock",
  };
}

const FRESHNESS_RANK: Record<Freshness, number> = {
  FRESH: 0, AGEING: 1, STALE: 2, UNKNOWN: 3,
};

/**
 * Deterministic ranking: quotable first, then freshest, then cheapest.
 *
 * This ordering is INTERNAL. It must never be exposed on a customer surface
 * (docs/architecture/01_SUPPLIER_ARCHITECTURE.md forbids leaking an internal
 * sourcing score). Ties break on lane code so the order is stable.
 */
export function rankSourcingOptions(options: SourcingOption[]): SourcingOption[] {
  return [...options].sort((a, b) => {
    if (a.quotable !== b.quotable) return a.quotable ? -1 : 1;
    const fresh = FRESHNESS_RANK[a.priceFreshness] - FRESHNESS_RANK[b.priceFreshness];
    if (fresh !== 0) return fresh;
    if (a.purchasePriceNet !== null && b.purchasePriceNet !== null) {
      if (a.purchasePriceNet !== b.purchasePriceNet) {
        return a.purchasePriceNet - b.purchasePriceNet;
      }
    } else if (a.purchasePriceNet !== b.purchasePriceNet) {
      return a.purchasePriceNet === null ? 1 : -1;
    }
    return (a.laneCode ?? "").localeCompare(b.laneCode ?? "");
  });
}

export interface ProductSearchResult {
  catalogueProductId: string;
  options: SourcingOption[];
  /** Lanes that returned nothing - shown as "no current data", never as zero. */
  lanesWithoutData: string[];
}

/**
 * Assemble one product's sourcing options.
 *
 * `allSourcingLanes` lets the screen distinguish "this lane has no stock" from
 * "this lane has no data at all" — an absence must be shown as an absence.
 */
export function buildProductResult(
  catalogueProductId: string,
  rows: readonly CommercialObservationRow[],
  allSourcingLanes: readonly string[],
  now: Date = new Date(),
): ProductSearchResult {
  const options = rankSourcingOptions(rows.map((row) => toSourcingOption(row, now)));
  const present = new Set(options.map((o) => o.laneCode).filter(Boolean) as string[]);
  return {
    catalogueProductId,
    options,
    lanesWithoutData: allSourcingLanes.filter((lane) => !present.has(lane)),
  };
}

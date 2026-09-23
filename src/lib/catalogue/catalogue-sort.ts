// Sort orders for the catalogue workspace.
//
// The important distinction here is WHERE a sort can be executed, because it
// decides whether pagination stays correct.
//
//   DATABASE-NATIVE   the sort key is a column on catalogue_products, so
//                     PostgreSQL orders the whole result set and the page is
//                     a genuine slice of it.
//   OFFER-DERIVED     the sort key comes from the latest supplier observation,
//                     which lives in a different table. PostgREST cannot order
//                     a parent by a nested table's column, so the only correct
//                     way to sort by it is to materialise the whole filtered
//                     set first.
//
// Sorting an already-paginated page by an offer-derived key is exactly the bug
// M11B removed: a locally sorted page inside a globally unsorted sequence. So
// offer-derived sorts materialise, and materialising is bounded — beyond the
// cap the request is REFUSED with a message asking the operator to narrow,
// rather than silently returning a subtly wrong order.
//
// Pure: no database, no I/O.

export type CatalogueSort =
  /** Brand then model. Database-native, the default. */
  | "brand_asc"
  /** Cheapest current offer first. Offer-derived. */
  | "price_asc"
  /** Most recently observed first. Offer-derived. */
  | "freshest"
  /** Most stock first, by the supplier's own figure. Offer-derived. */
  | "stock_desc";

export const CATALOGUE_SORTS: readonly CatalogueSort[] = [
  "brand_asc",
  "price_asc",
  "freshest",
  "stock_desc",
];

export function isCatalogueSort(value: unknown): value is CatalogueSort {
  return typeof value === "string" && (CATALOGUE_SORTS as readonly string[]).includes(value);
}

/** True when the sort key is a column the database can order by directly. */
export function isDatabaseNativeSort(sort: CatalogueSort): boolean {
  return sort === "brand_asc";
}

/**
 * How many products an offer-derived sort may materialise.
 *
 * Generous enough for how a tyre shop actually searches — a size selection
 * returns a few hundred products — and small enough that the request stays a
 * single fast round trip. Above it the sort is refused, which is the honest
 * failure: "narrow your search" beats a page that looks sorted and is not.
 */
export const OFFER_SORT_MAX_PRODUCTS = 1_000;

export interface SortableOffer {
  readonly purchasePriceCents: number | null;
  readonly observedAt: string | null;
  readonly stockExact: number | null;
  readonly stockMinimum: number | null;
}

export interface SortableRow {
  readonly brand: string | null;
  readonly modelPattern: string | null;
  readonly productId: string;
  readonly offers: readonly SortableOffer[];
}

/** The cheapest current offer, or null when the row has no priced offer. */
export function bestPriceCents(row: SortableRow): number | null {
  const prices = row.offers
    .map((offer) => offer.purchasePriceCents)
    .filter((price): price is number => price !== null);
  return prices.length === 0 ? null : Math.min(...prices);
}

/** The most recent observation across a row's offers. */
export function newestObservedAt(row: SortableRow): number | null {
  const times = row.offers
    .map((offer) => (offer.observedAt ? new Date(offer.observedAt).getTime() : null))
    .filter((time): time is number => time !== null && Number.isFinite(time));
  return times.length === 0 ? null : Math.max(...times);
}

/**
 * The largest availability a row can evidence.
 *
 * An exact count where one exists, otherwise the floor of a band. A band is
 * never resolved into a number for this — `>  20` contributes 20, which is
 * what the supplier actually committed to.
 */
export function bestStock(row: SortableRow): number | null {
  const values = row.offers
    .map((offer) => offer.stockExact ?? offer.stockMinimum)
    .filter((value): value is number => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

/** Rows with nothing to sort on always sink, whichever direction is chosen. */
function nullsLast(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

function byBrand(a: SortableRow, b: SortableRow): number {
  const brand = (a.brand ?? "").localeCompare(b.brand ?? "");
  if (brand !== 0) return brand;
  const model = (a.modelPattern ?? "").localeCompare(b.modelPattern ?? "");
  if (model !== 0) return model;
  // Stable final key, so equal rows never reorder between requests.
  return a.productId.localeCompare(b.productId);
}

/**
 * Orders a fully materialised set.
 *
 * Every comparator falls through to brand then product id, so the result is
 * deterministic: two rows with the same price come back in the same order on
 * every request, and a page boundary cannot drift.
 */
export function sortRows<T extends SortableRow>(rows: T[], sort: CatalogueSort): T[] {
  const sorted = [...rows];
  switch (sort) {
    case "price_asc":
      sorted.sort((a, b) => nullsLast(bestPriceCents(a), bestPriceCents(b), 1) || byBrand(a, b));
      break;
    case "freshest":
      sorted.sort((a, b) => nullsLast(newestObservedAt(a), newestObservedAt(b), -1) || byBrand(a, b));
      break;
    case "stock_desc":
      sorted.sort((a, b) => nullsLast(bestStock(a), bestStock(b), -1) || byBrand(a, b));
      break;
    case "brand_asc":
    default:
      sorted.sort(byBrand);
      break;
  }
  return sorted;
}

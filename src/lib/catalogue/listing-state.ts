import type { LaneCode } from "@/lib/catalogue/supplier-lanes";

// What an operator needs to know about a listing at a glance: which vehicle it
// is for, and whether its commercial data can be relied on.
//
// Both answers are derived from evidence the catalogue already holds. Neither
// invents anything: where the data does not support an answer, the answer is
// "unknown" and the row stays visible saying so.
//
// Pure: no database, no I/O.

// ---------------------------------------------------------------------------
// Vehicle class
// ---------------------------------------------------------------------------

export type VehicleClass = "car_van" | "truck" | "unknown";

/**
 * Product classes the legacy import assigned, mapped to the two groups a tyre
 * shop actually browses by.
 *
 * `light_truck_van` is a VAN tyre, not a lorry tyre, so it belongs with cars.
 * Getting that wrong would put 638 van tyres behind a Truck tab where nobody
 * would look for them.
 */
const TRUCK_PRODUCT_CLASSES = new Set(["truck"]);
const CAR_VAN_PRODUCT_CLASSES = new Set([
  "passenger_car",
  "passenger_car_runflat",
  "suv_4x4",
  "light_truck_van",
  "motorcycle",
  "scooter",
  "spare",
  "old_dot",
]);

/**
 * The product classes that belong to a vehicle group.
 *
 * Exported so the browse query can push the legacy fallback into SQL as a
 * root-level filter, using the SAME vocabulary `classifyVehicle` applies in
 * memory. Two lists would eventually disagree.
 */
export function productClassesFor(vehicle: Exclude<VehicleClass, "unknown">): string[] {
  return vehicle === "truck" ? [...TRUCK_PRODUCT_CLASSES] : [...CAR_VAN_PRODUCT_CLASSES];
}

export interface VehicleClassInput {
  /** `category=pcr|truck` recorded on the import run that wrote the listing. */
  readonly feedCategory: string | null;
  /** The catalogue product's own class, where the legacy import set one. */
  readonly productClass: string | null;
}

/**
 * Which vehicle group a listing belongs to.
 *
 * PROVENANCE FIRST. The import run records which Inter-Sprint feed a listing
 * came from, and the two feeds are literally separate deliveries — that is a
 * fact about where the row came from, not a guess about the tyre. Only when a
 * listing predates that recording (the legacy import) does it fall back to
 * `product_class`.
 *
 * Verified in M11A to cover 100% of production's 13,206 listings: 9,850 by
 * provenance, 3,356 by fallback, none unclassifiable. `unknown` is returned
 * anyway, because a future supplier may supply neither and must still appear.
 */
export function classifyVehicle(input: VehicleClassInput): VehicleClass {
  if (input.feedCategory === "truck") return "truck";
  if (input.feedCategory === "pcr") return "car_van";

  const productClass = input.productClass;
  if (productClass) {
    if (TRUCK_PRODUCT_CLASSES.has(productClass)) return "truck";
    if (CAR_VAN_PRODUCT_CLASSES.has(productClass)) return "car_van";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Listing state
// ---------------------------------------------------------------------------

export type ListingState =
  /** A current, priced observation. The only state that is a live offer. */
  | "CURRENT"
  /** The listing exists but its latest observation carries no price. */
  | "NO_CURRENT_PRICE"
  /** Specifications are incomplete; the tyre may still be priced. */
  | "NEEDS_REVIEW"
  /** An unresolved import conflict touches this listing's product. */
  | "CONFLICT";

export interface ListingStateInput {
  readonly hasCurrentPrice: boolean;
  readonly reviewRequired: boolean;
  readonly hasOpenConflict: boolean;
}

/**
 * The single state badge a row carries.
 *
 * Precedence is deliberate and runs from most to least alarming:
 *
 *   CONFLICT          two sources disagree about what this product IS. Until
 *                     that is settled, nothing else about the row is safe to
 *                     act on.
 *   NO_CURRENT_PRICE  we cannot sell it, whatever its specifications say.
 *   NEEDS_REVIEW      sellable but incompletely described.
 *   CURRENT           nothing wrong.
 *
 * The 1,841 legacy listings with no current observation land in
 * NO_CURRENT_PRICE. They stay VISIBLE — deactivating them would assert that
 * the supplier dropped them, and whether absence from a feed means that is
 * still unresolved (D14).
 */
export function deriveListingState(input: ListingStateInput): ListingState {
  if (input.hasOpenConflict) return "CONFLICT";
  if (!input.hasCurrentPrice) return "NO_CURRENT_PRICE";
  if (input.reviewRequired) return "NEEDS_REVIEW";
  return "CURRENT";
}

/** True for a state that represents a live, actionable supplier offer. */
export function isLiveOffer(state: ListingState): boolean {
  return state === "CURRENT" || state === "NEEDS_REVIEW";
}

export interface SupplierOfferView {
  readonly laneCode: LaneCode | null;
  readonly state: ListingState;
}

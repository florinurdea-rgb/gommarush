// What GommaRush promises a customer about delivery.
//
// THE POINT OF THIS FILE: a delivery promise is a GommaRush SERVICE COMMITMENT,
// not a supplier lead time. The two look similar and must not be conflated.
//
// A supplier lane carries its own lead time (Inter-Sprint 7d, Carlini 48h — see
// src/lib/catalogue/supplier-lanes.ts). Publishing that figure per offer would
// leak supplier provenance through the back door: a customer who sees "48h" on
// one tyre and "7 days" on another has learnt that GommaRush uses at least two
// suppliers and which tyres come from the fast one. The projection boundary
// would still contain no supplier NAME, and the customer would still have been
// told something about sourcing.
//
// So the promise attaches to the FULFILMENT CLASS the customer chose, which is
// a GommaRush product. Standard is the same seven days whoever supplies it;
// consolidation, cut-off and sourcing all happen inside that window.
//
// Pure: no database, no I/O.

export const FULFILMENT_CLASSES = ["standard", "express"] as const;
export type FulfilmentClass = (typeof FULFILMENT_CLASSES)[number];

export function isFulfilmentClass(value: unknown): value is FulfilmentClass {
  return typeof value === "string" && (FULFILMENT_CLASSES as readonly string[]).includes(value);
}

export interface FulfilmentPromise {
  readonly class: FulfilmentClass;
  /**
   * The outer bound of the promise, in days. A MAXIMUM, never an estimate and
   * never a date: the architecture record is explicit that a delivery date
   * cannot be promised from raw supplier availability, because consolidation
   * and cut-off sit between the two.
   */
  readonly maxDays: number;
  /** Lower bound in hours, where the class is expressed in hours. */
  readonly minHours: number | null;
  readonly maxHours: number | null;
}

/**
 * The V1 service classes, as recorded in
 * docs/architecture/04_SALES_SOURCING_MODEL.md.
 *
 * Express is manually sourced today, which is why it is a narrower promise made
 * by a human rather than a faster automatic path.
 */
export const FULFILMENT_PROMISES: Readonly<Record<FulfilmentClass, FulfilmentPromise>> = {
  standard: { class: "standard", maxDays: 7, minHours: null, maxHours: null },
  express: { class: "express", maxDays: 2, minHours: 24, maxHours: 48 },
};

export const DEFAULT_FULFILMENT_CLASS: FulfilmentClass = "standard";

export function fulfilmentPromise(fulfilmentClass: FulfilmentClass): FulfilmentPromise {
  return FULFILMENT_PROMISES[fulfilmentClass];
}

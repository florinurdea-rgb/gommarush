import {
  assertDataClassification,
  type DataClassification,
  type FreshnessPolicy,
  type SupplierObservation,
} from "@/lib/suppliers/observation";
import type { NormalizedCatalogueRow } from "@/lib/types/catalogue";

// Turning Inter-Sprint feed rows into normalised supplier observations.
//
// The adapter's job ends at "this is what the file said". This module's job is
// "and here is what it means commercially", which is a different question with
// different failure modes — chiefly that a price can look perfectly valid and
// still not be the price we pay.
//
// Pure: no database, no I/O, no clock of its own.

export const INTERSPRINT_LANE_CODE = "intersprint";

/**
 * How Inter-Sprint's `nett-price` should be understood.
 *
 * The feed has no currency column, no discount column and no statement of what
 * is included. Antonello Moio's covering email describes the files as samples
 * of the FTP feed and says PFU is NOT included and must be handled on our
 * side; it does not say whether `nett-price` is Go Rush's contracted net, a
 * list net before account discount, or whether transport is included.
 *
 * So the number is carried faithfully and its MEANING is recorded as
 * unresolved. That is the same treatment Deldo's price gets, for the same
 * reason: a markup applied to the wrong interpretation misprices everything.
 */
export type IntersprintPriceBasis =
  /** Confirmed by Inter-Sprint as the price Go Rush pays. Nothing sets this yet. */
  | "confirmed_net_to_gorush"
  /** Carried from the feed, meaning not yet confirmed. The current state. */
  | "feed_nett_price_unconfirmed";

export interface IntersprintObservationInput {
  /** One normalised row from the Inter-Sprint feed adapter. */
  readonly row: NormalizedCatalogueRow;
  /**
   * Whether this file is real or a sample. NO DEFAULT, by design — the two
   * sample files we hold are genuinely not live data, and an importer that
   * assumed "live" would publish August sample prices as today's cost.
   */
  readonly classification: DataClassification;
  /** When the feed was produced or received. Never `new Date()` in here. */
  readonly observedAt: Date;
}

/**
 * Builds one supplier observation from a feed row.
 *
 * Classification is asserted at run time rather than trusted to the type,
 * because a TypeScript union is erased and the first HTTP handler that reaches
 * this code would otherwise pass unvalidated JSON straight through.
 *
 * `currency` is left NULL. Inter-Sprint is a Dutch company and euros are the
 * obvious guess, but the feed states no currency anywhere and an assumed
 * currency on a purchase price is exactly the class of silent error this
 * integration must not make.
 */
export function buildIntersprintObservation(
  input: IntersprintObservationInput
): SupplierObservation {
  const classification = assertDataClassification(
    (input as { classification?: unknown }).classification,
    `Inter-Sprint feed observation for listing '${input.row.supplierListingKey}'`
  );

  const { row } = input;

  return {
    laneCode: INTERSPRINT_LANE_CODE,
    supplierListingKey: row.supplierListingKey,
    supplierArticleId: row.supplierArticleId,

    // The feed states no DOT year and no demo/condition marker.
    dotYear: null,
    demo: null,
    stockCondition: null,

    classification,
    source: "bulk_feed",
    observedAt: input.observedAt,

    purchasePrice: row.purchasePrice,
    currency: null,

    stockExact: row.stockExact,
    stockMinimum: row.stockMinimum,
    stockRaw: row.stockRaw,

    // See IntersprintPriceBasis. 'unknown' is what stops an unconfirmed price
    // being marked up and quoted; it is not a placeholder to be tidied away.
    commercialMode: "unknown",
  };
}

/**
 * The freshness policy for the Inter-Sprint lane.
 *
 * DELIBERATELY ABSENT. There is no published refresh cadence for this feed —
 * Antonello's email says the files will be placed on our FTP folder, not how
 * often — and how long GommaRush is willing to sell against an old price is a
 * commercial decision in any case, not a consequence of a publishing schedule.
 *
 * A number invented here would silently become a promise about availability.
 * Callers must supply a policy explicitly, exactly as the Deldo lane requires.
 */
export const INTERSPRINT_FRESHNESS_POLICY: FreshnessPolicy | null = null;

/**
 * Whether a feed observation may set a commercially usable purchase cost.
 *
 * Separate from `classifyObservation`, which answers whether the observation
 * is fresh, real and complete. This answers the narrower question the feed
 * raises on its own: do we actually know that `nett-price` is our cost?
 *
 * Today the answer is no for every row, and that is a documentation gap rather
 * than a data problem — one sentence from Inter-Sprint closes it.
 */
export function isPriceBasisCommerciallyUsable(basis: IntersprintPriceBasis): boolean {
  return basis === "confirmed_net_to_gorush";
}

/** The basis every row currently carries. */
export const CURRENT_INTERSPRINT_PRICE_BASIS: IntersprintPriceBasis =
  "feed_nett_price_unconfirmed";

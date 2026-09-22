import {
  assertDataClassification,
  type DataClassification,
  type FreshnessPolicy,
  type SupplierObservation,
} from "@/lib/suppliers/observation";
import type { NormalizedCatalogueRow } from "@/lib/types/catalogue";
import {
  categoryForProductClass,
  INTERSPRINT_COMMERCIAL_POLICY,
  previewReleaseQuantity,
  resolveIntersprintCommercialMode,
  type IntersprintCategory,
  type IntersprintCommercialPolicy,
} from "@/lib/suppliers/intersprint/commercial-policy";

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
  /**
   * Confirmed as the net purchase price GommaRush pays.
   *
   * OWNER-CONFIRMED 2026-09-22 (POLICY_OWNER). NOT an Inter-Sprint document —
   * the supplier has never written this down for us, and the distinction is
   * preserved deliberately so nobody later cites a business decision as a
   * supplier commitment.
   */
  | "confirmed_net_to_gorush"
  /** Carried from the feed with its meaning unconfirmed. The M8 state. */
  | "feed_nett_price_unconfirmed";

export interface IntersprintObservationInput {
  /** One normalised row from the Inter-Sprint feed adapter. */
  readonly row: NormalizedCatalogueRow;
  /**
   * Units of the supplier RELEASE this line will belong to.
   *
   * Transport is included only once Inter-Sprint's minimum is reached (60 PCR,
   * 10 truck), so the same price means different things either side of it.
   * Omitted means "sourcing has not decided yet", which resolves to `unknown`
   * and fails closed rather than assuming a full batch.
   */
  readonly releaseQuantity?: number | null;
  /**
   * Which minimum applies. Derived from the catalogue product class when not
   * given, because the feed itself carries no category flag.
   */
  readonly category?: IntersprintCategory;
  readonly policy?: IntersprintCommercialPolicy;
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

    // Resolved from the owner's confirmation plus the release size. Below the
    // minimum this is 'transport_separate', not 'transport_included': the
    // price is still real, but it does not yet carry delivery.
    commercialMode: resolveIntersprintCommercialMode({
      category: input.category ?? categoryForProductClass(row.productClass),
      releaseQuantity: input.releaseQuantity ?? null,
      policy: input.policy ?? INTERSPRINT_COMMERCIAL_POLICY,
    }),
  };
}

/**
 * An observation priced the way the internal preview shows it: as part of a
 * consolidated release that reaches Inter-Sprint's minimum.
 *
 * Separate from the general builder so the assumption is visible at the call
 * site rather than buried in a default. The preview screen states it too.
 */
export function buildIntersprintPreviewObservation(
  input: Omit<IntersprintObservationInput, "releaseQuantity">
): SupplierObservation {
  const category = input.category ?? categoryForProductClass(input.row.productClass);
  return buildIntersprintObservation({
    ...input,
    category,
    releaseQuantity: previewReleaseQuantity(category, input.policy),
  });
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

/**
 * The basis every row now carries, following the owner's confirmation.
 *
 * M8 shipped `feed_nett_price_unconfirmed`, which made every Inter-Sprint
 * price commercially unusable. The change here is a business decision being
 * recorded, not a new supplier fact.
 */
export const CURRENT_INTERSPRINT_PRICE_BASIS: IntersprintPriceBasis =
  "confirmed_net_to_gorush";

/** Where that confirmation came from. Never relabel this as supplier-sourced. */
export const CURRENT_PRICE_BASIS_PROVENANCE = "POLICY_OWNER" as const;

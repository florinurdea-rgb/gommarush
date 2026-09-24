// The customer / internal boundary for priced catalogue results.
//
// THE POINT OF THIS FILE: the two audiences get two different TYPES, built by
// two different functions, and the customer type has no field that could hold
// a supplier cost, a supplier name, an article code or a profit figure. A
// reviewer does not have to audit a UI component to know a price leaked —
// `CustomerTyreOffer` simply has nowhere to put one.
//
// The alternative, one wide object with fields the customer UI happens not to
// render, fails the moment someone adds a debug dump, a CSV export, or a
// `JSON.stringify` in an error path. That is not hypothetical; it is the usual
// way supplier costs escape.
//
// Pure: no database, no I/O.

import type { Cents } from "@/lib/documents/pipeline/money";
import type { PriceBreakdown, PriceResolution } from "@/lib/pricing/calculate";
import { grossMarginPercent, grossProfitCents } from "@/lib/pricing/calculate";
import type { PfuStatus } from "@/lib/pricing/pfu";
import type { SellabilityDecision, SellabilityReason } from "@/lib/commerce/selling-policy";

/** The tyre itself. Identical for both audiences — specs are not secret. */
export interface TyreSpecView {
  productId: string;
  brand: string | null;
  modelPattern: string | null;
  description: string | null;
  sizeDisplay: string | null;
  widthMm: number | null;
  aspectRatio: number | null;
  rimInch: number | null;
  loadIndex: string | null;
  speedRating: string | null;
  loadSpeedRaw: string | null;
  season: string | null;
  productClass: string | null;
  xl: boolean | null;
  runFlat: boolean | null;
  oldDot: boolean;
  /** EU energy-label registration id. The only label datum the schema holds. */
  eprelId: string | null;
}

/**
 * Availability, expressed only as far as the data supports.
 *
 * Note what is NOT here: a number. The ISB catalogue currently carries no
 * stock at all, and where a supplier does ship stock it arrives as bands or
 * thresholds ('>20'). Publishing a precise count we cannot stand behind is how
 * a customer is promised a tyre that is not there.
 */
export type AvailabilityView = "unknown" | "in_stock" | "on_request";

// ---------------------------------------------------------------------------
// Customer projection
// ---------------------------------------------------------------------------

/**
 * What a customer may receive. Supplier identity, supplier article codes,
 * purchase prices, import metadata and profit are STRUCTURALLY absent.
 *
 * The customer sees GommaRush's price. Who GommaRush bought from is
 * GommaRush's business, and it is also commercially dangerous information —
 * it lets a tyre shop go straight to the supplier.
 */
export interface CustomerTyreOffer {
  tyre: TyreSpecView;
  availability: AvailabilityView;

  /** The net selling price. Null when we cannot price the tyre. */
  tyreSaleNetCents: Cents | null;
  pfuStatus: PfuStatus;
  pfuAmountCents: Cents | null;
  /**
   * True when the PFU above is the temporary estimate.
   *
   * CUSTOMER-SAFE and required: the owner's decision is that an estimated PFU
   * must be visibly disclosed. This is the flag every customer surface hangs
   * "PFU stimato — l'importo definitivo può variare" off, so it belongs in the
   * customer type rather than being re-derived per component.
   */
  pfuEstimated: boolean;
  /** The estimation rule id. A calculation identifier, not supplier data. */
  pfuEstimateVersion: string | null;
  vatAmountCents: Cents | null;
  customerTotalCents: Cents | null;
  /** True when a figure is missing because something is unconfirmed. */
  priceAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Internal projection
// ---------------------------------------------------------------------------

/**
 * What an authorized operator may receive: the same tyre plus the commercial
 * chain that produced its price, which is the entire purpose of the preview.
 * This type must never back an unauthenticated route.
 */
export interface InternalTyreOffer {
  tyre: TyreSpecView;
  availability: AvailabilityView;

  /**
   * The supplier's real stock, unaltered — including the 3s and 4s that are
   * NOT offered to customers. Suppressing a listing must never destroy the
   * figure that sourcing and consolidation depend on.
   */
  supplierStockExact: number | null;
  supplierStockMinimum: number | null;
  supplierStockRaw: string | null;

  /** Whether GommaRush will offer it, and why not when it will not. */
  sellable: boolean;
  sellabilityReason: SellabilityReason;
  minimumOfferQuantity: number;

  /** Internal supplier reference. Opaque to the customer projection. */
  supplierListingId: string;
  supplierName: string | null;
  supplierArticleId: string | null;

  /**
   * Which supplier lane wrote this listing, and the EAN that identifies the
   * tyre to that lane's live API.
   *
   * `laneCode` IS SOURCING and is on FORBIDDEN_CUSTOMER_FIELDS: which
   * wholesaler a tyre would be bought from must never reach a customer.
   *
   * `ean` is not confidential — it is printed on the tyre's own label, and the
   * customer catalogue's tyre spec has always carried it. It is duplicated
   * here because the live availability check addresses Inter-Sprint by EAN and
   * should not have to reach back into the product row to find one.
   */
  laneCode: string | null;
  ean: string | null;
  /**
   * Verified tyre weight, for re-resolving PFU when a live price arrives.
   *
   * PFU is a function of weight, not of price, so a re-price must reuse the
   * SAME weight rather than inventing a band. Internal because it is an input
   * to a calculation, not something a customer is quoted.
   */
  weightKg: number | null;

  resolution: PriceResolution;
  supplierCostCents: Cents | null;
  markupPercentApplied: number | null;
  markupAmountCents: Cents | null;
  minimumProfitApplied: boolean;
  tyreSaleNetCents: Cents | null;
  pfuStatus: PfuStatus;
  pfuAmountCents: Cents | null;
  pfuEstimated: boolean;
  pfuEstimateVersion: string | null;
  taxableSubtotalCents: Cents | null;
  vatRatePercentApplied: number | null;
  vatAmountCents: Cents | null;
  customerTotalCents: Cents | null;
  grossProfitCents: Cents | null;
  grossMarginPercent: number | null;
  blockedReasons: string[];
  /** When the supplier cost was observed. Null when there is no cost. */
  costObservedAt: string | null;
}

/** Everything the search layer knows about one priced listing. */
export interface PricedListing {
  tyre: TyreSpecView;
  availability: AvailabilityView;
  supplierListingId: string;
  supplierName: string | null;
  supplierArticleId: string | null;
  /** The lane that wrote this listing, the tyre's EAN and its weight. Internal only. */
  laneCode?: string | null;
  ean?: string | null;
  weightKg?: number | null;
  costObservedAt: string | null;
  breakdown: PriceBreakdown;
  /** The supplier's stock, verbatim. */
  supplierStockExact: number | null;
  supplierStockMinimum: number | null;
  supplierStockRaw: string | null;
  /** The GommaRush offer decision taken against that stock. */
  sellability: SellabilityDecision;
}

/**
 * Narrows a priced listing to what a customer may see.
 *
 * Written as an explicit field list, never a spread-and-delete. A spread
 * copies whatever the source gains next week; this copies what was agreed.
 */
export function toCustomerOffer(listing: PricedListing): CustomerTyreOffer {
  const { breakdown } = listing;
  return {
    tyre: listing.tyre,
    availability: listing.availability,
    tyreSaleNetCents: breakdown.tyreSaleNetCents,
    pfuStatus: breakdown.pfuStatus,
    pfuAmountCents: breakdown.pfuAmountCents,
    pfuEstimated: breakdown.pfuEstimated,
    pfuEstimateVersion: breakdown.pfuEstimateVersion,
    vatAmountCents: breakdown.vatAmountCents,
    customerTotalCents: breakdown.customerTotalCents,
    priceAvailable: breakdown.tyreSaleNetCents !== null,
  };
}

/** Expands a priced listing to the full internal commercial view. */
export function toInternalOffer(listing: PricedListing): InternalTyreOffer {
  const { breakdown } = listing;
  return {
    tyre: listing.tyre,
    availability: listing.availability,
    supplierStockExact: listing.supplierStockExact,
    supplierStockMinimum: listing.supplierStockMinimum,
    supplierStockRaw: listing.supplierStockRaw,
    sellable: listing.sellability.sellable,
    sellabilityReason: listing.sellability.reason,
    minimumOfferQuantity: listing.sellability.minimumApplied,
    supplierListingId: listing.supplierListingId,
    supplierName: listing.supplierName,
    supplierArticleId: listing.supplierArticleId,
    laneCode: listing.laneCode ?? null,
    ean: listing.ean ?? null,
    weightKg: listing.weightKg ?? null,
    resolution: breakdown.resolution,
    supplierCostCents: breakdown.supplierCostCents,
    markupPercentApplied: breakdown.markupPercentApplied,
    markupAmountCents: breakdown.markupAmountCents,
    minimumProfitApplied: breakdown.minimumProfitApplied,
    tyreSaleNetCents: breakdown.tyreSaleNetCents,
    pfuStatus: breakdown.pfuStatus,
    pfuAmountCents: breakdown.pfuAmountCents,
    pfuEstimated: breakdown.pfuEstimated,
    pfuEstimateVersion: breakdown.pfuEstimateVersion,
    taxableSubtotalCents: breakdown.taxableSubtotalCents,
    vatRatePercentApplied: breakdown.vatRatePercentApplied,
    vatAmountCents: breakdown.vatAmountCents,
    customerTotalCents: breakdown.customerTotalCents,
    grossProfitCents: grossProfitCents(breakdown),
    grossMarginPercent: grossMarginPercent(breakdown),
    blockedReasons: breakdown.blockedReasons,
    costObservedAt: listing.costObservedAt,
  };
}

/**
 * Field names that must never appear anywhere in a customer payload, at any
 * depth. Exported so the security test asserts against the same list the
 * reviewer reads, rather than a copy that can drift out of step.
 */
export const FORBIDDEN_CUSTOMER_FIELDS: readonly string[] = [
  "supplierStockExact",
  "supplierStockMinimum",
  "supplierStockRaw",
  "sellabilityReason",
  "minimumOfferQuantity",
  "supplierCostCents",
  "supplierName",
  "supplierArticleId",
  "supplierListingId",
  /*
    Sourcing. Which wholesaler a tyre would be bought from is the single most
    commercially sensitive thing in this system, and it must never be inferable
    from a customer payload.

    `ean` is deliberately NOT on this list. It is carried on the internal offer
    because that is what addresses Inter-Sprint protocol 103, but it is a public
    identifier printed on the tyre's own label — forbidding it would be
    security theatre, and the customer catalogue has in fact always included it
    in its tyre spec.
  */
  "laneCode",
  "markupPercentApplied",
  "markupAmountCents",
  "grossProfitCents",
  "grossMarginPercent",
  "taxableSubtotalCents",
  "costObservedAt",
  "resolution",
  "blockedReasons",
  "minimumProfitApplied",
  "vatRatePercentApplied",
];

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

  /** Internal supplier reference. Opaque to the customer projection. */
  supplierListingId: string;
  supplierName: string | null;
  supplierArticleId: string | null;

  resolution: PriceResolution;
  supplierCostCents: Cents | null;
  markupPercentApplied: number | null;
  markupAmountCents: Cents | null;
  minimumProfitApplied: boolean;
  tyreSaleNetCents: Cents | null;
  pfuStatus: PfuStatus;
  pfuAmountCents: Cents | null;
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
  costObservedAt: string | null;
  breakdown: PriceBreakdown;
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
    supplierListingId: listing.supplierListingId,
    supplierName: listing.supplierName,
    supplierArticleId: listing.supplierArticleId,
    resolution: breakdown.resolution,
    supplierCostCents: breakdown.supplierCostCents,
    markupPercentApplied: breakdown.markupPercentApplied,
    markupAmountCents: breakdown.markupAmountCents,
    minimumProfitApplied: breakdown.minimumProfitApplied,
    tyreSaleNetCents: breakdown.tyreSaleNetCents,
    pfuStatus: breakdown.pfuStatus,
    pfuAmountCents: breakdown.pfuAmountCents,
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
  "supplierCostCents",
  "supplierName",
  "supplierArticleId",
  "supplierListingId",
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

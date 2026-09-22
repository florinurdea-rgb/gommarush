// The GommaRush price calculation.
//
//   supplier purchase cost
//   + markup                -> tyre selling price net
//   + PFU                   -> taxable subtotal
//   + VAT                   -> final customer price
//
// Every component is kept separately and none is recoverable only by
// subtraction. That is what makes a price explainable a year later, and it is
// also what lets the customer projection drop the cost while keeping the
// selling price coherent.
//
// Money is integer cents throughout, reusing the discipline already
// established in src/lib/documents/pipeline/money.ts. Floating-point euros
// would make 0.1 + 0.2 visible on an invoice.
//
// Pure: no database, no I/O, no clock.

import type { Cents } from "@/lib/documents/pipeline/money";
import {
  assertPricingSettings,
  isUsableProvenance,
  type PricingSettings,
} from "@/lib/pricing/settings";
import { isResolvedPfuStatus, type PfuResolution } from "@/lib/pricing/pfu";

/**
 * How far the calculation got.
 *
 * A price is either complete or it names what stopped it. There is no partial
 * state that reads like a total, because a number labelled "total" that is
 * missing a levy is worse than no number.
 */
export type PriceResolution =
  /** Every component resolved. `customerTotalCents` is usable. */
  | "complete"
  /** No supplier cost exists. Nothing downstream can be computed. */
  | "cost_unavailable"
  /** Cost and markup resolved; PFU is TO_CONFIRM, so no total. */
  | "pfu_unresolved"
  /** PFU resolved but the VAT position is not configured. */
  | "vat_policy_unresolved";

export interface PriceCalculationInput {
  /** Supplier purchase cost, net, in cents. Null when we do not have one. */
  supplierCostCents: Cents | null;
  pfu: PfuResolution;
}

export interface PriceBreakdown {
  resolution: PriceResolution;

  /** INTERNAL ONLY. Never crosses into a customer projection. */
  supplierCostCents: Cents | null;

  /** The markup actually applied, and how it was arrived at. */
  markupPercentApplied: number | null;
  markupAmountCents: Cents | null;
  /** True when the minimum-profit floor beat the percentage. */
  minimumProfitApplied: boolean;

  /** Supplier cost + markup. The B2B "price of the tyre". */
  tyreSaleNetCents: Cents | null;

  pfuStatus: PfuResolution["status"];
  pfuAmountCents: Cents | null;

  /** tyreSaleNet + PFU. Null while PFU is unresolved. */
  taxableSubtotalCents: Cents | null;

  vatRatePercentApplied: number | null;
  vatAmountCents: Cents | null;
  customerTotalCents: Cents | null;

  /** Why the calculation stopped where it did. Empty when complete. */
  blockedReasons: string[];
}

/** Half-up rounding on a non-negative value. Deterministic and explicit. */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

function blocked(
  resolution: PriceResolution,
  partial: Partial<PriceBreakdown>,
  pfu: PfuResolution,
  reasons: string[]
): PriceBreakdown {
  return {
    resolution,
    supplierCostCents: null,
    markupPercentApplied: null,
    markupAmountCents: null,
    minimumProfitApplied: false,
    tyreSaleNetCents: null,
    pfuStatus: pfu.status,
    pfuAmountCents: null,
    taxableSubtotalCents: null,
    vatRatePercentApplied: null,
    vatAmountCents: null,
    customerTotalCents: null,
    blockedReasons: reasons,
    ...partial,
  };
}

/**
 * Computes the full breakdown for one tyre.
 *
 * Fails closed at three points, in order, and each one stops the chain rather
 * than substituting a value:
 *
 *   * no supplier cost  -> no selling price. The single most important refusal
 *     here: a missing cost must never become a cost of zero, which would price
 *     the tyre at pure markup on nothing.
 *   * PFU TO_CONFIRM    -> no taxable subtotal and no total.
 *   * VAT base or rate not configured -> no VAT and no total.
 */
export function calculateTyrePrice(
  input: PriceCalculationInput,
  settings: PricingSettings
): PriceBreakdown {
  assertPricingSettings(settings);

  const { supplierCostCents, pfu } = input;

  // ---- 1. Supplier cost -------------------------------------------------
  if (supplierCostCents === null || supplierCostCents === undefined) {
    return blocked("cost_unavailable", {}, pfu, [
      "No supplier purchase cost is available for this listing, so no selling price can be calculated.",
    ]);
  }
  if (!Number.isInteger(supplierCostCents) || supplierCostCents < 0) {
    return blocked("cost_unavailable", {}, pfu, [
      `Supplier cost is not a usable amount (${String(supplierCostCents)}); refusing to price from it.`,
    ]);
  }
  if (!isUsableProvenance(settings.markupProvenance)) {
    return blocked("cost_unavailable", { supplierCostCents }, pfu, [
      "No approved markup is configured, so no selling price can be calculated.",
    ]);
  }

  // ---- 2. Markup --------------------------------------------------------
  const percentageMarkup = roundHalfUp((supplierCostCents * settings.markupPercent) / 100);

  const floor =
    settings.minimumProfitCents !== null && isUsableProvenance(settings.minimumProfitProvenance)
      ? settings.minimumProfitCents
      : null;

  const minimumProfitApplied = floor !== null && floor > percentageMarkup;
  const markupAmountCents = minimumProfitApplied ? (floor as number) : percentageMarkup;
  const tyreSaleNetCents = supplierCostCents + markupAmountCents;

  const resolvedSoFar = {
    supplierCostCents,
    markupPercentApplied: settings.markupPercent,
    markupAmountCents,
    minimumProfitApplied,
    tyreSaleNetCents,
  };

  // ---- 3. PFU -----------------------------------------------------------
  // PFU is added AFTER markup and is never part of the markup base. It is a
  // levy collected on behalf of a scheme, not a product component and not a
  // profit component; marking it up would be charging the customer a margin on
  // someone else's tax.
  if (!isResolvedPfuStatus(pfu.status) || pfu.amountCents === null) {
    return blocked("pfu_unresolved", resolvedSoFar, pfu, [pfu.reason]);
  }
  const pfuAmountCents = pfu.amountCents;

  // ---- 4. VAT -----------------------------------------------------------
  const vatBlockers: string[] = [];
  if (settings.pfuVatBase === "unresolved") {
    vatBlockers.push(
      "Whether PFU sits inside the VAT taxable base is an open accounting decision, so no customer total can be produced."
    );
  }
  if (!isUsableProvenance(settings.vatRateProvenance)) {
    vatBlockers.push("No approved VAT rate is configured.");
  }
  if (vatBlockers.length > 0) {
    return blocked(
      "vat_policy_unresolved",
      {
        ...resolvedSoFar,
        pfuAmountCents,
        taxableSubtotalCents: tyreSaleNetCents + pfuAmountCents,
      },
      pfu,
      vatBlockers
    );
  }

  const taxableSubtotalCents = tyreSaleNetCents + pfuAmountCents;
  const vatBaseCents =
    settings.pfuVatBase === "inside_vat_base" ? taxableSubtotalCents : tyreSaleNetCents;
  const vatAmountCents = roundHalfUp((vatBaseCents * settings.vatRatePercent) / 100);

  return {
    resolution: "complete",
    ...resolvedSoFar,
    pfuStatus: pfu.status,
    pfuAmountCents,
    taxableSubtotalCents,
    vatRatePercentApplied: settings.vatRatePercent,
    vatAmountCents,
    customerTotalCents: taxableSubtotalCents + vatAmountCents,
    blockedReasons: [],
  };
}

/**
 * Gross profit in cents — the markup amount, nothing else.
 *
 * Named `grossProfit` rather than `margin` on purpose. Gross MARGIN is this
 * divided by revenue, which is a different and smaller number; the two are
 * confused often enough that the naming is doing real work.
 */
export function grossProfitCents(breakdown: PriceBreakdown): Cents | null {
  return breakdown.markupAmountCents;
}

/** Gross margin as a percentage of net revenue. Null when not computable. */
export function grossMarginPercent(breakdown: PriceBreakdown): number | null {
  if (breakdown.markupAmountCents === null || !breakdown.tyreSaleNetCents) return null;
  return (breakdown.markupAmountCents / breakdown.tyreSaleNetCents) * 100;
}

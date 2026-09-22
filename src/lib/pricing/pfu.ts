// PFU — pneumatico fuori uso, the Italian end-of-life tyre levy.
//
// This module exists to make one outcome impossible: a PFU amount that looks
// authoritative but was guessed. PFU is a legal levy whose tariffs are set per
// scheme, per category, with effective dates. It is not a constant, it is not
// derivable from a tyre's weight without a published rule, and model knowledge
// is not a source.
//
// So the module is built inside-out from the state it will actually be in for
// a while: TO_CONFIRM. Resolution is a lookup against verified reference data,
// and there is no verified reference data yet. Every shape needed to hold that
// data later is defined here; none of it is populated.
//
// Pure: no database, no I/O.

import type { Cents } from "@/lib/documents/pipeline/money";

/**
 * How confident we are in a PFU figure, and therefore what may be done with it.
 *
 * Only the first three carry an amount. TO_CONFIRM carries none — that is the
 * whole point of it, and an amount of 0 is NOT the same thing. Zero is a claim
 * that no levy applies; TO_CONFIRM is an admission that we do not know.
 */
export type PfuStatus =
  /** The supplier stated the exact PFU for this article. Highest confidence. */
  | "SUPPLIER_EXACT"
  /** Derived from a verified, versioned tariff rule with effective dates. */
  | "RULE_CALCULATED"
  /** Entered by an authorized human against a document they hold. */
  | "MANUAL_CONFIRMED"
  /** Not determinable from any verified source. Carries NO amount. */
  | "TO_CONFIRM";

export const PFU_STATUSES: readonly PfuStatus[] = [
  "SUPPLIER_EXACT",
  "RULE_CALCULATED",
  "MANUAL_CONFIRMED",
  "TO_CONFIRM",
];

/** The statuses that may carry a monetary amount. */
const RESOLVED_STATUSES: readonly PfuStatus[] = [
  "SUPPLIER_EXACT",
  "RULE_CALCULATED",
  "MANUAL_CONFIRMED",
];

export function isResolvedPfuStatus(status: PfuStatus): boolean {
  return RESOLVED_STATUSES.includes(status);
}

/**
 * A verified tariff, once one exists.
 *
 * The version and the effective dates are not bookkeeping: a tariff change
 * must not retroactively alter what an old order was charged, and an order
 * priced today must be explainable in two years. Nothing constructs one of
 * these yet.
 */
export interface PfuTariff {
  /** The consortium or scheme that published it. */
  scheme: string;
  /** The tariff's own category key, as the scheme writes it. */
  category: string;
  /** The published version identifier. Never inferred from a date. */
  version: string;
  effectiveFrom: string;
  /** Null means "current" — open-ended, not "forever". */
  effectiveTo: string | null;
  amountCents: Cents;
  /** Where this was read from, specifically enough to check. */
  source: string;
}

/**
 * The PFU position for one tyre at one moment.
 *
 * `amountCents` is null unless `status` is a resolved one, and the type does
 * not let those two disagree by accident — `resolvedPfu` and `unresolvedPfu`
 * are the only constructors.
 */
export interface PfuResolution {
  status: PfuStatus;
  /** Null whenever the status is TO_CONFIRM. Never 0 as a stand-in. */
  amountCents: Cents | null;
  /** The tariff actually used, snapshotted for audit. Null when unresolved. */
  tariff: PfuTariff | null;
  /** Human-readable reason, shown in the admin preview. */
  reason: string;
}

export function resolvedPfu(
  status: Exclude<PfuStatus, "TO_CONFIRM">,
  amountCents: Cents,
  tariff: PfuTariff | null,
  reason: string
): PfuResolution {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error(
      `PFU amount must be a non-negative integer number of cents, received ${String(amountCents)}`
    );
  }
  return { status, amountCents, tariff, reason };
}

export function unresolvedPfu(reason: string): PfuResolution {
  return { status: "TO_CONFIRM", amountCents: null, tariff: null, reason };
}

/**
 * The tariff table. EMPTY, AND DELIBERATELY SO.
 *
 * Do not populate this from memory, from a competitor's website, or from what
 * a tyre levy "usually" is. It is filled from a document the business holds,
 * as part of the owner decision that is currently open (D3).
 */
export const VERIFIED_PFU_TARIFFS: readonly PfuTariff[] = [];

export interface PfuResolutionInput {
  /** A PFU figure the supplier stated for this exact article, in cents. */
  supplierStatedCents?: Cents | null;
  /** Verified tyre weight, when the catalogue has one. */
  weightKg?: number | null;
  /** The catalogue's product class, e.g. 'passenger_car'. */
  productClass?: string | null;
}

/**
 * Determines the PFU position for one tyre.
 *
 * Today this returns TO_CONFIRM for every Inter-Sprint listing, because:
 *
 *   1. No supplier PFU figure is imported — the ISB catalogue file has no such
 *      column, so `supplierStatedCents` is never supplied.
 *   2. VERIFIED_PFU_TARIFFS is empty, so no rule can be applied.
 *
 * A weight alone is NOT enough. Turning kilograms into euros requires a
 * published rate per kilogram for a specific category and period, and inventing
 * that rate is precisely the failure this module is built to prevent. 1,229 of
 * 9,550 catalogue products have no verified weight at all, so even a real rule
 * would leave those unresolved.
 */
export function resolvePfu(input: PfuResolutionInput = {}): PfuResolution {
  const supplierStated = input.supplierStatedCents;

  if (supplierStated !== null && supplierStated !== undefined) {
    if (!Number.isInteger(supplierStated) || supplierStated < 0) {
      return unresolvedPfu(
        `Supplier PFU figure is not a usable amount (${String(supplierStated)}); refusing to interpret it.`
      );
    }
    return resolvedPfu(
      "SUPPLIER_EXACT",
      supplierStated,
      null,
      "PFU stated by the supplier for this article."
    );
  }

  if (VERIFIED_PFU_TARIFFS.length === 0) {
    return unresolvedPfu(
      "No verified PFU tariff data exists in this system. Sourcing tariffs is an open owner decision; a weight alone cannot produce an amount without a published rate."
    );
  }

  // Reached only once tariffs are loaded. Category/weight selection is
  // deliberately not written ahead of knowing the real tariff structure —
  // guessing the shape of a rule is the same error as guessing its value.
  return unresolvedPfu("No tariff in the verified table applies to this product.");
}

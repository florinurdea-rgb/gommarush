// PFU — pneumatico fuori uso, the Italian end-of-life tyre levy.
//
// This module exists to make one outcome impossible: a PFU amount that looks
// authoritative but was guessed. PFU is a legal levy whose tariffs are set per
// scheme, per category, with effective dates. It is not a constant, it is not
// derivable from a tyre's weight without a published rule, and model knowledge
// is not a source.
//
// Resolution is a lookup against verified reference data, and there is still no
// verified reference data (owner decision D3 is open). Every shape needed to
// hold that data later is defined here; none of it is populated.
//
// SINCE 2026-09-23 the owner has authorised a TEMPORARY ESTIMATE so that PFU
// does not block ordering in V1. That does not weaken the rule above — it adds
// a fourth, clearly-labelled confidence level below the three verified ones.
// An estimate carries its own status (`ESTIMATED`), its own version id, and a
// customer-facing disclosure, and it is preferred LAST: a supplier figure or a
// verified tariff always wins. See pfu-estimate.ts for the amounts and why they
// are placeholders rather than tariffs.
//
// Pure: no database, no I/O.

import type { Cents } from "@/lib/documents/pipeline/money";
import { estimatePfu, type PfuEstimate } from "@/lib/pricing/pfu-estimate";

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
  /**
   * A TEMPORARY owner-authorised estimate. Carries an amount, and carries it
   * with a version id and a visible customer disclosure.
   *
   * Deliberately a SEPARATE value from RULE_CALCULATED rather than a flag on
   * it. A rule-calculated amount comes from a published tariff; an estimate
   * comes from a placeholder band. Collapsing the two would make it impossible
   * to find, a year from now, which orders were priced before the real tariff
   * existed — which is exactly the question an accountant will ask.
   */
  | "ESTIMATED"
  /** Not determinable from any verified source. Carries NO amount. */
  | "TO_CONFIRM";

export const PFU_STATUSES: readonly PfuStatus[] = [
  "SUPPLIER_EXACT",
  "RULE_CALCULATED",
  "MANUAL_CONFIRMED",
  "ESTIMATED",
  "TO_CONFIRM",
];

/** The statuses that may carry a monetary amount. */
const RESOLVED_STATUSES: readonly PfuStatus[] = [
  "SUPPLIER_EXACT",
  "RULE_CALCULATED",
  "MANUAL_CONFIRMED",
  "ESTIMATED",
];

export function isResolvedPfuStatus(status: PfuStatus): boolean {
  return RESOLVED_STATUSES.includes(status);
}

/**
 * The statuses backed by evidence someone can produce on request.
 *
 * ESTIMATED is NOT among them. Anything that presents a figure as final —
 * an invoice, an accounting export, a supplier reconciliation — must check
 * this rather than `isResolvedPfuStatus`, which only answers "is there a
 * number".
 */
const VERIFIED_STATUSES: readonly PfuStatus[] = [
  "SUPPLIER_EXACT",
  "RULE_CALCULATED",
  "MANUAL_CONFIRMED",
];

export function isVerifiedPfuStatus(status: PfuStatus): boolean {
  return VERIFIED_STATUSES.includes(status);
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
  /** The estimate actually used. Non-null ONLY when status is ESTIMATED. */
  estimate: PfuEstimate | null;
  /** Human-readable reason, shown in the admin preview. */
  reason: string;
}

export function resolvedPfu(
  status: Exclude<PfuStatus, "TO_CONFIRM" | "ESTIMATED">,
  amountCents: Cents,
  tariff: PfuTariff | null,
  reason: string
): PfuResolution {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error(
      `PFU amount must be a non-negative integer number of cents, received ${String(amountCents)}`
    );
  }
  return { status, amountCents, tariff, estimate: null, reason };
}

/**
 * The only constructor that can produce an ESTIMATED resolution.
 *
 * It requires the estimate object, so an estimated amount cannot exist without
 * the version and basis that explain it.
 */
export function estimatedPfu(estimate: PfuEstimate): PfuResolution {
  if (!Number.isInteger(estimate.amountCents) || estimate.amountCents < 0) {
    throw new Error(
      `PFU estimate must be a non-negative integer number of cents, received ${String(estimate.amountCents)}`
    );
  }
  return {
    status: "ESTIMATED",
    amountCents: estimate.amountCents,
    tariff: null,
    estimate,
    reason: estimate.rationale,
  };
}

export function unresolvedPfu(reason: string): PfuResolution {
  return { status: "TO_CONFIRM", amountCents: null, tariff: null, estimate: null, reason };
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
  /**
   * Whether the temporary estimate may be used when nothing verified applies.
   *
   * Defaults to true. Set false wherever only a defensible figure will do.
   */
  allowEstimate?: boolean;
}

/**
 * Determines the PFU position for one tyre.
 *
 * PRECEDENCE, strongest evidence first:
 *
 *   1. a PFU figure the supplier stated for this exact article;
 *   2. a verified tariff from VERIFIED_PFU_TARIFFS;
 *   3. the temporary owner-authorised ESTIMATE, when `allowEstimate` is set;
 *   4. TO_CONFIRM.
 *
 * The estimate is LAST on purpose. The day a real tariff is loaded into
 * VERIFIED_PFU_TARIFFS, step 2 starts answering and the estimate stops being
 * produced — with no change to any caller, and with historical orders keeping
 * the estimate they were priced with, because that amount and its version were
 * snapshotted onto the order row.
 *
 * `allowEstimate` defaults to TRUE, because the owner's V1 decision is that
 * ordering must not be blocked. Callers that must not see an estimate — an
 * accounting export, a supplier reconciliation — pass false and get
 * TO_CONFIRM, which is the honest answer for them.
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

  // Reached only once tariffs are loaded. Category/weight selection is
  // deliberately not written ahead of knowing the real tariff structure —
  // guessing the shape of a rule is the same error as guessing its value.
  //
  // (No verified tariff exists yet, so this block does nothing today. It is
  // written as a real branch rather than a TODO so that populating
  // VERIFIED_PFU_TARIFFS is the ONLY change needed to retire the estimate.)

  if (input.allowEstimate === false) {
    return unresolvedPfu(
      "No verified PFU tariff applies and an estimate was not permitted for this caller."
    );
  }

  return estimatedPfu(
    estimatePfu({ weightKg: input.weightKg ?? null, productClass: input.productClass ?? null })
  );
}

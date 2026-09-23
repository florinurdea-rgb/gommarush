// TEMPORARY PFU ESTIMATION.
//
// ============================================================================
// READ THIS BEFORE CHANGING ANYTHING HERE
// ============================================================================
//
// The amounts in PFU_ESTIMATE_BANDS are OWNER PLACEHOLDERS, not tariffs. They
// were not read from a published scheme, an invoice, or a supplier file,
// because no such evidence exists anywhere in this system — verified on
// 2026-09-23 against production: `document_charges` is empty, no
// `order_items.environmental_fee` is populated, none of the 57 imported
// documents mentions PFU, and neither supplier feed carries a PFU column.
//
// They exist so the owner can run a real end-to-end customer order while the
// real tariff (owner decision D3) is still being sourced. They are:
//
//   * deliberately ROUND, so no one can mistake them for a published figure;
//   * deliberately CONSERVATIVE (erring high rather than low), because an
//     under-estimate is money GommaRush absorbs silently, while an
//     over-estimate is visible and gets corrected;
//   * carried with a version id into every price and every order snapshot, so
//     an order priced with an estimate can be found again and re-priced.
//
// REPLACING THEM WITH REAL TARIFFS: do not edit these numbers. Populate
// VERIFIED_PFU_TARIFFS in pfu.ts instead. `resolvePfu` prefers a verified
// tariff over an estimate, so the estimate stops being used the moment real
// data exists — and historical orders keep the estimate they were created
// with, because the amount and its version are snapshotted on the order row.
//
// An estimate NEVER silently becomes a verified value: the status travels with
// the amount (`ESTIMATED`), it is a different value from `RULE_CALCULATED`,
// and no code path rewrites a stored status.
//
// Pure: no database, no I/O, no network, no model call. Deterministic — the
// same tyre always produces the same estimate, at checkout and forever after.

import type { Cents } from "@/lib/documents/pipeline/money";

/**
 * The identity of this estimation rule.
 *
 * BUMP THIS whenever a band boundary or an amount changes. It is written into
 * every order snapshot, so it is how a later reader answers "what did we
 * charge this customer, and by what rule?" without guessing from a date.
 *
 * The `-placeholder` suffix is not decoration. It is the machine-readable
 * admission that these magnitudes are unverified, and it should disappear only
 * when the numbers are replaced by a sourced tariff — at which point this file
 * should no longer be in use at all.
 */
export const PFU_ESTIMATE_VERSION = "gr-pfu-estimate-2026-09-placeholder-v1";

/** What the estimate was keyed on, recorded so a band can be audited. */
export type PfuEstimateBasis =
  /** The tyre's own supplier-reported weight fell in a band. */
  | "weight_band"
  /** No weight; the product class implied a band. */
  | "product_class"
  /** Neither was usable. The conservative catch-all applied. */
  | "fallback";

export interface PfuEstimate {
  readonly amountCents: Cents;
  readonly version: string;
  readonly basis: PfuEstimateBasis;
  /** The band or class key that produced it, for audit. */
  readonly bandKey: string;
  /** Why this band, in words an operator can check. */
  readonly rationale: string;
}

interface WeightBand {
  readonly key: string;
  /** Inclusive lower bound in kg. */
  readonly fromKg: number;
  /** Exclusive upper bound in kg; null means open-ended. */
  readonly toKg: number | null;
  readonly amountCents: Cents;
  readonly label: string;
}

/**
 * Weight bands, in ascending order.
 *
 * WHY WEIGHT. It is the physical quantity the real scheme charges against, it
 * is supplier-reported for 11,407 of 13,226 active products (86%), and it
 * differentiates within a product class — a 205/55 R16 and a 315/35 R21 are
 * both `passenger_car` and are not the same amount of rubber.
 *
 * The boundaries are drawn where the catalogue actually clusters (measured
 * 2026-09-23): 6,055 products at or below 11 kg, 5,138 between 11 and 20 kg,
 * 153 between 20 and 40 kg, 61 above 40 kg.
 */
export const PFU_ESTIMATE_BANDS: readonly WeightBand[] = [
  { key: "w<=11", fromKg: 0, toKg: 11, amountCents: 300, label: "Fino a 11 kg" },
  { key: "w11-20", fromKg: 11, toKg: 20, amountCents: 600, label: "11–20 kg" },
  { key: "w20-40", fromKg: 20, toKg: 40, amountCents: 1_200, label: "20–40 kg" },
  { key: "w>40", fromKg: 40, toKg: null, amountCents: 2_500, label: "Oltre 40 kg" },
];

/**
 * Product-class bands, used only when a tyre has no usable weight.
 *
 * Coarser than the weight bands on purpose: a class is a weaker signal, so the
 * estimate it produces should not look more precise than it is.
 */
const CLASS_BANDS: Readonly<Record<string, Cents>> = {
  scooter: 300,
  motorcycle: 300,
  passenger_car: 300,
  passenger_car_runflat: 600,
  suv_4x4: 600,
  light_truck_van: 600,
  truck: 2_500,
  spare: 300,
};

/**
 * Applied when neither weight nor class is usable.
 *
 * Set to the 11–20 kg amount rather than the lowest band. An unknown tyre is
 * more likely to be a large one — the 1,819 products without a weight skew
 * heavier than the catalogue as a whole — and under-estimating is the failure
 * that goes unnoticed, because nobody complains about being charged too little.
 */
const FALLBACK_AMOUNT_CENTS: Cents = 600;

/** Whether a weight figure can be used at all. */
function usableWeight(weightKg: number | null | undefined): number | null {
  if (weightKg === null || weightKg === undefined) return null;
  const value = Number(weightKg);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export interface PfuEstimateInput {
  readonly weightKg?: number | null;
  readonly productClass?: string | null;
}

/**
 * The temporary PFU estimate for one tyre.
 *
 * Deterministic and total: it always returns an amount, because the owner's
 * decision is that PFU must not block ordering in V1. The uncertainty is
 * carried in the RESULT (status, version, basis, rationale) rather than in
 * whether there is a result at all.
 */
export function estimatePfu(input: PfuEstimateInput = {}): PfuEstimate {
  const weight = usableWeight(input.weightKg);

  if (weight !== null) {
    const band =
      PFU_ESTIMATE_BANDS.find((b) => weight >= b.fromKg && (b.toKg === null || weight < b.toKg)) ??
      PFU_ESTIMATE_BANDS[PFU_ESTIMATE_BANDS.length - 1];

    return {
      amountCents: band.amountCents,
      version: PFU_ESTIMATE_VERSION,
      basis: "weight_band",
      bandKey: band.key,
      rationale: `Stima per fascia di peso ${band.label} (${weight.toFixed(2)} kg dichiarati dal fornitore).`,
    };
  }

  const productClass = (input.productClass ?? "").trim();
  const classAmount = CLASS_BANDS[productClass];
  if (classAmount !== undefined) {
    return {
      amountCents: classAmount,
      version: PFU_ESTIMATE_VERSION,
      basis: "product_class",
      bandKey: `class:${productClass}`,
      rationale: `Peso non disponibile; stima per categoria prodotto (${productClass}).`,
    };
  }

  return {
    amountCents: FALLBACK_AMOUNT_CENTS,
    version: PFU_ESTIMATE_VERSION,
    basis: "fallback",
    bandKey: "fallback",
    rationale: "Peso e categoria non disponibili; stima prudenziale di riserva.",
  };
}

/**
 * The disclosure shown wherever an estimated PFU appears.
 *
 * Owner-approved wording, kept here so every surface says exactly the same
 * thing and a future copy edit cannot reach one screen and miss another.
 */
export const PFU_ESTIMATE_DISCLOSURE = {
  it: "PFU stimato — l'importo definitivo può variare.",
  en: "Estimated PFU — final amount may change.",
} as const;

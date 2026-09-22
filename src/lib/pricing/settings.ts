// Central GommaRush pricing configuration.
//
// WHY THIS FILE EXISTS AT ALL: a markup is a commercial decision, and a
// commercial decision must not live inside a supplier adapter. If Inter-Sprint's
// importer multiplied a cost by 1.2, then the same tyre sourced from Deldo
// would need its own copy of that rule, and the two would drift the first time
// someone changed one. Every supplier lane feeds THIS layer.
//
// Nothing here is derived from supplier data. These are GommaRush's own
// business settings, and each one carries a provenance marker so a reader can
// tell an approved figure from a placeholder without having to ask.

/**
 * Where a configured figure came from. This is not decoration: `POLICY_OWNER`
 * means a human with the authority to set it did so, and `UNRESOLVED` means
 * the engine must refuse to use it rather than fall back to something
 * plausible.
 */
export type SettingProvenance =
  /** Set by the business owner. Usable. */
  | "POLICY_OWNER"
  /** A matter of public law, recorded here as configuration. Usable. */
  | "STATUTORY"
  /** No decision has been taken. NOT usable — the engine must fail closed. */
  | "UNRESOLVED";

/**
 * Whether PFU sits inside the VAT taxable base.
 *
 * Deliberately NOT a boolean. A boolean would have to default to something,
 * and both defaults are a tax position taken by an agent rather than an
 * accountant. `unresolved` is the honest third state and is the current value.
 */
export type PfuVatBasePolicy = "inside_vat_base" | "outside_vat_base" | "unresolved";

/** How a computed amount is reduced to whole cents. */
export type RoundingRule = "half_up_per_unit";

export interface PricingSettings {
  /**
   * Percentage added to supplier cost to reach the net selling price.
   *
   * MARKUP, NOT MARGIN. Cost 100 + 20% markup = 120 selling price, which is a
   * 16.67% gross margin on revenue. Conflating the two overstates
   * profitability by a third — see docs/architecture/03_PRICING_PFU_VAT.md.
   */
  markupPercent: number;
  markupProvenance: SettingProvenance;

  /**
   * Optional floor on gross profit per tyre, in cents. On a cheap tyre a
   * percentage markup earns too little to cover handling, so whichever of the
   * two is larger wins. Null means no floor is configured.
   */
  minimumProfitCents: number | null;
  minimumProfitProvenance: SettingProvenance;

  /** VAT rate as a percentage. Used only when its provenance permits. */
  vatRatePercent: number;
  vatRateProvenance: SettingProvenance;

  /** Whether PFU is taxed. See PfuVatBasePolicy — `unresolved` blocks totals. */
  pfuVatBase: PfuVatBasePolicy;

  rounding: RoundingRule;
}

/**
 * The settings the preview runs on today.
 *
 * `markupPercent: 20` is the owner's instruction for this commercial preview,
 * recorded as configuration rather than compiled into a calculation. Changing
 * it is a one-line edit here and affects every supplier lane at once.
 *
 * `vatRatePercent: 22` is the Italian ordinary rate — public law, not an
 * invention, and marked STATUTORY to say so. It still only applies to a
 * standard-rated supply; anything else is a commercialista's call.
 *
 * `pfuVatBase: "unresolved"` is the load-bearing one. The architecture
 * document's worked example assumes PFU is inside the VAT base, but that
 * assumption is explicitly flagged there as an open OWNER_DECISION, and the
 * accountant has not answered. Until they do, this engine will not produce a
 * customer total. Leaving it `unresolved` is what makes that refusal happen.
 */
export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  markupPercent: 20,
  markupProvenance: "POLICY_OWNER",

  minimumProfitCents: null,
  minimumProfitProvenance: "UNRESOLVED",

  vatRatePercent: 22,
  vatRateProvenance: "STATUTORY",

  pfuVatBase: "unresolved",

  rounding: "half_up_per_unit",
};

export class PricingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingConfigurationError";
  }
}

/** True when a provenance marker permits the figure to be used in arithmetic. */
export function isUsableProvenance(provenance: SettingProvenance): boolean {
  return provenance === "POLICY_OWNER" || provenance === "STATUTORY";
}

/**
 * Rejects settings that could produce a wrong number rather than no number.
 *
 * Called at the top of every calculation. A negative markup, a NaN rate or a
 * VAT rate above 100 are all configuration mistakes, and a configuration
 * mistake that silently prices 9,550 tyres is far more expensive than a throw.
 */
export function assertPricingSettings(settings: PricingSettings): PricingSettings {
  const finite = (value: number, field: string) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new PricingConfigurationError(`${field} must be a finite number, received ${String(value)}`);
    }
  };

  finite(settings.markupPercent, "markupPercent");
  if (settings.markupPercent < 0) {
    throw new PricingConfigurationError(
      `markupPercent must not be negative, received ${settings.markupPercent}. Selling below cost is a deliberate commercial act, not a pricing default.`
    );
  }

  finite(settings.vatRatePercent, "vatRatePercent");
  if (settings.vatRatePercent < 0 || settings.vatRatePercent > 100) {
    throw new PricingConfigurationError(
      `vatRatePercent must be between 0 and 100, received ${settings.vatRatePercent}`
    );
  }

  if (settings.minimumProfitCents !== null) {
    finite(settings.minimumProfitCents, "minimumProfitCents");
    if (!Number.isInteger(settings.minimumProfitCents) || settings.minimumProfitCents < 0) {
      throw new PricingConfigurationError(
        `minimumProfitCents must be a non-negative integer number of cents, received ${settings.minimumProfitCents}`
      );
    }
  }

  return settings;
}

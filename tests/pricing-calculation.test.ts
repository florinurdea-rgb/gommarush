import { describe, expect, it } from "vitest";
import {
  calculateTyrePrice,
  grossMarginPercent,
  grossProfitCents,
} from "@/lib/pricing/calculate";
import {
  DEFAULT_PRICING_SETTINGS,
  PricingConfigurationError,
  assertPricingSettings,
  type PricingSettings,
} from "@/lib/pricing/settings";
import { resolvePfu, resolvedPfu, unresolvedPfu, VERIFIED_PFU_TARIFFS } from "@/lib/pricing/pfu";

/**
 * The pricing arithmetic and, more importantly, the refusals.
 *
 * Most of these tests assert that a number is ABSENT. That is deliberate: the
 * expensive failure mode in this system is not a price that is slightly wrong,
 * it is a price that looks complete while a component was quietly treated as
 * zero. Each "expect(...).toBeNull()" below is one of those.
 */

/** Settings with PFU and VAT fully resolved, for arithmetic tests. */
const RESOLVED_SETTINGS: PricingSettings = {
  ...DEFAULT_PRICING_SETTINGS,
  pfuVatBase: "inside_vat_base",
};

const PFU_250 = resolvedPfu("MANUAL_CONFIRMED", 250, null, "Test fixture.");

describe("configured markup arithmetic", () => {
  it("applies the configured 20% markup to supplier cost", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      RESOLVED_SETTINGS
    );

    expect(result.markupPercentApplied).toBe(20);
    expect(result.markupAmountCents).toBe(2_000);
    expect(result.tyreSaleNetCents).toBe(12_000);
  });

  it("ships 20% as the configured preview markup", () => {
    expect(DEFAULT_PRICING_SETTINGS.markupPercent).toBe(20);
    expect(DEFAULT_PRICING_SETTINGS.markupProvenance).toBe("POLICY_OWNER");
  });

  /**
   * The distinction the architecture document is emphatic about: a 20% markup
   * is a 16.67% gross margin, not a 20% one. Conflating them overstates
   * profitability by a third.
   */
  it("reports gross profit and gross margin as different numbers", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      RESOLVED_SETTINGS
    );

    expect(grossProfitCents(result)).toBe(2_000);
    expect(grossMarginPercent(result)).toBeCloseTo(16.6667, 3);
  });

  it("rounds half up to whole cents rather than carrying a fraction", () => {
    // 1.23 EUR * 20% = 0.246 EUR = 24.6 cents -> 25.
    const result = calculateTyrePrice({ supplierCostCents: 123, pfu: PFU_250 }, RESOLVED_SETTINGS);
    expect(result.markupAmountCents).toBe(25);
    expect(result.tyreSaleNetCents).toBe(148);
  });

  it("recomputes when the configured markup changes, with no code change", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      { ...RESOLVED_SETTINGS, markupPercent: 35 }
    );
    expect(result.markupAmountCents).toBe(3_500);
    expect(result.tyreSaleNetCents).toBe(13_500);
  });
});

describe("minimum profit per tyre", () => {
  it("lifts a thin percentage markup to the configured floor", () => {
    // Cost 40.00, 20% = 8.00, floor 10.00 -> the floor wins.
    const result = calculateTyrePrice(
      { supplierCostCents: 4_000, pfu: PFU_250 },
      {
        ...RESOLVED_SETTINGS,
        minimumProfitCents: 1_000,
        minimumProfitProvenance: "POLICY_OWNER",
      }
    );

    expect(result.minimumProfitApplied).toBe(true);
    expect(result.markupAmountCents).toBe(1_000);
    expect(result.tyreSaleNetCents).toBe(5_000);
  });

  it("leaves a healthy percentage markup alone", () => {
    // Cost 100.00, 20% = 20.00, floor 10.00 -> the percentage wins.
    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      {
        ...RESOLVED_SETTINGS,
        minimumProfitCents: 1_000,
        minimumProfitProvenance: "POLICY_OWNER",
      }
    );

    expect(result.minimumProfitApplied).toBe(false);
    expect(result.markupAmountCents).toBe(2_000);
  });

  /** An unapproved floor is not a floor. Provenance gates the value. */
  it("ignores a minimum profit whose provenance is unresolved", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 4_000, pfu: PFU_250 },
      { ...RESOLVED_SETTINGS, minimumProfitCents: 1_000, minimumProfitProvenance: "UNRESOLVED" }
    );

    expect(result.minimumProfitApplied).toBe(false);
    expect(result.markupAmountCents).toBe(800);
  });

  it("ships with no minimum profit configured", () => {
    expect(DEFAULT_PRICING_SETTINGS.minimumProfitCents).toBeNull();
  });
});

describe("PFU receives no markup", () => {
  it("adds PFU after the markup, never inside its base", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      RESOLVED_SETTINGS
    );

    // Markup is 20% of 100.00 only. If PFU were in the base it would be 20%
    // of 102.50 = 2050, and the subtotal would be 12,300 rather than 12,250.
    expect(result.markupAmountCents).toBe(2_000);
    expect(result.taxableSubtotalCents).toBe(12_250);
  });

  it("keeps the markup identical however large the PFU is", () => {
    const small = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: resolvedPfu("MANUAL_CONFIRMED", 100, null, "x") },
      RESOLVED_SETTINGS
    );
    const large = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: resolvedPfu("MANUAL_CONFIRMED", 9_999, null, "x") },
      RESOLVED_SETTINGS
    );

    expect(small.markupAmountCents).toBe(large.markupAmountCents);
    expect(small.tyreSaleNetCents).toBe(large.tyreSaleNetCents);
  });
});

describe("TO_CONFIRM stays unresolved and never becomes zero", () => {
  it("ships no verified tariff data", () => {
    expect(VERIFIED_PFU_TARIFFS).toHaveLength(0);
  });

  it("resolves every Inter-Sprint listing to TO_CONFIRM today", () => {
    const pfu = resolvePfu({ weightKg: 8.5, productClass: "passenger_car" });
    expect(pfu.status).toBe("TO_CONFIRM");
    expect(pfu.amountCents).toBeNull();
  });

  /** A weight is not a tariff. This is the invention the module exists to stop. */
  it("refuses to turn a weight into an amount", () => {
    for (const weightKg of [6, 8.5, 11.2, 25]) {
      expect(resolvePfu({ weightKg }).amountCents).toBeNull();
    }
  });

  it("blocks the subtotal and total rather than treating PFU as zero", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: unresolvedPfu("No verified tariff.") },
      RESOLVED_SETTINGS
    );

    expect(result.resolution).toBe("pfu_unresolved");
    expect(result.pfuStatus).toBe("TO_CONFIRM");
    expect(result.pfuAmountCents).toBeNull();
    expect(result.taxableSubtotalCents).toBeNull();
    expect(result.vatAmountCents).toBeNull();
    expect(result.customerTotalCents).toBeNull();
    // The part we DO know is still reported — the net selling price is usable
    // for B2B comparison even while the levy is open.
    expect(result.tyreSaleNetCents).toBe(12_000);
    expect(result.blockedReasons).toHaveLength(1);
  });

  it("accepts a supplier-stated PFU when one is supplied", () => {
    const pfu = resolvePfu({ supplierStatedCents: 316 });
    expect(pfu.status).toBe("SUPPLIER_EXACT");
    expect(pfu.amountCents).toBe(316);
  });

  it("refuses a supplier PFU figure that is not a clean amount", () => {
    expect(resolvePfu({ supplierStatedCents: -1 }).status).toBe("TO_CONFIRM");
    expect(resolvePfu({ supplierStatedCents: 3.5 }).status).toBe("TO_CONFIRM");
  });
});

describe("VAT comes only from explicit configuration", () => {
  /**
   * D11 was RESOLVED by the owner on 2026-09-23: PFU sits inside the VAT base.
   * The shipped settings therefore no longer block on the accounting position,
   * and this asserts the new state rather than the old one — a test still
   * expecting "unresolved" would be describing a decision that has been taken.
   */
  it("carries the owner-resolved PFU VAT position and taxes PFU with it", () => {
    expect(DEFAULT_PRICING_SETTINGS.pfuVatBase).toBe("inside_vat_base");

    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      DEFAULT_PRICING_SETTINGS
    );

    // tyre net 120.00 + PFU 2.50 = 122.50 taxable, x 22% = 26.95.
    expect(result.resolution).toBe("complete");
    expect(result.taxableSubtotalCents).toBe(12_250);
    expect(result.vatAmountCents).toBe(2_695);
    expect(result.customerTotalCents).toBe(14_945);
  });

  /**
   * The refusal that still matters. D3 — the tariff itself — is open, so a real
   * catalogue tyre resolves its PFU to TO_CONFIRM and no total is produced.
   * Resolving the VAT position moved the refusal one step EARLIER; it did not
   * remove it.
   */
  it("still produces no total for a real tyre, because no PFU tariff exists", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: resolvePfu({ weightKg: 8.5 }) },
      DEFAULT_PRICING_SETTINGS
    );

    expect(result.resolution).toBe("pfu_unresolved");
    expect(result.pfuAmountCents).toBeNull();
    expect(result.taxableSubtotalCents).toBeNull();
    expect(result.customerTotalCents).toBeNull();
    // The net selling price is knowable and stays available.
    expect(result.tyreSaleNetCents).toBe(12_000);
  });

  it("still refuses VAT when a settings object leaves the position unresolved", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      { ...RESOLVED_SETTINGS, pfuVatBase: "unresolved" }
    );

    expect(result.resolution).toBe("vat_policy_unresolved");
    expect(result.vatAmountCents).toBeNull();
    expect(result.customerTotalCents).toBeNull();
    expect(result.taxableSubtotalCents).toBe(12_250);
  });

  it("produces no VAT when the rate has no approved provenance", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      { ...RESOLVED_SETTINGS, vatRateProvenance: "UNRESOLVED" }
    );

    expect(result.resolution).toBe("vat_policy_unresolved");
    expect(result.vatAmountCents).toBeNull();
  });

  it("taxes PFU when policy puts it inside the base", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      { ...RESOLVED_SETTINGS, pfuVatBase: "inside_vat_base" }
    );

    // 22% of 122.50 = 26.95
    expect(result.vatAmountCents).toBe(2_695);
    expect(result.customerTotalCents).toBe(14_945);
  });

  it("taxes only the tyre when policy puts PFU outside the base", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      { ...RESOLVED_SETTINGS, pfuVatBase: "outside_vat_base" }
    );

    // 22% of 120.00 = 26.40; the levy is added untaxed.
    expect(result.vatAmountCents).toBe(2_640);
    expect(result.customerTotalCents).toBe(14_890);
  });

  /** The two policies must give different totals, or the flag does nothing. */
  it("makes the VAT base policy change the customer total", () => {
    const inside = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      { ...RESOLVED_SETTINGS, pfuVatBase: "inside_vat_base" }
    );
    const outside = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      { ...RESOLVED_SETTINGS, pfuVatBase: "outside_vat_base" }
    );

    expect(inside.customerTotalCents).not.toBe(outside.customerTotalCents);
  });
});

describe("missing supplier cost cannot produce a sell price", () => {
  it("refuses a null cost outright", () => {
    const result = calculateTyrePrice({ supplierCostCents: null, pfu: PFU_250 }, RESOLVED_SETTINGS);

    expect(result.resolution).toBe("cost_unavailable");
    expect(result.supplierCostCents).toBeNull();
    expect(result.markupAmountCents).toBeNull();
    expect(result.tyreSaleNetCents).toBeNull();
    expect(result.customerTotalCents).toBeNull();
    expect(result.blockedReasons[0]).toContain("No supplier purchase cost");
  });

  /**
   * The specific failure this guards: a missing cost read as 0 would price the
   * tyre at pure markup on nothing, producing a confident 0.00 selling price.
   */
  it("does not treat a missing cost as a cost of zero", () => {
    const missing = calculateTyrePrice(
      { supplierCostCents: null, pfu: PFU_250 },
      RESOLVED_SETTINGS
    );
    const free = calculateTyrePrice({ supplierCostCents: 0, pfu: PFU_250 }, RESOLVED_SETTINGS);

    expect(missing.resolution).toBe("cost_unavailable");
    expect(missing.tyreSaleNetCents).toBeNull();
    // A genuine zero cost is a different statement and still calculates.
    expect(free.resolution).toBe("complete");
    expect(free.tyreSaleNetCents).toBe(0);
  });

  it("refuses a negative or fractional cost rather than rounding it", () => {
    expect(
      calculateTyrePrice({ supplierCostCents: -100, pfu: PFU_250 }, RESOLVED_SETTINGS).resolution
    ).toBe("cost_unavailable");
    expect(
      calculateTyrePrice({ supplierCostCents: 10.5, pfu: PFU_250 }, RESOLVED_SETTINGS).resolution
    ).toBe("cost_unavailable");
  });

  it("refuses to price at all when no approved markup is configured", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: PFU_250 },
      { ...RESOLVED_SETTINGS, markupProvenance: "UNRESOLVED" }
    );

    expect(result.resolution).toBe("cost_unavailable");
    expect(result.tyreSaleNetCents).toBeNull();
  });
});

describe("pricing configuration validation", () => {
  it("rejects a negative markup", () => {
    expect(() =>
      assertPricingSettings({ ...RESOLVED_SETTINGS, markupPercent: -5 })
    ).toThrow(PricingConfigurationError);
  });

  it("rejects a non-finite markup", () => {
    expect(() =>
      assertPricingSettings({ ...RESOLVED_SETTINGS, markupPercent: Number.NaN })
    ).toThrow(PricingConfigurationError);
  });

  it("rejects a VAT rate outside 0-100", () => {
    expect(() =>
      assertPricingSettings({ ...RESOLVED_SETTINGS, vatRatePercent: 120 })
    ).toThrow(PricingConfigurationError);
  });

  it("rejects a fractional minimum profit in cents", () => {
    expect(() =>
      assertPricingSettings({ ...RESOLVED_SETTINGS, minimumProfitCents: 10.5 })
    ).toThrow(PricingConfigurationError);
  });

  it("accepts the settings the preview actually ships with", () => {
    expect(() => assertPricingSettings(DEFAULT_PRICING_SETTINGS)).not.toThrow();
  });
});

describe("the full chain, end to end", () => {
  it("keeps every component separate and auditable", () => {
    const result = calculateTyrePrice(
      { supplierCostCents: 6_150, pfu: resolvedPfu("SUPPLIER_EXACT", 316, null, "Supplier.") },
      RESOLVED_SETTINGS
    );

    // 61.50 cost + 12.30 markup = 73.80 net
    // 73.80 + 3.16 PFU            = 76.96 taxable
    // 22% of 76.96                = 16.93 VAT
    //                              = 93.89 total
    expect(result.supplierCostCents).toBe(6_150);
    expect(result.markupAmountCents).toBe(1_230);
    expect(result.tyreSaleNetCents).toBe(7_380);
    expect(result.pfuAmountCents).toBe(316);
    expect(result.taxableSubtotalCents).toBe(7_696);
    expect(result.vatAmountCents).toBe(1_693);
    expect(result.customerTotalCents).toBe(9_389);
    expect(result.resolution).toBe("complete");
    expect(result.blockedReasons).toEqual([]);
  });
});

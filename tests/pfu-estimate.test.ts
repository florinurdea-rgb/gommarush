import { describe, expect, it } from "vitest";
import {
  estimatePfu,
  PFU_ESTIMATE_BANDS,
  PFU_ESTIMATE_DISCLOSURE,
  PFU_ESTIMATE_VERSION,
} from "@/lib/pricing/pfu-estimate";
import {
  estimatedPfu,
  isResolvedPfuStatus,
  isVerifiedPfuStatus,
  resolvePfu,
  resolvedPfu,
  VERIFIED_PFU_TARIFFS,
} from "@/lib/pricing/pfu";
import { calculateTyrePrice } from "@/lib/pricing/calculate";
import { DEFAULT_PRICING_SETTINGS } from "@/lib/pricing/settings";

/**
 * The temporary PFU estimate.
 *
 * The owner authorised it on 2026-09-23 so that PFU stops blocking V1 orders.
 * These tests are about the things that must remain true WHILE it is in use —
 * every one of them is a way the estimate could quietly turn into a fact.
 */

describe("the estimate is deterministic and offline", () => {
  it("returns the same amount for the same tyre, every time", () => {
    const a = estimatePfu({ weightKg: 8.238, productClass: "passenger_car" });
    const b = estimatePfu({ weightKg: 8.238, productClass: "passenger_car" });
    expect(a).toEqual(b);
  });

  it("always produces an amount, so checkout is never blocked by it", () => {
    const inputs = [
      {},
      { weightKg: null, productClass: null },
      { weightKg: 0 },
      { weightKg: -5 },
      { weightKg: Number.NaN },
      { productClass: "something_nobody_defined" },
      { weightKg: 9_999 },
    ];
    for (const input of inputs) {
      const estimate = estimatePfu(input);
      expect(Number.isInteger(estimate.amountCents)).toBe(true);
      expect(estimate.amountCents).toBeGreaterThan(0);
      expect(estimate.version).toBe(PFU_ESTIMATE_VERSION);
    }
  });
});

describe("the estimate bands", () => {
  /** Boundaries measured against the real catalogue on 2026-09-23. */
  it("bands by weight, ascending, with no gaps or overlaps", () => {
    for (let i = 1; i < PFU_ESTIMATE_BANDS.length; i += 1) {
      expect(PFU_ESTIMATE_BANDS[i].fromKg).toBe(PFU_ESTIMATE_BANDS[i - 1].toKg);
      expect(PFU_ESTIMATE_BANDS[i].amountCents).toBeGreaterThan(
        PFU_ESTIMATE_BANDS[i - 1].amountCents
      );
    }
    expect(PFU_ESTIMATE_BANDS[PFU_ESTIMATE_BANDS.length - 1].toKg).toBeNull();
  });

  it("places real catalogue weights in the band they belong to", () => {
    expect(estimatePfu({ weightKg: 4.24 }).amountCents).toBe(300); // lightest car tyre
    expect(estimatePfu({ weightKg: 9.86 }).amountCents).toBe(300); // average car tyre
    expect(estimatePfu({ weightKg: 14.21 }).amountCents).toBe(600); // average SUV tyre
    expect(estimatePfu({ weightKg: 34.42 }).amountCents).toBe(1_200); // heaviest SUV tyre
    expect(estimatePfu({ weightKg: 93 }).amountCents).toBe(2_500); // heaviest in catalogue
  });

  it("puts a boundary weight in the upper band, not both", () => {
    expect(estimatePfu({ weightKg: 10.99 }).amountCents).toBe(300);
    expect(estimatePfu({ weightKg: 11 }).amountCents).toBe(600);
    expect(estimatePfu({ weightKg: 19.99 }).amountCents).toBe(600);
    expect(estimatePfu({ weightKg: 20 }).amountCents).toBe(1_200);
  });

  /**
   * 1,819 of 13,226 active products have no weight (weight_status
   * 'missing_or_zero'). They must still be orderable.
   */
  it("falls back to the product class when a weight is missing", () => {
    const estimate = estimatePfu({ weightKg: null, productClass: "suv_4x4" });
    expect(estimate.basis).toBe("product_class");
    expect(estimate.amountCents).toBe(600);
  });

  it("falls back conservatively when neither weight nor class is usable", () => {
    const estimate = estimatePfu({});
    expect(estimate.basis).toBe("fallback");
    // The 11-20 kg amount, not the lowest: an under-estimate is the failure
    // nobody notices, because nobody complains about paying too little.
    expect(estimate.amountCents).toBe(600);
    expect(estimate.amountCents).toBeGreaterThan(PFU_ESTIMATE_BANDS[0].amountCents);
  });

  it("prefers the tyre's own weight over its class", () => {
    // A heavy tyre in a light class is estimated on the weight.
    const estimate = estimatePfu({ weightKg: 25, productClass: "passenger_car" });
    expect(estimate.basis).toBe("weight_band");
    expect(estimate.amountCents).toBe(1_200);
  });

  /** Round figures signal an estimate; a value like 287 would look sourced. */
  it("uses round amounts that cannot be mistaken for a published tariff", () => {
    for (const band of PFU_ESTIMATE_BANDS) {
      expect(band.amountCents % 100).toBe(0);
    }
  });
});

describe("an estimate can never be mistaken for a verified figure", () => {
  it("carries a status that is resolved but NOT verified", () => {
    const pfu = resolvePfu({ weightKg: 8.5 });
    expect(pfu.status).toBe("ESTIMATED");
    expect(isResolvedPfuStatus(pfu.status), "it carries an amount").toBe(true);
    expect(isVerifiedPfuStatus(pfu.status), "but it is not evidence").toBe(false);
  });

  it("cannot exist without the version that explains it", () => {
    const pfu = resolvePfu({ weightKg: 8.5 });
    expect(pfu.estimate).not.toBeNull();
    expect(pfu.estimate?.version).toBe(PFU_ESTIMATE_VERSION);
    expect(pfu.tariff, "and it is backed by no tariff").toBeNull();
  });

  it("declares in its own version id that it is a placeholder", () => {
    expect(PFU_ESTIMATE_VERSION).toContain("placeholder");
  });

  /** A verified resolution must not acquire an estimate object by accident. */
  it("keeps verified resolutions free of estimate metadata", () => {
    const verified = resolvedPfu("MANUAL_CONFIRMED", 250, null, "Entered from a document.");
    expect(verified.estimate).toBeNull();
    expect(isVerifiedPfuStatus(verified.status)).toBe(true);
  });

  it("refuses an estimate that is not a whole number of cents", () => {
    expect(() =>
      estimatedPfu({
        amountCents: 2.5,
        version: "x",
        basis: "fallback",
        bandKey: "x",
        rationale: "x",
      })
    ).toThrow();
  });
});

describe("a verified tariff will retire the estimate without a code change", () => {
  /**
   * The precedence that makes the estimate temporary rather than permanent:
   * a supplier-stated figure already wins today, which is the same branch a
   * verified tariff will take.
   */
  it("prefers a supplier-stated figure over the estimate", () => {
    const pfu = resolvePfu({ supplierStatedCents: 275, weightKg: 8.5 });
    expect(pfu.status).toBe("SUPPLIER_EXACT");
    expect(pfu.amountCents).toBe(275);
    expect(pfu.estimate).toBeNull();
  });

  it("still ships no verified tariff data, so D3 is genuinely still open", () => {
    expect(VERIFIED_PFU_TARIFFS).toHaveLength(0);
  });

  it("lets a caller opt out of estimates entirely", () => {
    const pfu = resolvePfu({ weightKg: 8.5, allowEstimate: false });
    expect(pfu.status).toBe("TO_CONFIRM");
    expect(pfu.amountCents).toBeNull();
    expect(pfu.estimate).toBeNull();
  });
});

describe("the estimate flows into the price with its disclosure", () => {
  it("adds PFU to the VAT base and taxes the sum at 22%", () => {
    const breakdown = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: resolvePfu({ weightKg: 8.5 }) },
      DEFAULT_PRICING_SETTINGS
    );

    expect(breakdown.tyreSaleNetCents).toBe(12_000);
    expect(breakdown.pfuAmountCents).toBe(300);
    expect(breakdown.taxableSubtotalCents).toBe(12_300);
    expect(breakdown.vatRatePercentApplied).toBe(22);
    expect(breakdown.vatAmountCents).toBe(2_706);
    expect(breakdown.customerTotalCents).toBe(15_006);
  });

  it("marks the breakdown as estimated and names the rule", () => {
    const breakdown = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: resolvePfu({ weightKg: 8.5 }) },
      DEFAULT_PRICING_SETTINGS
    );
    expect(breakdown.pfuEstimated).toBe(true);
    expect(breakdown.pfuEstimateVersion).toBe(PFU_ESTIMATE_VERSION);
  });

  it("does not mark a supplier-stated PFU as estimated", () => {
    const breakdown = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: resolvePfu({ supplierStatedCents: 275 }) },
      DEFAULT_PRICING_SETTINGS
    );
    expect(breakdown.pfuEstimated).toBe(false);
    expect(breakdown.pfuEstimateVersion).toBeNull();
  });

  /** PFU is a levy, never a margin base. */
  it("never marks the PFU up", () => {
    const breakdown = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: resolvePfu({ weightKg: 8.5 }) },
      DEFAULT_PRICING_SETTINGS
    );
    expect(breakdown.markupAmountCents).toBe(2_000);
    expect(breakdown.pfuAmountCents).toBe(300);
    expect(breakdown.tyreSaleNetCents).toBe(12_000);
  });

  it("carries the owner's exact disclosure wording in both languages", () => {
    expect(PFU_ESTIMATE_DISCLOSURE.it).toBe("PFU stimato — l'importo definitivo può variare.");
    expect(PFU_ESTIMATE_DISCLOSURE.en).toBe("Estimated PFU — final amount may change.");
  });

  it("has that wording available to the UI in both locales", async () => {
    const { translate } = await import("@/lib/i18n/admin-strings");
    const key = "PFU stimato — l'importo definitivo può variare.";
    expect(translate(key, "it")).toBe(PFU_ESTIMATE_DISCLOSURE.it);
    expect(translate(key, "en")).toBe(PFU_ESTIMATE_DISCLOSURE.en);
  });
});

describe("the order snapshot can be found again", () => {
  /**
   * The point of recording the version: when a real tariff arrives, "which
   * orders were priced with the estimate, and under which rule?" must be a
   * query, not an archaeology exercise.
   */
  it("keeps the estimate version on the line that used it", async () => {
    const { toCustomerOffer, toInternalOffer } = await import("@/lib/pricing/projection");
    const breakdown = calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: resolvePfu({ weightKg: 8.5 }) },
      DEFAULT_PRICING_SETTINGS
    );
    const listing = {
      tyre: {
        productId: "p1", brand: "B", modelPattern: "M", description: null,
        sizeDisplay: "205/55 R16", widthMm: 205, aspectRatio: 55, rimInch: 16,
        loadIndex: "91", speedRating: "V", loadSpeedRaw: "91V", season: "summer",
        productClass: "passenger_car", xl: false, runFlat: false, oldDot: false, eprelId: null,
      },
      availability: "in_stock" as const,
      supplierListingId: "l-1",
      supplierName: "SECRET",
      supplierArticleId: "SECRET-SKU",
      costObservedAt: "2026-09-22T14:00:00Z",
      breakdown,
      supplierStockExact: 20,
      supplierStockMinimum: null,
      supplierStockRaw: "20",
      sellability: { sellable: true, reason: "sellable" as const, assessedQuantity: 20, minimumApplied: 5 },
    };

    // Both audiences carry it: the customer needs the disclosure, the
    // operator needs the audit trail.
    expect(toCustomerOffer(listing).pfuEstimateVersion).toBe(PFU_ESTIMATE_VERSION);
    expect(toInternalOffer(listing).pfuEstimateVersion).toBe(PFU_ESTIMATE_VERSION);
    expect(toCustomerOffer(listing).pfuEstimated).toBe(true);

    // ...and the customer one still carries no supplier identity.
    const json = JSON.stringify(toCustomerOffer(listing));
    expect(json).not.toContain("SECRET");
  });
});

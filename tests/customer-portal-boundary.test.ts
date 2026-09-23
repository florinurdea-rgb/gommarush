import { describe, expect, it } from "vitest";
import { calculateTyrePrice } from "@/lib/pricing/calculate";
import { DEFAULT_PRICING_SETTINGS } from "@/lib/pricing/settings";
import { isVerifiedPfuStatus, resolvePfu, VERIFIED_PFU_TARIFFS } from "@/lib/pricing/pfu";
import { PFU_ESTIMATE_VERSION } from "@/lib/pricing/pfu-estimate";
import { isDeliverableLocation, isRealAddressField } from "@/lib/commerce/delivery-address";
import { validateBasketLines } from "@/lib/server/customer-basket";

/**
 * Portal safety properties that are NOT about one payload's shape.
 *
 * The confidentiality boundary is exercised end to end in
 * tests/customer-catalogue.test.ts, against rows that genuinely carry supplier
 * internals. Asserting that a hand-written `CustomerTyreOffer` literal lacks a
 * field its own type does not declare proves nothing about the route: it would
 * pass unchanged while the route returned internal offers.
 */

describe("an estimated PFU is never presented as a verified one", () => {
  /**
   * The owner decided on 2026-09-23 that PFU must not block V1 ordering, so a
   * total IS now produced. The safety property did not disappear — it moved.
   * What must hold is that the total is built from an amount which declares
   * itself an estimate, and which no verified-only caller will accept.
   */
  it("produces a total from the estimate, and marks it as an estimate", () => {
    const pfu = resolvePfu({ weightKg: 8.5, productClass: "passenger_car" });
    const breakdown = calculateTyrePrice({ supplierCostCents: 10_000, pfu }, DEFAULT_PRICING_SETTINGS);

    expect(breakdown.resolution).toBe("complete");
    expect(breakdown.pfuStatus).toBe("ESTIMATED");
    expect(breakdown.pfuEstimated).toBe(true);
    expect(breakdown.pfuEstimateVersion).toBe(PFU_ESTIMATE_VERSION);

    // 120.00 net + 3.00 PFU = 123.00 taxable, x 22% = 27.06, total 150.06.
    expect(breakdown.tyreSaleNetCents).toBe(12_000);
    expect(breakdown.pfuAmountCents).toBe(300);
    expect(breakdown.taxableSubtotalCents).toBe(12_300);
    expect(breakdown.vatAmountCents).toBe(2_706);
    expect(breakdown.customerTotalCents).toBe(15_006);
  });

  it("is never counted as verified, whatever else is true of it", () => {
    const pfu = resolvePfu({ weightKg: 8.5 });
    expect(isVerifiedPfuStatus(pfu.status)).toBe(false);
    expect(pfu.tariff, "an estimate has no tariff behind it").toBeNull();
    expect(pfu.estimate?.version).toBe(PFU_ESTIMATE_VERSION);
  });

  /**
   * The escape hatch that keeps the original guarantee available. Anything
   * that must show a defensible figure — an invoice, an accounting export —
   * asks for no estimate and gets the honest refusal instead.
   */
  it("still refuses outright for a caller that cannot accept an estimate", () => {
    const pfu = resolvePfu({ weightKg: 11.2, productClass: "truck", allowEstimate: false });
    expect(pfu.status).toBe("TO_CONFIRM");
    expect(pfu.amountCents).toBeNull();

    const breakdown = calculateTyrePrice({ supplierCostCents: 10_000, pfu }, DEFAULT_PRICING_SETTINGS);
    expect(breakdown.resolution).toBe("pfu_unresolved");
    expect(breakdown.customerTotalCents).toBeNull();
  });

  /** No verified tariff has appeared; the estimate is standing in for one. */
  it("still has no verified tariff table", () => {
    expect(VERIFIED_PFU_TARIFFS).toHaveLength(0);
  });
});

describe("delivery addresses", () => {
  /**
   * `createCustomerLocation` writes "—" into the NOT NULL address columns when
   * a document import has no address. That placeholder must never become a
   * commercial delivery commitment.
   */
  it("rejects the placeholder the importer writes", () => {
    expect(isDeliverableLocation({ address_line1: "—", city: "—" })).toBe(false);
    expect(isDeliverableLocation({ address_line1: "—", city: "Verona" })).toBe(false);
    expect(isDeliverableLocation({ address_line1: "Via Roma 1", city: "—" })).toBe(false);
  });

  it("rejects the other ways a required field gets filled in with nothing", () => {
    for (const value of ["", "   ", "-", "--", "–", ".", "n/a", "N/A", "nd"]) {
      expect(isRealAddressField(value), `"${value}" is not an address`).toBe(false);
    }
  });

  it("accepts a real address", () => {
    expect(isDeliverableLocation({ address_line1: "Via Roma 1", city: "Verona" })).toBe(true);
  });

  it("rejects a missing location rather than treating absence as valid", () => {
    expect(isDeliverableLocation(null)).toBe(false);
    expect(isDeliverableLocation(undefined)).toBe(false);
  });
});

describe("basket input is not trusted", () => {
  it("accepts only product id, condition and quantity", () => {
    const lines = validateBasketLines([
      {
        productId: "11111111-1111-1111-1111-111111111111",
        oldDot: false,
        quantity: 4,
        // A browser-supplied price must not survive validation.
        tyreSaleNetCents: 1,
        supplierListingId: "l-1",
      },
    ]);
    expect(lines).toEqual([
      { productId: "11111111-1111-1111-1111-111111111111", oldDot: false, quantity: 4 },
    ]);
  });

  it("rejects a duplicated product+condition rather than pricing it twice", () => {
    const line = { productId: "11111111-1111-1111-1111-111111111111", oldDot: false, quantity: 2 };
    expect(validateBasketLines([line, { ...line }])).toBeNull();
  });

  it("allows the same product in both stock conditions", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(
      validateBasketLines([
        { productId: id, oldDot: false, quantity: 2 },
        { productId: id, oldDot: true, quantity: 2 },
      ])
    ).toHaveLength(2);
  });

  it("rejects empty, malformed, oversized and non-integer quantities", () => {
    expect(validateBasketLines([])).toBeNull();
    expect(validateBasketLines(null)).toBeNull();
    expect(validateBasketLines("4")).toBeNull();
    expect(validateBasketLines([{ productId: "short", oldDot: false, quantity: 1 }])).toBeNull();
    expect(validateBasketLines([{ productId: "x".repeat(65), oldDot: false, quantity: 1 }])).toBeNull();
    expect(validateBasketLines([{ productId: "11111111", oldDot: false, quantity: 0 }])).toBeNull();
    expect(validateBasketLines([{ productId: "11111111", oldDot: false, quantity: 101 }])).toBeNull();
    expect(validateBasketLines([{ productId: "11111111", oldDot: false, quantity: 1.5 }])).toBeNull();
    expect(validateBasketLines([{ productId: "11111111", oldDot: "no", quantity: 1 }])).toBeNull();
    expect(validateBasketLines(Array.from({ length: 51 }, (_, i) => ({
      productId: `1111111${i}`,
      oldDot: false,
      quantity: 1,
    })))).toBeNull();
  });
});

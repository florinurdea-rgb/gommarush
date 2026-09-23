import { describe, expect, it } from "vitest";
import { calculateTyrePrice } from "@/lib/pricing/calculate";
import { DEFAULT_PRICING_SETTINGS } from "@/lib/pricing/settings";
import { resolvePfu } from "@/lib/pricing/pfu";
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

describe("money fails closed while PFU policy is unresolved", () => {
  /**
   * The load-bearing property of the whole checkout gate. If this ever starts
   * returning `complete`, PFU or its VAT treatment has been resolved — or
   * invented — and the change must be deliberate rather than noticed later by
   * a customer seeing a total GommaRush cannot stand behind.
   */
  it("cannot produce a final customer total from real settings", () => {
    const pfu = resolvePfu({ weightKg: 8.5, productClass: "passenger_car" });
    const breakdown = calculateTyrePrice({ supplierCostCents: 10_000, pfu }, DEFAULT_PRICING_SETTINGS);

    expect(breakdown.resolution).not.toBe("complete");
    expect(breakdown.customerTotalCents).toBeNull();
    expect(breakdown.vatAmountCents).toBeNull();
    expect(breakdown.pfuAmountCents).toBeNull();
    // The net selling price is knowable and is published; only the final
    // payable amount is withheld.
    expect(breakdown.tyreSaleNetCents).toBe(12_000);
  });

  it("does not derive a PFU amount from a known tyre weight", () => {
    const pfu = resolvePfu({ weightKg: 11.2, productClass: "truck" });
    expect(pfu.status).toBe("TO_CONFIRM");
    expect(pfu.amountCents).toBeNull();
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

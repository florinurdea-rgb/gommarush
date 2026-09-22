import { describe, expect, it } from "vitest";
import {
  assessSellability,
  DEFAULT_SELLING_POLICY,
  minimumOfferQuantityFor,
  type SellingPolicy,
} from "@/lib/commerce/selling-policy";

/**
 * The GommaRush minimum-offer rule.
 *
 * Every test here is really the same assertion from a different angle: the
 * policy decides what we OFFER and never touches what the supplier HOLDS.
 */

const stock = (stockExact: number | null, stockMinimum: number | null = stockExact) => ({
  stock: { stockExact, stockMinimum },
});

describe("the configured floor", () => {
  it("is 5, as the owner set it", () => {
    expect(DEFAULT_SELLING_POLICY.minimumOfferQuantity).toBe(5);
  });

  /** The worked examples from the owner's instruction, verbatim. */
  it.each([
    [3, false],
    [4, false],
    [5, true],
    [15, true],
  ])("stock of %i is sellable=%s", (quantity, expected) => {
    expect(assessSellability(stock(quantity)).sellable).toBe(expected);
  });

  it("explains a suppression precisely enough to act on", () => {
    const decision = assessSellability(stock(3));
    expect(decision).toEqual({
      sellable: false,
      reason: "below_minimum_offer_quantity",
      assessedQuantity: 3,
      minimumApplied: 5,
    });
  });
});

describe("supplier stock is never rewritten", () => {
  /**
   * The failure this guards: writing a suppressed listing's stock down to 0
   * so the UI hides it. That destroys a true fact sourcing needs, and 3 is
   * not the same statement as 0.
   */
  it("reports the real quantity alongside the refusal", () => {
    for (const quantity of [1, 2, 3, 4]) {
      const decision = assessSellability(stock(quantity));
      expect(decision.sellable).toBe(false);
      expect(decision.assessedQuantity).toBe(quantity);
      expect(decision.assessedQuantity).not.toBe(0);
    }
  });

  it("keeps 'out of stock' and 'below our minimum' as different answers", () => {
    expect(assessSellability(stock(0)).reason).toBe("supplier_out_of_stock");
    expect(assessSellability(stock(3)).reason).toBe("below_minimum_offer_quantity");
  });

  it("keeps 'unknown' apart from 'none'", () => {
    const unknown = assessSellability(stock(null, null));
    expect(unknown.sellable).toBe(false);
    expect(unknown.reason).toBe("stock_unknown");
    expect(unknown.assessedQuantity).toBeNull();
    expect(unknown.reason).not.toBe("supplier_out_of_stock");
  });
});

describe("banded availability", () => {
  /**
   * '>  20' clears a floor of 5 on its FLOOR. No number is invented to make
   * the comparison, which matters because this is 7,991 of 9,559 rows.
   */
  it("is sellable on the band's floor, with no exact quantity resolved", () => {
    const decision = assessSellability({ stock: { stockExact: null, stockMinimum: 20 } });
    expect(decision.sellable).toBe(true);
    expect(decision.assessedQuantity).toBe(20);
    expect(decision.assessedQuantity).not.toBe(21);
  });

  it("suppresses a band whose floor is below the minimum", () => {
    const decision = assessSellability({ stock: { stockExact: null, stockMinimum: 2 } });
    expect(decision.sellable).toBe(false);
    expect(decision.reason).toBe("below_minimum_offer_quantity");
  });

  it("prefers an exact count over a band when both are present", () => {
    // An exact 3 with a floor of 3 is still 3, and still not offered.
    expect(assessSellability({ stock: { stockExact: 3, stockMinimum: 3 } }).sellable).toBe(false);
  });
});

describe("the floor can vary without touching the importer", () => {
  const policy: SellingPolicy = {
    minimumOfferQuantity: 5,
    bySupplier: { intersprint: 8 },
    byChannel: { whatsapp: 2 },
  };

  it("applies a per-supplier override", () => {
    expect(minimumOfferQuantityFor({ laneCode: "intersprint" }, policy)).toBe(8);
    expect(assessSellability(
      { ...stock(6), laneCode: "intersprint" },
      policy
    ).sellable).toBe(false);
  });

  it("lets a channel override beat a supplier override", () => {
    expect(
      minimumOfferQuantityFor({ laneCode: "intersprint", channel: "whatsapp" }, policy)
    ).toBe(2);
  });

  it("falls back to the default for an unlisted lane", () => {
    expect(minimumOfferQuantityFor({ laneCode: "deldo" }, policy)).toBe(5);
  });

  /** The rule is GommaRush's, not a supplier stock semantic. */
  it("applies the same rule whatever the lane, unless overridden", () => {
    expect(assessSellability({ ...stock(4), laneCode: "deldo" }).sellable).toBe(false);
    expect(assessSellability({ ...stock(4), laneCode: "intersprint" }).sellable).toBe(false);
  });
});

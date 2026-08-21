import { describe, expect, it } from "vitest";
import {
  calculatePhysicalItemCount,
  calculateTransportRevenue,
  calculateTyreCount,
  validateTyreCount,
} from "@/lib/logistics/ddt-calculations";
import { processLines } from "@/lib/logistics/ddt-lines";

/** Spec §39 acceptance tests, translated directly. */

describe("Test A — tyres + PFU + logistics on the same document", () => {
  it("counts only the tyre lines, never PFU or logistics quantities", () => {
    const { countableLines } = processLines([
      { rawDescription: "Fulda tyre", itemTypeHint: "tyre", quantity: 4 },
      { rawDescription: "PFU", quantity: 4 },
      { rawDescription: "Spese Logistiche", quantity: 4 },
    ]);

    expect(calculateTyreCount(countableLines)).toBe(4);
  });
});

describe("Test B — multiple tyre lines, repeated PFU/logistics quantities", () => {
  it("sums only TYRE lines: 2 + 1 + 2 = 5, not 5 + 5(PFU) + 5(logistics)", () => {
    const { countableLines } = processLines([
      { rawDescription: "Triangle tyre", itemTypeHint: "tyre", quantity: 2 },
      { rawDescription: "Bridgestone tyre", itemTypeHint: "tyre", quantity: 1 },
      { rawDescription: "Triangle tyre", itemTypeHint: "tyre", quantity: 2 },
      { rawDescription: "PFU", quantity: 2 },
      { rawDescription: "PFU", quantity: 1 },
      { rawDescription: "PFU", quantity: 2 },
      { rawDescription: "Logistics", quantity: 5 },
    ]);

    expect(calculateTyreCount(countableLines)).toBe(5);
  });
});

describe("Test C — a tyre plus a tube", () => {
  it("counts 2 physical items but only 1 tyre", () => {
    const { countableLines } = processLines([
      { rawDescription: "225/55 R18 tyre", itemTypeHint: "tyre", quantity: 1 },
      { rawDescription: "Camera d'aria", itemTypeHint: "tube", quantity: 1 },
    ]);

    expect(calculatePhysicalItemCount(countableLines)).toBe(2);
    expect(calculateTyreCount(countableLines)).toBe(1);
  });
});

describe("Test E — unreadable quantity is never guessed as 1", () => {
  it("excludes the line from every count and flags it for review instead", () => {
    const { countableLines, unreadableQuantityLines } = processLines([
      { rawDescription: "225/?? R18 tyre", itemTypeHint: "tyre", quantity: null },
    ]);

    expect(calculateTyreCount(countableLines)).toBe(0);
    expect(unreadableQuantityLines).toHaveLength(1);
    expect(unreadableQuantityLines[0].lineType).toBe("TYRE");
  });

  it("a fee/PFU line with an unreadable quantity does NOT force review — only physical lines do", () => {
    const { unreadableQuantityLines } = processLines([
      { rawDescription: "PFU", quantity: null },
    ]);

    expect(unreadableQuantityLines).toHaveLength(0);
  });
});

describe("calculateTransportRevenue", () => {
  it("multiplies tyre count by the rate", () => {
    expect(calculateTransportRevenue(5, 2)).toBe(10);
  });

  it("rounds to the cent", () => {
    expect(calculateTransportRevenue(3, 2.005)).toBe(6.02);
  });
});

describe("validateTyreCount (spec §22)", () => {
  it("is OK when there is nothing to cross-check against", () => {
    expect(validateTyreCount({ tyreCount: 5, physicalItemCount: 5, colli: null })).toBe("OK");
  });

  it("is OK when colli matches tyre_count", () => {
    expect(validateTyreCount({ tyreCount: 5, physicalItemCount: 5, colli: 5 })).toBe("OK");
  });

  it("is OK when colli matches physical_item_count (e.g. 1 tyre + 1 tube = 2 colli)", () => {
    expect(validateTyreCount({ tyreCount: 1, physicalItemCount: 2, colli: 2 })).toBe("OK");
  });

  it("requires review when the difference can't be explained", () => {
    expect(validateTyreCount({ tyreCount: 1, physicalItemCount: 1, colli: 4 })).toBe(
      "TYRE_COUNT_REVIEW_REQUIRED"
    );
  });
});

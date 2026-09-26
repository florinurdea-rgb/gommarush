import { describe, expect, it } from "vitest";
import {
  lineIsPhysical,
  planInventoryUnits,
  totalUnitCount,
  unitCountForLine,
} from "@/lib/logistics/inventory-units";

/**
 * Quantity -> physical inventory unit generation.
 *
 * The rule from the brief: an order item with quantity 4 produces 4 units;
 * fees and services produce none.
 */

describe("lineIsPhysical", () => {
  it("treats tyres, tubes, wheels, accessories and other as physical", () => {
    for (const type of ["tyre", "tube", "wheel", "accessory", "other"]) {
      expect(lineIsPhysical({ item_type: type, quantity: 1 })).toBe(true);
    }
  });

  it("treats services and fees as non-physical", () => {
    expect(lineIsPhysical({ item_type: "fee", quantity: 1 })).toBe(false);
    expect(lineIsPhysical({ item_type: "service", quantity: 1 })).toBe(false);
  });

  it("lets an explicit is_physical override the type", () => {
    // The hook for a future "fee that ships as an object".
    expect(lineIsPhysical({ item_type: "fee", quantity: 1, is_physical: true })).toBe(true);
    expect(lineIsPhysical({ item_type: "tyre", quantity: 1, is_physical: false })).toBe(false);
  });

  it("falls back to physical for an unknown type", () => {
    expect(lineIsPhysical({ item_type: "sprocket", quantity: 1 })).toBe(true);
  });
});

describe("unitCountForLine", () => {
  it("produces one unit per quantity", () => {
    expect(unitCountForLine({ item_type: "tyre", quantity: 4 })).toBe(4);
  });

  it("produces none for a fee", () => {
    expect(unitCountForLine({ item_type: "fee", quantity: 3 })).toBe(0);
  });

  it("refuses nonsense quantities instead of producing garbage units", () => {
    expect(unitCountForLine({ item_type: "tyre", quantity: 0 })).toBe(0);
    expect(unitCountForLine({ item_type: "tyre", quantity: -2 })).toBe(0);
    expect(unitCountForLine({ item_type: "tyre", quantity: Number.NaN })).toBe(0);
    expect(unitCountForLine({ item_type: "tyre", quantity: 2.7 })).toBe(2);
  });
});

describe("planInventoryUnits", () => {
  it("expands the brief's example: 4 tyres + 2 tubes = 6 units", () => {
    const items = [
      { item_type: "tyre", quantity: 4, description: "Michelin 225/55 R18" },
      { item_type: "tube", quantity: 2, description: "Camera aer" },
    ];

    const planned = planInventoryUnits(items);
    expect(planned).toHaveLength(6);
    expect(totalUnitCount(items)).toBe(6);
  });

  it("numbers units 1-based within each item", () => {
    const planned = planInventoryUnits([
      { item_type: "tyre", quantity: 3 },
      { item_type: "tube", quantity: 2 },
    ]);

    expect(planned.filter((u) => u.itemIndex === 0).map((u) => u.unitIndex)).toEqual([1, 2, 3]);
    expect(planned.filter((u) => u.itemIndex === 1).map((u) => u.unitIndex)).toEqual([1, 2]);
  });

  it("excludes fee and service lines from the physical count", () => {
    const items = [
      { item_type: "tyre", quantity: 4 },
      { item_type: "fee", quantity: 1, description: "PFU" },
      { item_type: "service", quantity: 1, description: "Montaggio" },
    ];
    expect(totalUnitCount(items)).toBe(4);
    expect(planInventoryUnits(items).every((unit) => unit.itemType === "tyre")).toBe(true);
  });

  it("falls back to raw_description when no normalised description exists", () => {
    const [unit] = planInventoryUnits([
      { item_type: "tyre", quantity: 1, raw_description: "MICHELIN 225/55 R18" },
    ]);
    expect(unit.description).toBe("MICHELIN 225/55 R18");
  });
});

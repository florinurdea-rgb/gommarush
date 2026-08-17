import { describe, expect, it } from "vitest";
import {
  CONFIDENT_MATCH_THRESHOLD,
  matchSupplierLabel,
  searchExpectedLines,
} from "@/lib/logistics/supplier-label-match";
import type { ExpectedLine } from "@/lib/logistics/supplier-label-match";

/**
 * Supplier-label matching. The critical property: uncertainty is reported as
 * uncertainty. The system never invents an order.
 */

function line(overrides: Partial<ExpectedLine> = {}): ExpectedLine {
  return {
    orderItemId: "item-1",
    orderId: "order-1",
    orderNumber: "GR-001",
    standCode: "A",
    customerName: "Rossi Gomme SRL",
    supplierId: "sup-1",
    supplierName: "Pneus",
    plannedDeliveryDate: "2026-08-17",
    itemType: "tyre",
    unitsExpected: 4,
    item: {
      brand: "Michelin",
      supplier_sku: "MI2255518PR4",
      width: 225,
      aspect_ratio: 55,
      rim_diameter: 18,
      load_index: "98",
      speed_rating: "V",
      raw_description: "MICHELIN PRIMACY 4 225/55 R18 98V",
      description: "Primacy 4",
    },
    ...overrides,
  };
}

describe("matchSupplierLabel", () => {
  it("matches confidently on brand + size", () => {
    const result = matchSupplierLabel({ brand: "Michelin", size: "225/55 R18" }, [line()]);
    expect(result.kind).toBe("confident");
    if (result.kind === "confident") {
      expect(result.candidate.score).toBeGreaterThanOrEqual(CONFIDENT_MATCH_THRESHOLD);
      expect(result.candidate.line.orderNumber).toBe("GR-001");
    }
  });

  it("matches on the supplier SKU alone", () => {
    const result = matchSupplierLabel({ supplierSku: "MI2255518PR4" }, [line()]);
    expect(result.kind).toBe("confident");
  });

  it("returns uncertain rather than guessing between two identical lines", () => {
    // Two customers ordered the same tyre: the label alone cannot tell them
    // apart, so a human must choose.
    const result = matchSupplierLabel({ brand: "Michelin", size: "225/55 R18" }, [
      line(),
      line({ orderItemId: "item-2", orderId: "order-2", orderNumber: "GR-002", standCode: "B" }),
    ]);

    expect(result.kind).toBe("uncertain");
    expect(result.candidates.length).toBe(2);
  });

  it("returns uncertain on a weak signal", () => {
    const result = matchSupplierLabel({ brand: "Michelin" }, [line()]);
    expect(result.kind).toBe("uncertain");
  });

  it("returns no_candidates when nothing resembles the label", () => {
    const result = matchSupplierLabel({ brand: "Pirelli", size: "195/65 R15" }, [line()]);
    expect(result.kind).toBe("no_candidates");
  });

  it("ignores lines with nothing left to receive", () => {
    const result = matchSupplierLabel({ brand: "Michelin", size: "225/55 R18" }, [
      line({ unitsExpected: 0 }),
    ]);
    expect(result.kind).toBe("no_candidates");
  });

  it("prefers the named supplier's lines when there are any", () => {
    const result = matchSupplierLabel(
      { brand: "Michelin", size: "225/55 R18" },
      [
        line({ orderItemId: "other", supplierId: "sup-2", orderNumber: "GR-009" }),
        line({ supplierId: "sup-1" }),
      ],
      { supplierId: "sup-1" }
    );

    expect(result.kind).toBe("confident");
    if (result.kind === "confident") {
      expect(result.candidate.line.supplierId).toBe("sup-1");
    }
  });
});

describe("searchExpectedLines", () => {
  const lines = [
    line(),
    line({
      orderItemId: "item-2",
      orderNumber: "GR-002",
      customerName: "Bianchi Pneumatici",
      item: {
        ...line().item,
        brand: "Pirelli",
        description: "P Zero",
        width: 245,
        supplier_sku: "PI2454019PZ4",
        raw_description: "PIRELLI P ZERO 245/40 R19 98Y",
      },
    }),
  ];

  it("finds by order number", () => {
    expect(searchExpectedLines("GR-002", lines).map((l) => l.orderItemId)).toEqual(["item-2"]);
  });

  it("finds by customer name", () => {
    expect(searchExpectedLines("bianchi", lines).map((l) => l.orderItemId)).toEqual(["item-2"]);
  });

  it("finds by brand and by SKU", () => {
    expect(searchExpectedLines("michelin", lines)).toHaveLength(1);
    expect(searchExpectedLines("MI2255518PR4", lines)).toHaveLength(1);
  });

  it("narrows rather than widens with multiple tokens", () => {
    expect(searchExpectedLines("michelin 225", lines)).toHaveLength(1);
    expect(searchExpectedLines("michelin pirelli", lines)).toHaveLength(0);
  });

  it("returns nothing for an empty query", () => {
    expect(searchExpectedLines("   ", lines)).toEqual([]);
  });
});

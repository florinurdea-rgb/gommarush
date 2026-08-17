import { describe, expect, it } from "vitest";
import {
  assertLabelDataIsSafe,
  buildLabelData,
  standQrUrl,
  unitQrUrl,
  UnsafeLabelDataError,
} from "@/lib/logistics/label";
import { formatOrderNumber, parseOrderNumber } from "@/lib/logistics/order-number";
import type { OrderItemRow } from "@/lib/types/logistics";

const item = {
  item_type: "tyre",
  brand: "Michelin",
  description: "Primacy 4",
  raw_description: "MICHELIN PRIMACY 4 225/55 R18 98V",
  width: 225,
  aspect_ratio: 55,
  rim_diameter: 18,
  load_index: "98",
  speed_rating: "V",
  quantity: 4,
} as Pick<
  OrderItemRow,
  | "item_type" | "brand" | "description" | "raw_description" | "width"
  | "aspect_ratio" | "rim_diameter" | "load_index" | "speed_rating" | "quantity"
>;

describe("buildLabelData", () => {
  it("carries everything the printer needs to render the label", () => {
    const label = buildLabelData({
      inventoryUnitId: "unit-1",
      unitToken: "GRUABC123",
      unitIndex: 2,
      orderNumber: "1",
      standCode: "A",
      customerName: "Rossi Gomme SRL",
      item,
    });

    expect(label.stand_code).toBe("A");
    expect(label.unit_token).toBe("GRUABC123");
    expect(label.customer).toBe("Rossi Gomme SRL");
    expect(label.size).toBe("225/55 R18");
    expect(label.load_speed).toBe("98V");
    expect(label.product).toContain("Michelin");
    expect(label.unit_index).toBe(2);
    expect(label.unit_total).toBe(4);
  });

  it("keeps an unassigned stand explicit rather than blank-guessing", () => {
    const label = buildLabelData({
      inventoryUnitId: "unit-1",
      unitToken: "GRUABC123",
      orderNumber: "1",
      standCode: null,
      customerName: null,
      item,
    });
    expect(label.stand_code).toBeNull();
    expect(label.customer).toBe("");
  });
});

describe("assertLabelDataIsSafe", () => {
  it("accepts a normal label payload", () => {
    expect(() =>
      assertLabelDataIsSafe({
        unit_token: "GRUABC",
        order_number: 1,
        stand_code: "A",
        customer: "Rossi",
        product: "Michelin",
      })
    ).not.toThrow();
  });

  it("rejects payment details — label_data reaches a workshop PC and its logs", () => {
    expect(() =>
      assertLabelDataIsSafe({ unit_token: "x", amount_to_collect: 486.4 })
    ).toThrow(UnsafeLabelDataError);
  });

  it("rejects credentials and addresses", () => {
    expect(() => assertLabelDataIsSafe({ service_role_key: "eyJ..." })).toThrow();
    expect(() => assertLabelDataIsSafe({ delivery_address_line1: "Via Torino 42" })).toThrow();
    expect(() => assertLabelDataIsSafe({ phone: "+39 044" })).toThrow();
  });
});

describe("QR targets", () => {
  it("builds the PERMANENT stand URL", () => {
    // The physical sticker encodes this and never changes.
    expect(standQrUrl("https://gorush.example/", "A")).toBe("https://gorush.example/stand/A");
  });

  it("builds the unit fallback URL", () => {
    expect(unitQrUrl("https://gorush.example", "GRUABC")).toBe("https://gorush.example/u/GRUABC");
  });
});

describe("order number formatting", () => {
  it("renders the database's bigint as GR-001", () => {
    expect(formatOrderNumber(1)).toBe("GR-001");
    expect(formatOrderNumber(42)).toBe("GR-042");
    expect(formatOrderNumber(1234)).toBe("GR-1234");
  });

  it("degrades gracefully for a missing number", () => {
    expect(formatOrderNumber(null)).toBe("—");
  });

  it("parses what an operator might type", () => {
    expect(parseOrderNumber("GR-001")).toBe(1);
    expect(parseOrderNumber("gr 42")).toBe(42);
    expect(parseOrderNumber("7")).toBe(7);
    expect(parseOrderNumber("nonsense")).toBeNull();
  });
});

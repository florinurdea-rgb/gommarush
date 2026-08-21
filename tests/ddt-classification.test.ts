import { describe, expect, it } from "vitest";
import { classifyLine, isPhysicalLine } from "@/lib/logistics/ddt-classification";

describe("classifyLine — PFU is never a product (spec §9)", () => {
  it.each([
    "PFU",
    "Contr. Amb.",
    "Contributo Ambientale",
    "EcoContributo",
    "eco-contributo",
    "contributo pneumatici",
    "EPP04",
    "CAP12",
    "ETP07",
    "GTP99",
  ])("classifies %j as PFU, even if it looked like a tyre line to an upstream extractor", (text) => {
    expect(classifyLine({ rawDescription: text, itemTypeHint: "tyre" })).toBe("PFU");
  });

  it("is never counted as a physical line", () => {
    expect(isPhysicalLine("PFU")).toBe(false);
  });
});

describe("classifyLine — other non-product lines (spec §10)", () => {
  it.each([
    ["Addebito Spese Logistiche", "LOGISTICS_FEE"],
    ["Spese di movimentazione", "LOGISTICS_FEE"],
    ["Recupero spese trasporto", "LOGISTICS_FEE"],
    ["Spese di trasporto", "TRANSPORT_FEE"],
    ["Sconto", "DISCOUNT"],
    ["IVA 22%", "VAT"],
  ] as const)("classifies %j as %s, not a physical product", (text, expected) => {
    const result = classifyLine({ rawDescription: text });
    expect(result).toBe(expected);
    expect(isPhysicalLine(result)).toBe(false);
  });
});

describe("classifyLine — real tyre lines", () => {
  it("classifies a tyre description as TYRE via the item-type hint", () => {
    const result = classifyLine({
      rawDescription: "215/60R17 MULTICONTROL SUV 100V XL M+S",
      itemTypeHint: "tyre",
    });
    expect(result).toBe("TYRE");
    expect(isPhysicalLine(result)).toBe(true);
  });

  it("distinguishes a tube from a tyre", () => {
    expect(classifyLine({ rawDescription: "Camera d'aria 17\"", itemTypeHint: "tube" })).toBe("TUBE");
  });

  it("falls back to UNKNOWN rather than guessing a physical type with no hint and no fee pattern", () => {
    expect(classifyLine({ rawDescription: "Qualcosa di non identificato" })).toBe("UNKNOWN");
  });

  it("a fee pattern always wins over a physical hint (AI is not the source of truth for this)", () => {
    expect(classifyLine({ rawDescription: "PFU pneumatici", itemTypeHint: "tyre" })).toBe("PFU");
  });
});

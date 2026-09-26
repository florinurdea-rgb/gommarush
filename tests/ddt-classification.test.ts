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

/**
 * Regressions for the two classification defects found by auditing the
 * pipeline: a case-sensitive VAT pattern, and a transport pattern broad
 * enough to swallow products.
 */
describe("classification regressions", () => {
  it("classifies IVA regardless of case", () => {
    for (const text of ["IVA 22%", "Iva 22%", "iva 22%"]) {
      expect(classifyLine({ rawDescription: text })).toBe("VAT");
    }
    expect(classifyLine({ rawDescription: "vat 22%" })).toBe("VAT");
  });

  it("still catches genuine transport charges", () => {
    for (const text of [
      "Spese di trasporto",
      "Spese trasporto",
      "Costo trasporto",
      "Addebito trasporto",
      "TRASPORTO: 15,00",
      "Shipping cost",
      "Transport fee",
    ]) {
      expect(classifyLine({ rawDescription: text })).toBe("TRANSPORT_FEE");
    }
  });

  /**
   * The false positive that mattered: a bare /\btrasporto\b/ reclassified any
   * product whose description mentioned transport, so the tyre vanished from
   * the physical items and out of the tyre count.
   */
  it("does not turn a product that mentions transport into a fee", () => {
    for (const text of [
      "225/55 R18 gomma per trasporto leggero",
      "Pneumatico trasporto merci 195/70 R15C",
      "Camera d'aria per mezzi di trasporto",
    ]) {
      const result = classifyLine({ rawDescription: text, itemTypeHint: "tyre" });
      expect(result).not.toBe("TRANSPORT_FEE");
      expect(result).toBe("TYRE");
    }
  });

  it("keeps PFU winning over every broader fee pattern", () => {
    expect(classifyLine({ rawDescription: "PFU - contributo ambientale trasporto", itemTypeHint: "tyre" })).toBe("PFU");
  });
});

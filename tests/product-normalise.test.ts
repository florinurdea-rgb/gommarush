import { describe, expect, it } from "vitest";
import {
  detectItemType,
  formatTyreSize,
  mergeIdenticalProductLines,
  normaliseProduct,
  parseTyreSize,
} from "@/lib/logistics/product-normalise";

/**
 * Product normalisation. The rule: never guess. A field that cannot be read is
 * left null and named in reviewFields so a human sees it.
 */

describe("parseTyreSize", () => {
  it("reads the common notations", () => {
    expect(parseTyreSize("225/55 R18")).toEqual({ width: 225, aspectRatio: 55, rimDiameter: 18 });
    expect(parseTyreSize("225/55R18")).toEqual({ width: 225, aspectRatio: 55, rimDiameter: 18 });
    expect(parseTyreSize("225/55 ZR18")).toEqual({ width: 225, aspectRatio: 55, rimDiameter: 18 });
    expect(parseTyreSize("215/75 R17.5")).toEqual({
      width: 215,
      aspectRatio: 75,
      rimDiameter: 17.5,
    });
  });

  it("returns null rather than inventing a size", () => {
    expect(parseTyreSize("VALVOLE TPMS")).toBeNull();
    expect(parseTyreSize("999/99 R99")).toBeNull();
  });
});

describe("detectItemType", () => {
  it("classifies the physical kinds", () => {
    expect(detectItemType("MICHELIN 225/55 R18 98V")).toBe("tyre");
    expect(detectItemType("CAMERA D'ARIA 15 POLLICI")).toBe("tube");
    expect(detectItemType("CERCHIO IN LEGA 18")).toBe("wheel");
    expect(detectItemType("VALVOLE TPMS")).toBe("accessory");
  });

  it("classifies fees and services, not as products", () => {
    expect(detectItemType("CONTRIBUTO PFU")).toBe("fee");
    expect(detectItemType("SPESE DI TRASPORTO")).toBe("fee");
    expect(detectItemType("MONTAGGIO + EQUILIBRATURA")).toBe("service");
  });

  it("treats a transport charge that mentions a size as a fee, not a tyre", () => {
    // The dangerous case: it would otherwise generate phantom inventory units.
    expect(detectItemType("TRASPORTO PNEUMATICI 225/55 R18")).toBe("fee");
  });
});

describe("normaliseProduct", () => {
  it("preserves raw_description verbatim", () => {
    const raw = "  MICHELIN   PRIMACY 4   225/55 R18 98V  ";
    expect(normaliseProduct(raw).rawDescription).toBe(raw);
  });

  it("extracts the full structure from a well-formed line", () => {
    const result = normaliseProduct("MICHELIN PRIMACY 4 225/55 R18 98V XL");
    expect(result.itemType).toBe("tyre");
    expect(result.brand).toBe("Michelin");
    expect(result.width).toBe(225);
    expect(result.aspectRatio).toBe(55);
    expect(result.rimDiameter).toBe(18);
    expect(result.loadIndex).toBe("98");
    expect(result.speedRating).toBe("V");
    expect(result.extraLoad).toBe(true);
    expect(result.reviewFields).toEqual([]);
  });

  it("flags what it could NOT read instead of guessing", () => {
    const result = normaliseProduct("PNEUMATICO GENERICO SENZA MISURA");
    expect(result.reviewFields).toContain("item_type");
    expect(result.width).toBeNull();
    expect(result.brand).toBeNull();
  });

  it("flags a missing brand on an otherwise readable tyre", () => {
    const result = normaliseProduct("GOMMA 205/55 R16 91H");
    expect(result.itemType).toBe("tyre");
    expect(result.width).toBe(205);
    expect(result.brand).toBeNull();
    expect(result.reviewFields).toContain("brand");
  });

  it("detects run-flat markings", () => {
    expect(normaliseProduct("BRIDGESTONE 225/45 R17 RUN FLAT").runFlat).toBe(true);
    expect(normaliseProduct("PIRELLI 225/45 R17 ROF").runFlat).toBe(true);
  });
});

describe("formatTyreSize", () => {
  it("renders whole and fractional rim sizes correctly", () => {
    expect(formatTyreSize(225, 55, 18)).toBe("225/55 R18");
    expect(formatTyreSize(215, 75, 17.5)).toBe("215/75 R17.5");
    expect(formatTyreSize(225, 55, "18.0")).toBe("225/55 R18");
  });

  it("returns null when the size is incomplete", () => {
    expect(formatTyreSize(225, null, 18)).toBeNull();
  });
});

describe("mergeIdenticalProductLines", () => {
  const tyre = (overrides: Partial<Parameters<typeof mergeIdenticalProductLines>[0][number]> = {}) => ({
    itemType: "tyre",
    brand: "Michelin",
    model: "Primacy 4",
    width: 225,
    aspectRatio: 55,
    rimDiameter: 18,
    loadIndex: "94",
    speedRating: "V",
    extraLoad: null,
    runFlat: null,
    supplierSku: null,
    unitPrice: 80,
    taxRate: 22,
    quantity: 1,
    rawDescription: "225/55 R18 94V Michelin Primacy 4",
    ...overrides,
  });

  it("sums quantity for two identical lines instead of listing them separately", () => {
    const merged = mergeIdenticalProductLines([tyre(), tyre()]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(2);
  });

  it("keeps lines with a different brand, size or price apart", () => {
    expect(mergeIdenticalProductLines([tyre(), tyre({ brand: "Pirelli" })])).toHaveLength(2);
    expect(mergeIdenticalProductLines([tyre(), tyre({ width: 205 })])).toHaveLength(2);
    expect(mergeIdenticalProductLines([tyre(), tyre({ unitPrice: 75 })])).toHaveLength(2);
  });

  it("never merges a line with no readable quantity — don't guess", () => {
    const merged = mergeIdenticalProductLines([tyre(), tyre({ quantity: null })]);
    expect(merged).toHaveLength(2);
  });

  it("joins the source descriptions when they differ, instead of dropping one", () => {
    const merged = mergeIdenticalProductLines([
      tyre({ rawDescription: "225/55 R18 94V Michelin Primacy 4 lotto A" }),
      tyre({ rawDescription: "225/55 R18 94V Michelin Primacy 4 lotto B" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].rawDescription).toBe(
      "225/55 R18 94V Michelin Primacy 4 lotto A | 225/55 R18 94V Michelin Primacy 4 lotto B"
    );
  });
});

import { describe, it, expect } from "vitest";
import {
  gs1CheckDigit,
  isValidGtin,
  resolveEan,
  deriveProductKey,
  isTrustworthyEan,
  stripNonDigits,
} from "./ean";

describe("GS1 check digit", () => {
  it("validates real EANs taken from the production ISB import", () => {
    // Verified rows from catalogue_import_rows.raw_payload.
    expect(isValidGtin("4717622044652")).toBe(true);
    expect(isValidGtin("029142928287")).toBe(true);
  });

  it("computes the documented check digit", () => {
    expect(gs1CheckDigit("471762204465")).toBe(2);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidGtin("4717622044653")).toBe(false);
  });

  it("rejects non-GTIN lengths and non-numeric input", () => {
    expect(isValidGtin("12345")).toBe(false);
    expect(isValidGtin("471762204465X")).toBe(false);
    expect(isValidGtin("")).toBe(false);
  });

  it("strips separators from spreadsheet exports", () => {
    expect(stripNonDigits(" 4717-6220 44652 ")).toBe("4717622044652");
  });
});

describe("resolveEan", () => {
  it("accepts a valid EAN", () => {
    const r = resolveEan("4717622044652");
    expect(r).toEqual({ ean: "4717622044652", status: "valid", reasons: [] });
  });

  it("reports missing for null, empty and all-zero values", () => {
    for (const input of [null, undefined, "", "   ", "0", "0000000000000"]) {
      const r = resolveEan(input);
      expect(r.status).toBe("missing");
      expect(r.ean).toBeNull();
      expect(r.reasons).toContain("EAN_MISSING");
    }
  });

  it("recovers a leading zero stripped by a numeric spreadsheet cell", () => {
    // 029142928287 is a valid GTIN-12; Excel would render it as 29142928287.
    const r = resolveEan("29142928287");
    expect(r.status).toBe("recovered_leading_zero");
    expect(r.ean).toBe("029142928287");
    expect(r.reasons).toContain("EAN_LEADING_ZERO_RECOVERED");
  });

  it("NEVER invents an identity: padding that fails the check digit is invalid", () => {
    const r = resolveEan("12345678");
    expect(r.status).toBe("invalid_check_digit");
    expect(r.ean).toBeNull();
    expect(r.reasons).toContain("EAN_INVALID:CHECK_DIGIT_MISMATCH");
  });

  it("is deterministic across repeated calls", () => {
    const a = resolveEan("29142928287");
    const b = resolveEan("29142928287");
    expect(a).toEqual(b);
  });
});

describe("product identity key", () => {
  it("uses GTIN when the EAN is trustworthy - the cross-supplier bridge", () => {
    const r = deriveProductKey({
      ean: "4717622044652",
      eanStatus: "valid",
      lanePrefix: "ISB",
      supplierArticleId: "12851",
    });
    expect(r).toEqual({ productKey: "GTIN:4717622044652", provisional: false });
  });

  it("treats a recovered EAN as trustworthy, matching production", () => {
    const r = deriveProductKey({
      ean: "029142928287",
      eanStatus: "recovered_leading_zero",
      lanePrefix: "ISB",
      supplierArticleId: "999",
    });
    expect(r.productKey).toBe("GTIN:029142928287");
    expect(r.provisional).toBe(false);
  });

  it("falls back to a PROVISIONAL lane-scoped key when identity is unverified", () => {
    // Production: ean_status 'missing'         -> product_key 'ISB:447912'
    //             ean_status 'invalid_check_digit' -> product_key 'ISB:479548'
    for (const status of ["missing", "invalid_check_digit"] as const) {
      const r = deriveProductKey({
        ean: null,
        eanStatus: status,
        lanePrefix: "ISB",
        supplierArticleId: "447912",
      });
      expect(r).toEqual({ productKey: "ISB:447912", provisional: true });
    }
  });

  it("keeps two suppliers' unverified rows apart", () => {
    const isb = deriveProductKey({
      ean: null, eanStatus: "missing", lanePrefix: "ISB", supplierArticleId: "1",
    });
    const deldo = deriveProductKey({
      ean: null, eanStatus: "missing", lanePrefix: "DELDO", supplierArticleId: "1",
    });
    expect(isb.productKey).not.toBe(deldo.productKey);
  });

  it("classifies trustworthiness correctly", () => {
    expect(isTrustworthyEan("valid")).toBe(true);
    expect(isTrustworthyEan("recovered_leading_zero")).toBe(true);
    expect(isTrustworthyEan("invalid_check_digit")).toBe(false);
    expect(isTrustworthyEan("missing")).toBe(false);
  });
});

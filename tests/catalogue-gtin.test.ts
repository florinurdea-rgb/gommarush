import { describe, expect, it } from "vitest";
import {
  gtinCheckDigit,
  isScannable,
  isValidGtin,
  normalizeIdentifierValue,
  validateGtin,
} from "@/lib/catalogue/gtin";

/**
 * Barcode validation.
 *
 * Every value in here is a real one, taken from the ISB catalogue file:
 * the four leading-zero recoveries, the single genuinely invalid code, and
 * three ordinary EAN-13s. The point of the module is that it never invents a
 * digit, so most of these tests are about what it REFUSES to do.
 */

// 11 digits in the source; a leading zero was stripped by a spreadsheet.
const RECOVERABLE = ["29142337867", "29142337874", "29142337898", "29142829485"];
// The one row in 9,559 whose check digit genuinely does not agree.
const INVALID = "8019227448086";
const VALID_EAN13 = ["4717622044652", "4717622057126", "3528701101811"];

describe("gtinCheckDigit", () => {
  it("computes the GS1 check digit for a body", () => {
    // 4717622044652 -> body 471762204465, check 2
    expect(gtinCheckDigit("471762204465")).toBe(2);
  });
});

describe("isValidGtin", () => {
  it("accepts real EAN-13 codes", () => {
    for (const ean of VALID_EAN13) expect(isValidGtin(ean)).toBe(true);
  });

  it("rejects the one code in the catalogue whose check digit disagrees", () => {
    expect(isValidGtin(INVALID)).toBe(false);
  });

  it("rejects a length GS1 does not define", () => {
    expect(isValidGtin("12345678901")).toBe(false); // 11 digits
    expect(isValidGtin("123456789012345")).toBe(false); // 15 digits
  });

  it("rejects anything that is not all digits", () => {
    expect(isValidGtin("471762204465X")).toBe(false);
  });
});

describe("validateGtin", () => {
  it("marks a real EAN-13 valid and returns it unchanged", () => {
    const result = validateGtin(VALID_EAN13[0]);
    expect(result.status).toBe("valid");
    expect(result.normalized).toBe(VALID_EAN13[0]);
    expect(result.reason).toBeNull();
  });

  it("recovers a stripped leading zero only because the completed value validates", () => {
    for (const source of RECOVERABLE) {
      const result = validateGtin(source);
      expect(result.status).toBe("recovered_leading_zero");
      expect(result.normalized).toBe(`0${source}`);
      expect(result.normalized).toHaveLength(12);
      // The source is kept exactly as supplied, not replaced by the recovery.
      expect(result.raw).toBe(source);
    }
  });

  it("never pads a value whose completed form still fails", () => {
    // 11 digits, and no leading zero makes the check digit agree.
    const result = validateGtin("12345678901");
    expect(result.status).toBe("invalid_check_digit");
    expect(result.normalized).toBeNull();
    expect(result.reason).toBe("UNSUPPORTED_LENGTH");
  });

  it("does not try to rescue a supported length that fails its check digit", () => {
    const result = validateGtin(INVALID);
    expect(result.status).toBe("invalid_check_digit");
    expect(result.normalized).toBeNull();
    expect(result.reason).toBe("CHECK_DIGIT_MISMATCH");
  });

  it("preserves leading zeros that were already present", () => {
    // A genuine GTIN-12 that starts with a zero must survive untouched.
    const result = validateGtin("029142337867");
    expect(result.status).toBe("valid");
    expect(result.normalized).toBe("029142337867");
  });

  it("treats blank, null and undefined as missing rather than invalid", () => {
    for (const value of ["", "   ", null, undefined]) {
      const result = validateGtin(value);
      expect(result.status).toBe("missing");
      expect(result.normalized).toBeNull();
      expect(result.reason).toBeNull();
    }
  });

  it("strips only spacing characters a supplier legitimately uses", () => {
    expect(validateGtin(" 4717622044652 ").normalized).toBe("4717622044652");
    expect(validateGtin("4717-6220-44652").normalized).toBe("4717622044652");
    expect(validateGtin("4717 6220 44652").normalized).toBe("4717622044652");
  });

  it("rejects a value carrying characters that suggest it was mangled", () => {
    // A decimal point almost always means the barcode went through a numeric
    // coercion; silently dropping it would turn corruption into a plausible code.
    const result = validateGtin("4.7176220446e12");
    expect(result.status).toBe("invalid_check_digit");
    expect(result.reason).toBe("UNSUPPORTED_CHARACTERS");
  });

  it("rejects a value longer than any defined GTIN", () => {
    expect(validateGtin("123456789012345678").reason).toBe("TOO_LONG");
  });
});

describe("normalizeIdentifierValue", () => {
  it("produces the form the warehouse scanner matches on", () => {
    expect(normalizeIdentifierValue(" 4717-6220 44652 ")).toBe("4717622044652");
    expect(normalizeIdentifierValue("eb208")).toBe("EB208");
  });
});

describe("isScannable", () => {
  it("allows only statuses that actually passed validation", () => {
    expect(isScannable("valid")).toBe(true);
    expect(isScannable("recovered_leading_zero")).toBe(true);
    expect(isScannable("invalid_check_digit")).toBe(false);
    expect(isScannable("missing")).toBe(false);
  });
});

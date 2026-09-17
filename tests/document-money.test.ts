import { describe, expect, it } from "vitest";
import {
  RECONCILE_TOLERANCE_CENTS,
  applyPercent,
  formatCents,
  multiplyCents,
  parseAmount,
  reconcileDocument,
  sumCents,
} from "@/lib/documents/pipeline/money";

/**
 * Money parsing and reconciliation.
 *
 * The separator tests are the ones that matter commercially: "1.234,56" and
 * "1,234.56" are the same eight characters and different amounts, and an
 * Italian supplier document uses the first.
 */

describe("parseAmount — separator resolution", () => {
  it("reads Italian format (dot thousands, comma decimal)", () => {
    expect(parseAmount("1.234,56").cents).toBe(123456);
    expect(parseAmount("12.345,60").cents).toBe(1234560);
    expect(parseAmount("105,89").cents).toBe(10589);
  });

  it("reads Anglo format (comma thousands, dot decimal)", () => {
    expect(parseAmount("1,234.56").cents).toBe(123456);
    expect(parseAmount("105.89").cents).toBe(10589);
  });

  /** The genuinely ambiguous case, resolved by an explicit documented rule. */
  it("treats a lone separator with 3 trailing digits as thousands", () => {
    expect(parseAmount("1.234").cents).toBe(123400);
    expect(parseAmount("1,234").cents).toBe(123400);
  });

  it("treats a lone separator with 1-2 trailing digits as decimal", () => {
    expect(parseAmount("1.2").cents).toBe(120);
    expect(parseAmount("1,25").cents).toBe(125);
  });

  it("handles no separator at all", () => {
    expect(parseAmount("1234").cents).toBe(123400);
    expect(parseAmount("0").cents).toBe(0);
  });

  it("strips currency symbols and spacing", () => {
    expect(parseAmount(" € 1.234,56 ").cents).toBe(123456);
    expect(parseAmount("1 234,56").cents).toBe(123456);
  });

  it("keeps a negative sign (credit lines, discounts)", () => {
    expect(parseAmount("-105,89").cents).toBe(-10589);
  });

  /**
   * Worth pinning because it surprises English readers: "10.999" on an
   * Italian document is ten thousand nine hundred ninety-nine, not 10.999.
   * A lone separator with exactly three trailing digits is thousands.
   */
  it("reads a lone separator with 3 trailing digits the Italian way", () => {
    expect(parseAmount("10,999").cents).toBe(1099900);
    expect(parseAmount("10.999").cents).toBe(1099900);
  });

  it("refuses more than two decimals rather than rounding silently", () => {
    // Both separators present, so the comma is unambiguously the decimal
    // point and "567" is unambiguously three decimal places.
    const both = parseAmount("1.234,567");
    expect(both.cents).toBeNull();
    expect(both.reason).toBe("TOO_MANY_DECIMALS");

    // Four trailing digits cannot be a thousands group either.
    const four = parseAmount("10,9999");
    expect(four.cents).toBeNull();
    expect(four.reason).toBe("TOO_MANY_DECIMALS");
  });

  it("refuses non-numeric content", () => {
    expect(parseAmount("abc").reason).toBe("UNSUPPORTED_CHARACTERS");
    expect(parseAmount("10,50 EUR/pz").reason).toBe("UNSUPPORTED_CHARACTERS");
  });

  it("treats blank, null and undefined as empty, not as zero", () => {
    for (const value of ["", "   ", null, undefined]) {
      const result = parseAmount(value);
      expect(result.cents).toBeNull();
      expect(result.reason).toBe("EMPTY");
    }
  });

  it("preserves the raw string for audit", () => {
    expect(parseAmount(" 1.234,56 ").raw).toBe("1.234,56");
  });

  it("accepts a JSON number, rounding at the cent", () => {
    expect(parseAmount(105.89).cents).toBe(10589);
    expect(parseAmount(0.1 + 0.2).cents).toBe(30);
  });
});

describe("cent arithmetic avoids float error", () => {
  it("sums cents exactly where floats would drift", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754; in cents it is exact.
    expect(sumCents([10, 20])).toBe(30);
    const hundredTenCentLines = Array.from({ length: 100 }, () => 10);
    expect(sumCents(hundredTenCentLines)).toBe(1000);
  });

  it("multiplies quantity by unit price at the cent", () => {
    expect(multiplyCents(10589, 4)).toBe(42356);
    expect(multiplyCents(3333, 3)).toBe(9999);
  });

  it("rounds a credit the same magnitude as a debit", () => {
    expect(multiplyCents(-1005, 0.5)).toBe(-503);
    expect(multiplyCents(1005, 0.5)).toBe(503);
  });

  it("applies a percentage discount", () => {
    expect(applyPercent(10000, 10)).toBe(1000);
    expect(applyPercent(10589, 15)).toBe(1588);
  });

  it("formats cents for display without floats", () => {
    expect(formatCents(123456)).toBe("1234.56 EUR");
    expect(formatCents(5)).toBe("0.05 EUR");
    expect(formatCents(-10589)).toBe("-105.89 EUR");
  });
});

describe("reconcileDocument", () => {
  const line = (q: number | null, unit: number | null, total: number | null, discount: number | null = null) => ({
    quantity: q,
    unitPriceCents: unit,
    discountPercent: discount,
    lineTotalCents: total,
  });

  const totals = (over: Partial<Parameters<typeof reconcileDocument>[1]> = {}) => ({
    subtotalCents: null,
    discountTotalCents: null,
    taxableTotalCents: null,
    vatTotalCents: null,
    documentTotalCents: null,
    chargeCents: [],
    ...over,
  });

  it("passes a consistent document", () => {
    const result = reconcileDocument(
      [line(4, 10589, 42356), line(2, 5000, 10000)],
      totals({ subtotalCents: 52356 })
    );
    expect(result.status).toBe("OK");
    expect(result.issues).toHaveLength(0);
    expect(result.computedSubtotalCents).toBe(52356);
  });

  it("flags a line whose own arithmetic does not hold", () => {
    const result = reconcileDocument([line(4, 10589, 40000)], totals());
    expect(result.status).toBe("MISMATCH");
    expect(result.inconsistentLineIndexes).toEqual([0]);
    expect(result.issues[0].field).toBe("line[0].lineTotal");
    expect(result.issues[0].deltaCents).toBe(40000 - 42356);
  });

  it("applies a line discount before comparing", () => {
    // 4 x 100.00 = 400.00, less 10% = 360.00
    const result = reconcileDocument([line(4, 10000, 36000, 10)], totals());
    expect(result.status).toBe("OK");
  });

  it("flags a stated subtotal that disagrees with the lines", () => {
    const result = reconcileDocument([line(4, 10589, 42356)], totals({ subtotalCents: 50000 }));
    expect(result.status).toBe("MISMATCH");
    expect(result.issues.some((issue) => issue.field === "subtotal")).toBe(true);
  });

  it("checks documentTotal against taxable + VAT", () => {
    const ok = reconcileDocument([], totals({ taxableTotalCents: 100000, vatTotalCents: 22000, documentTotalCents: 122000 }));
    expect(ok.issues.some((issue) => issue.field === "documentTotal")).toBe(false);

    const bad = reconcileDocument([], totals({ taxableTotalCents: 100000, vatTotalCents: 22000, documentTotalCents: 130000 }));
    expect(bad.status).toBe("MISMATCH");
    expect(bad.issues.some((issue) => issue.field === "documentTotal")).toBe(true);
  });

  it("absorbs per-line supplier rounding inside the tolerance", () => {
    const result = reconcileDocument(
      [line(3, 3333, 9999)],
      totals({ subtotalCents: 9999 + RECONCILE_TOLERANCE_CENTS })
    );
    expect(result.status).toBe("OK");
  });

  it("rejects a difference just outside the tolerance", () => {
    const result = reconcileDocument(
      [line(3, 3333, 9999)],
      totals({ subtotalCents: 9999 + RECONCILE_TOLERANCE_CENTS + 1 })
    );
    expect(result.status).toBe("MISMATCH");
  });

  /**
   * "Verified" and "there was nothing to verify" must be different answers,
   * or an unreadable document looks as trustworthy as a checked one.
   */
  it("reports NOT_CHECKABLE when the document offers nothing to check", () => {
    const result = reconcileDocument([line(null, null, null)], totals());
    expect(result.status).toBe("NOT_CHECKABLE");
    expect(result.uncheckableLineIndexes).toEqual([0]);
  });

  it("counts an unverifiable line's stated total toward the subtotal", () => {
    // Dropping it would make the subtotal wrong in the safe-looking direction.
    const result = reconcileDocument([line(null, null, 12345)], totals({ subtotalCents: 12345 }));
    expect(result.computedSubtotalCents).toBe(12345);
    expect(result.status).toBe("OK");
  });

  it("totals charges separately from the line subtotal", () => {
    const result = reconcileDocument([line(4, 10000, 40000)], totals({ chargeCents: [1250, 500] }));
    expect(result.computedChargeCents).toBe(1750);
    expect(result.computedSubtotalCents).toBe(40000);
  });
});

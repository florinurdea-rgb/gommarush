import { describe, expect, it } from "vitest";
import {
  accountForLines,
  canAutoConfirm,
  isBalanced,
  type LineForAccounting,
} from "@/lib/documents/pipeline/line-accounting";
import type { ClassifiedLineType } from "@/lib/logistics/ddt-classification";

/**
 * Source-line accounting.
 *
 * These tests exist because a line used to be able to disappear entirely:
 * an UNKNOWN classification was neither physical nor a charge, so it landed
 * in no collection, reached no table, and left no counter behind. Every test
 * here is a variation on "the line is still counted".
 */

let nextIndex = 0;
function line(over: Partial<LineForAccounting> = {}): LineForAccounting {
  return {
    sourceDocumentIndex: 0,
    sourceLineIndex: nextIndex++,
    classification: "TYRE" as ClassifiedLineType,
    quantity: 4,
    hasMonetaryValue: true,
    hasText: true,
    exclusion: null,
    ...over,
  };
}

describe("the invariant", () => {
  it("balances a mixed document", () => {
    nextIndex = 0;
    const { result } = accountForLines([
      line({ classification: "TYRE", quantity: 4 }),
      line({ classification: "PFU", quantity: 4 }),
      line({ classification: "TRANSPORT_FEE", quantity: 1 }),
      line({ classification: "UNKNOWN", quantity: null, hasMonetaryValue: false, hasText: true }),
      line({ classification: "UNKNOWN", quantity: 2, exclusion: { by: "op", reason: "riga duplicata" } }),
    ]);

    expect(result.tally.sourceLineCount).toBe(5);
    expect(result.tally.orderItemCount).toBe(1);
    expect(result.tally.chargeCount).toBe(2);
    expect(result.tally.textNoteCount).toBe(1);
    expect(result.tally.excludedCount).toBe(1);
    expect(result.tally.unresolvedCount).toBe(0);
    expect(result.balanced).toBe(true);
    expect(isBalanced(result.tally)).toBe(true);
  });

  it("holds for an empty document", () => {
    const { result } = accountForLines([]);
    expect(result.balanced).toBe(true);
    expect(result.tally.sourceLineCount).toBe(0);
  });

  it("holds for every combination — no line is ever uncounted", () => {
    nextIndex = 0;
    const classifications: ClassifiedLineType[] = [
      "TYRE", "TUBE", "RIM", "OTHER_PHYSICAL_ITEM",
      "PFU", "LOGISTICS_FEE", "TRANSPORT_FEE", "DISCOUNT", "VAT", "OTHER_FEE",
      "UNKNOWN",
    ];
    const quantities = [4, null, 0, 2.5];

    for (const classification of classifications) {
      for (const quantity of quantities) {
        for (const hasMonetaryValue of [true, false]) {
          for (const hasText of [true, false]) {
            const { accounted, result } = accountForLines([
              line({ classification, quantity, hasMonetaryValue, hasText }),
            ]);
            expect(accounted).toHaveLength(1);
            expect(result.balanced).toBe(true);
          }
        }
      }
    }
  });
});

describe("UNKNOWN lines never vanish", () => {
  it("blocks an unclassified line that carries money", () => {
    nextIndex = 0;
    const { accounted, result } = accountForLines([
      line({ classification: "UNKNOWN", quantity: null, hasMonetaryValue: true }),
    ]);
    expect(accounted[0].outcome).toBe("UNRESOLVED");
    expect(result.tally.unresolvedCount).toBe(1);
    expect(result.blocking.some((issue) => issue.code === "UNCLASSIFIED_LINE_WITH_VALUE")).toBe(true);
    expect(canAutoConfirm(result.tally)).toBe(false);
  });

  it("blocks an unclassified line that carries a quantity", () => {
    nextIndex = 0;
    const { accounted } = accountForLines([
      line({ classification: "UNKNOWN", quantity: 4, hasMonetaryValue: false }),
    ]);
    expect(accounted[0].outcome).toBe("UNRESOLVED");
  });

  it("records a value-free text line as a note rather than dropping it", () => {
    nextIndex = 0;
    const { accounted, result } = accountForLines([
      line({ classification: "UNKNOWN", quantity: null, hasMonetaryValue: false, hasText: true }),
    ]);
    expect(accounted[0].outcome).toBe("TEXT_NOTE");
    expect(result.tally.textNoteCount).toBe(1);
    expect(result.blocking).toHaveLength(0);
    expect(result.warnings.some((issue) => issue.code === "UNCLASSIFIED_TEXT_LINE")).toBe(true);
  });

  it("treats a line with neither text nor value as unresolved, not as gone", () => {
    nextIndex = 0;
    const { accounted } = accountForLines([
      line({ classification: "UNKNOWN", quantity: null, hasMonetaryValue: false, hasText: false }),
    ]);
    expect(accounted[0].outcome).toBe("UNRESOLVED");
  });
});

describe("physical quantities are never guessed", () => {
  it("blocks a null quantity instead of defaulting to 1", () => {
    nextIndex = 0;
    const { accounted, result } = accountForLines([line({ classification: "TYRE", quantity: null })]);
    expect(accounted[0].outcome).toBe("UNRESOLVED");
    expect(result.blocking.some((issue) => issue.code === "PHYSICAL_LINE_QUANTITY_UNREADABLE")).toBe(true);
  });

  it("blocks a zero or negative quantity", () => {
    for (const quantity of [0, -1]) {
      nextIndex = 0;
      const { result } = accountForLines([line({ classification: "TYRE", quantity })]);
      expect(result.blocking.some((issue) => issue.code === "PHYSICAL_LINE_QUANTITY_INVALID")).toBe(true);
    }
  });

  it("blocks a fractional quantity for an individually tracked item", () => {
    nextIndex = 0;
    const { result } = accountForLines([line({ classification: "TYRE", quantity: 2.5 })]);
    expect(result.blocking.some((issue) => issue.code === "PHYSICAL_LINE_QUANTITY_INVALID")).toBe(true);
  });

  it("accepts a positive integer", () => {
    nextIndex = 0;
    const { accounted, result } = accountForLines([line({ classification: "TYRE", quantity: 4 })]);
    expect(accounted[0].outcome).toBe("ORDER_ITEM");
    expect(result.blocking).toHaveLength(0);
  });
});

describe("operator exclusion", () => {
  it("wins over every other rule, because a human already decided", () => {
    nextIndex = 0;
    const { accounted, result } = accountForLines([
      line({ classification: "TYRE", quantity: null, exclusion: { by: "op", reason: "riga annullata a penna" } }),
    ]);
    expect(accounted[0].outcome).toBe("EXPLICITLY_EXCLUDED");
    expect(result.blocking).toHaveLength(0);
    expect(canAutoConfirm(result.tally)).toBe(true);
  });

  it("keeps the exclusion reason and actor on the record", () => {
    nextIndex = 0;
    const { accounted } = accountForLines([
      line({ exclusion: { by: "operator:florin", reason: "duplicato" } }),
    ]);
    expect(accounted[0].exclusion).toEqual({ by: "operator:florin", reason: "duplicato" });
  });
});

describe("canAutoConfirm", () => {
  it("requires zero unresolved lines", () => {
    expect(canAutoConfirm({ sourceLineCount: 1, orderItemCount: 1, chargeCount: 0, textNoteCount: 0, excludedCount: 0, unresolvedCount: 0 })).toBe(true);
    expect(canAutoConfirm({ sourceLineCount: 2, orderItemCount: 1, chargeCount: 0, textNoteCount: 0, excludedCount: 0, unresolvedCount: 1 })).toBe(false);
  });

  it("refuses an unbalanced tally even with nothing unresolved", () => {
    expect(canAutoConfirm({ sourceLineCount: 5, orderItemCount: 1, chargeCount: 0, textNoteCount: 0, excludedCount: 0, unresolvedCount: 0 })).toBe(false);
  });
});

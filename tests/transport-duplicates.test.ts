import { describe, expect, it } from "vitest";
import {
  assessDuplicates,
  hashSourceText,
  isConcurrentDuplicateError,
  normalizeDocumentNumberForMatch,
  normalizeSourceText,
  type DuplicateCandidate,
  type IncomingDocument,
} from "@/lib/transport/duplicates";

const ZUIN = "11111111-1111-1111-1111-111111111111";
const OTHER_DISTRIBUTOR = "99999999-9999-9999-9999-999999999999";

function incoming(overrides: Partial<IncomingDocument> = {}): IncomingDocument {
  return {
    distributorId: ZUIN,
    documentNumber: "1A - 050472/VR",
    supplierOrderReference: "0B/17115",
    sourceSha256: "hash-aaa",
    distributorCustomerCode: "034932",
    documentDate: "2026-08-06",
    ...overrides,
  };
}

function candidate(overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    orderId: "order-1",
    orderNumber: 1042,
    ingestionId: "ing-1",
    distributorId: ZUIN,
    distributorName: "ZUIN S.p.A.",
    documentNumber: "1A - 050472/VR",
    normalizedDocumentNumber: "1A-050472/VR",
    supplierOrderReference: "0B/17115",
    sourceSha256: "hash-aaa",
    distributorCustomerCode: "034932",
    documentDate: "2026-08-06",
    createdAt: "2026-08-06T10:00:00Z",
    ...overrides,
  };
}

describe("normalizeSourceText and hashing", () => {
  it("hashes the same document identically despite whitespace and case differences", () => {
    const a = "DDT VENDITA 1A - 050472/VR\n  ZUIN S.p.A.  \n";
    const b = "ddt vendita 1A - 050472/VR ZUIN S.p.A.";
    expect(hashSourceText(a)).toBe(hashSourceText(b));
  });

  it("does not collapse punctuation, so different documents stay different", () => {
    expect(normalizeSourceText("1A - 050472/VR")).toBe("1a - 050472/vr");
    expect(hashSourceText("DDT 050472")).not.toBe(hashSourceText("DDT 050473"));
  });

  it("aligns document-number normalisation with what the database stores", () => {
    // Must match normaliseDocumentNumber, because the live unique index on
    // (supplier_id, normalized_document_number) is built from it.
    expect(normalizeDocumentNumberForMatch("1A - 050472/VR")).toBe("1A-050472/VR");
    expect(normalizeDocumentNumberForMatch("  1a - 050472/vr ")).toBe("1A-050472/VR");
    expect(normalizeDocumentNumberForMatch(null)).toBeNull();
    expect(normalizeDocumentNumberForMatch("  ")).toBeNull();
  });
});

describe("assessDuplicates - exact duplicates are blocked", () => {
  it("blocks when the same distributor and DDT number already produced an order", () => {
    const result = assessDuplicates({ incoming: incoming(), candidates: [candidate()] });

    expect(result.verdict).toBe("EXACT");
    expect(result.blocksConfirmation).toBe(true);
    expect(result.matches[0].signals.map((s) => s.kind)).toContain("DISTRIBUTOR_DOCUMENT_NUMBER");
    expect(result.matches[0].reason).toContain("gia' stato importato");
  });

  it("does not offer continue-as-new on an exact duplicate", () => {
    // The unique index would reject the insert, so offering it would offer a
    // guaranteed failure.
    const result = assessDuplicates({ incoming: incoming(), candidates: [candidate()] });

    expect(result.matches[0].choices).toEqual(["OPEN_EXISTING", "CANCEL"]);
    expect(result.matches[0].choices).not.toContain("CONTINUE_AS_NEW");
  });

  it("matches the document number across formatting differences", () => {
    const result = assessDuplicates({
      incoming: incoming({ documentNumber: "1a-050472/vr" }),
      candidates: [candidate()],
    });

    expect(result.verdict).toBe("EXACT");
  });
});

describe("assessDuplicates - probable duplicates are shown, not blocked", () => {
  it("allows continuing when the same DDT number never produced an order", () => {
    // A previous extraction failed or was rejected. The document is real and
    // still needs importing.
    const result = assessDuplicates({
      incoming: incoming(),
      candidates: [candidate({ orderId: null, orderNumber: null })],
    });

    expect(result.verdict).toBe("PROBABLE");
    expect(result.blocksConfirmation).toBe(false);
    expect(result.matches[0].choices).toContain("CONTINUE_AS_NEW");
  });

  it("treats an identical text hash alone as probable, not exact", () => {
    // Re-pasting after a failure is legitimate and must not be blocked.
    const result = assessDuplicates({
      incoming: incoming({ documentNumber: null, supplierOrderReference: null, distributorCustomerCode: null }),
      candidates: [candidate({ normalizedDocumentNumber: null, documentNumber: null, supplierOrderReference: null, distributorCustomerCode: null })],
    });

    expect(result.verdict).toBe("PROBABLE");
    expect(result.matches[0].signals.map((s) => s.kind)).toEqual(["SOURCE_HASH"]);
    expect(result.matches[0].signals[0].conclusive).toBe(false);
    expect(result.blocksConfirmation).toBe(false);
  });

  it("treats a shared order reference as probable, since one order can span several DDTs", () => {
    const result = assessDuplicates({
      incoming: incoming({ documentNumber: "1A - 050999/VR", sourceSha256: "hash-different", distributorCustomerCode: null }),
      candidates: [candidate({ distributorCustomerCode: null })],
    });

    expect(result.verdict).toBe("PROBABLE");
    expect(result.matches[0].signals.map((s) => s.kind)).toEqual(["DISTRIBUTOR_ORDER_REFERENCE"]);
  });

  it("treats same customer code on the same day as probable", () => {
    const result = assessDuplicates({
      incoming: incoming({
        documentNumber: "1A - 050999/VR",
        sourceSha256: "hash-different",
        supplierOrderReference: "0B/99999",
      }),
      candidates: [candidate()],
    });

    expect(result.verdict).toBe("PROBABLE");
    expect(result.matches[0].signals.map((s) => s.kind)).toEqual(["DISTRIBUTOR_CUSTOMER_DATE"]);
    expect(result.matches[0].choices).toContain("CONTINUE_AS_NEW");
  });
});

describe("assessDuplicates - no false positives", () => {
  it("finds nothing for a genuinely new document", () => {
    const result = assessDuplicates({
      incoming: incoming({
        documentNumber: "1A - 099999/VR",
        sourceSha256: "hash-new",
        supplierOrderReference: "0B/00000",
        distributorCustomerCode: "111111",
        documentDate: "2026-09-01",
      }),
      candidates: [candidate()],
    });

    expect(result.verdict).toBe("NONE");
    expect(result.matches).toEqual([]);
    expect(result.blocksConfirmation).toBe(false);
  });

  it("does not match the same DDT number from a different distributor", () => {
    // Two distributors numbering their DDTs identically is entirely normal.
    const result = assessDuplicates({
      incoming: incoming({ sourceSha256: "hash-new", supplierOrderReference: null, distributorCustomerCode: null }),
      candidates: [candidate({ distributorId: OTHER_DISTRIBUTOR, distributorName: "CARLINI GOMME" })],
    });

    expect(result.verdict).toBe("NONE");
  });

  it("ignores null-on-null field pairs rather than treating them as matches", () => {
    const result = assessDuplicates({
      incoming: incoming({
        documentNumber: null,
        supplierOrderReference: null,
        sourceSha256: null,
        distributorCustomerCode: null,
        documentDate: null,
      }),
      candidates: [
        candidate({
          documentNumber: null,
          normalizedDocumentNumber: null,
          supplierOrderReference: null,
          sourceSha256: null,
          distributorCustomerCode: null,
          documentDate: null,
        }),
      ],
    });

    expect(result.verdict).toBe("NONE");
  });

  it("does not match an empty-string customer code", () => {
    const result = assessDuplicates({
      incoming: incoming({
        documentNumber: null,
        sourceSha256: null,
        supplierOrderReference: "   ",
        distributorCustomerCode: "   ",
      }),
      candidates: [candidate({ supplierOrderReference: "   ", distributorCustomerCode: "   " })],
    });

    expect(result.verdict).toBe("NONE");
  });
});

describe("assessDuplicates - multiple candidates", () => {
  it("puts the exact match first so the review screen leads with the blocker", () => {
    const result = assessDuplicates({
      incoming: incoming(),
      candidates: [
        candidate({ orderId: "order-2", orderNumber: 900, documentNumber: "1A - 050999/VR", normalizedDocumentNumber: "1A-050999/VR", sourceSha256: "hash-other" }),
        candidate(),
      ],
    });

    expect(result.verdict).toBe("EXACT");
    expect(result.matches[0].verdict).toBe("EXACT");
    expect(result.matches).toHaveLength(2);
  });
});

describe("isConcurrentDuplicateError", () => {
  it("recognises a unique violation on either live constraint", () => {
    expect(
      isConcurrentDuplicateError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "orders_supplier_doc_number_key"',
      })
    ).toBe(true);

    expect(
      isConcurrentDuplicateError({ code: "23505", constraint: "orders_supplier_document_unique" })
    ).toBe(true);
  });

  it("ignores unique violations on unrelated constraints", () => {
    expect(
      isConcurrentDuplicateError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "orders_qr_token_key"',
      })
    ).toBe(false);
  });

  it("ignores non-unique-violation errors", () => {
    expect(isConcurrentDuplicateError({ code: "23503", message: "foreign key violation" })).toBe(false);
    expect(isConcurrentDuplicateError(new Error("boom"))).toBe(false);
    expect(isConcurrentDuplicateError(null)).toBe(false);
  });
});

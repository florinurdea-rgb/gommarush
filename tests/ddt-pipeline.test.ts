import { describe, expect, it } from "vitest";
import { processExtractedDocument } from "@/lib/ddt-import/pipeline";
import type { ExtractedDocument, ExtractedLine } from "@/lib/ddt-import/types";

function line(overrides: Partial<ExtractedLine>): ExtractedLine {
  return {
    rawDescription: "225/55 R18 94V Michelin Primacy 4",
    itemTypeHint: "tyre",
    supplierArticleCode: null,
    manufacturerCode: null,
    ean: null,
    brand: "Michelin",
    model: "Primacy 4",
    width: 225,
    aspectRatio: 55,
    rimDiameter: 18,
    loadIndex: "94",
    speedRating: "V",
    extraLoad: null,
    runFlat: null,
    commercial: null,
    mudSnow: null,
    threePmsf: null,
    season: null,
    quantity: 4,
    unitWeight: null,
    unitPrice: null,
    lineTotal: null,
    vatPercent: null,
    ...overrides,
  };
}

function document(overrides: Partial<ExtractedDocument> = {}): ExtractedDocument {
  return {
    supplier: { name: "Carlini Gomme Srl", vatNumber: null },
    document: {
      documentNumber: "26-21-0562123",
      documentType: "DDT",
      documentDate: "2026-08-13",
      supplierOrderReference: null,
      trackingNumber: null,
      giro: null,
      agent: null,
      carrier: null,
      sourcePageStart: 1,
      sourcePageEnd: 1,
      colli: 4,
    },
    customer: {
      companyName: "Rasotto Group",
      vatNumber: null,
      fiscalCode: null,
      supplierCustomerCode: null,
      deliveryRecipient: null,
      addressLine1: "Via Torino 1",
      addressLine2: null,
      city: "Dueville",
      province: "VI",
      postalCode: "36031",
      country: "IT",
      phone: "0444123456",
    },
    paymentText: null,
    lines: [line({})],
    confidence: 0.95,
    warnings: [],
    ...overrides,
  };
}

describe("processExtractedDocument — READY path", () => {
  it("is READY when every critical and optional field is present", () => {
    const result = processExtractedDocument({
      extracted: document(),
      supplierId: "supplier-1",
      existingOrders: [],
      existingFingerprints: [],
    });

    expect(result.status).toBe("READY");
    expect(result.tyreCount).toBe(4);
    expect(result.physicalItems).toHaveLength(1);
    expect(result.charges).toHaveLength(0);
  });

  it("is READY_MISSING_OPTIONAL when only non-critical fields are missing", () => {
    const result = processExtractedDocument({
      extracted: document({
        customer: { ...document().customer, phone: null, postalCode: null },
      }),
      supplierId: "supplier-1",
      existingOrders: [],
      existingFingerprints: [],
    });

    expect(result.status).toBe("READY_MISSING_OPTIONAL");
  });
});

describe("processExtractedDocument — PFU never becomes a product (spec §9)", () => {
  it("keeps PFU/logistics lines out of physicalItems and out of tyreCount", () => {
    const doc = document({
      lines: [
        line({ quantity: 4 }),
        line({ rawDescription: "PFU", itemTypeHint: null, brand: null, quantity: 4 }),
        line({ rawDescription: "Spese Logistiche", itemTypeHint: null, brand: null, quantity: 4 }),
      ],
    });

    const result = processExtractedDocument({
      extracted: doc,
      supplierId: "supplier-1",
      existingOrders: [],
      existingFingerprints: [],
    });

    expect(result.tyreCount).toBe(4);
    expect(result.physicalItems).toHaveLength(1);
    expect(result.charges).toHaveLength(2);
    expect(result.charges.map((c) => c.lineType).sort()).toEqual(["LOGISTICS_FEE", "PFU"]);
  });
});

describe("processExtractedDocument — critical fields missing (spec §21)", () => {
  it("requires review when the supplier is unidentified", () => {
    const result = processExtractedDocument({
      extracted: document({ supplier: { name: null, vatNumber: null } }),
      supplierId: null,
      existingOrders: [],
      existingFingerprints: [],
    });
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.reasons.some((r) => r.includes("Furnizor"))).toBe(true);
  });

  it("requires review when there is no physical item at all", () => {
    const result = processExtractedDocument({
      extracted: document({ lines: [line({ rawDescription: "PFU", itemTypeHint: null, quantity: 4 })] }),
      supplierId: "supplier-1",
      existingOrders: [],
      existingFingerprints: [],
    });
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.physicalItems).toHaveLength(0);
  });

  it("requires review when a tyre line has an unreadable quantity — never guesses 1", () => {
    const result = processExtractedDocument({
      extracted: document({ lines: [line({ quantity: null })] }),
      supplierId: "supplier-1",
      existingOrders: [],
      existingFingerprints: [],
    });
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.tyreCount).toBe(0);
    expect(result.unreadableQuantityLines).toBe(1);
  });

  it("requires review when tyre count vs. colli can't be reconciled", () => {
    const result = processExtractedDocument({
      extracted: document({
        document: { ...document().document, colli: 99 },
      }),
      supplierId: "supplier-1",
      existingOrders: [],
      existingFingerprints: [],
    });
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.tyreCountValidation).toBe("TYRE_COUNT_REVIEW_REQUIRED");
  });
});

describe("processExtractedDocument — duplicate detection (spec §15-16)", () => {
  it("is DUPLICATE when supplier + normalized DDT number exactly matches an existing order", () => {
    const result = processExtractedDocument({
      extracted: document(),
      supplierId: "supplier-1",
      existingOrders: [
        { id: "order-existing", supplierId: "supplier-1", normalizedDocumentNumber: "26-21-0562123" },
      ],
      existingFingerprints: [],
    });

    expect(result.status).toBe("DUPLICATE");
    expect(result.duplicateOfOrderId).toBe("order-existing");
  });

  it("is NOT a duplicate when the same DDT number belongs to a different supplier", () => {
    const result = processExtractedDocument({
      extracted: document(),
      supplierId: "supplier-1",
      existingOrders: [
        { id: "order-existing", supplierId: "supplier-2", normalizedDocumentNumber: "26-21-0562123" },
      ],
      existingFingerprints: [],
    });

    expect(result.status).toBe("READY");
  });

  it("is POSSIBLE_DUPLICATE (never auto-imported) on a fingerprint match without an exact DDT match", () => {
    const extracted = document({
      document: { ...document().document, documentNumber: null }, // DDT unreadable -> exact check impossible
    });
    const result = processExtractedDocument({
      extracted,
      supplierId: "supplier-1",
      existingOrders: [],
      existingFingerprints: [{ orderId: "order-similar", fingerprint: "will-not-match" }],
    });
    // Sanity: with no matching fingerprint it should NOT be a possible duplicate.
    expect(result.status).not.toBe("POSSIBLE_DUPLICATE");

    const matching = processExtractedDocument({
      extracted,
      supplierId: "supplier-1",
      existingOrders: [],
      existingFingerprints: [{ orderId: "order-similar", fingerprint: result.fingerprint }],
    });
    expect(matching.status).toBe("POSSIBLE_DUPLICATE");
    expect(matching.possibleDuplicateOfOrderId).toBe("order-similar");
  });

  it("an exact DDT-number duplicate takes precedence over a fingerprint 'possible' match", () => {
    const result = processExtractedDocument({
      extracted: document(),
      supplierId: "supplier-1",
      existingOrders: [
        { id: "order-exact", supplierId: "supplier-1", normalizedDocumentNumber: "26-21-0562123" },
      ],
      existingFingerprints: [{ orderId: "order-fuzzy", fingerprint: "anything" }],
    });
    expect(result.status).toBe("DUPLICATE");
  });
});

describe("processExtractedDocument — payment signals flow through untouched", () => {
  it("propagates cash_required from the raw payment text", () => {
    const result = processExtractedDocument({
      extracted: document({ paymentText: "CASH AUTISTA" }),
      supplierId: "supplier-1",
      existingOrders: [],
      existingFingerprints: [],
    });
    expect(result.payment.cashRequired).toBe(true);
  });
});

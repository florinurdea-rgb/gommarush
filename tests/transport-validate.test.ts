import { describe, expect, it } from "vitest";
import {
  addressCompleteness,
  isValidIsoDate,
  isValidItalianTaxCode,
  isValidItalianVat,
  isValidPostalCode,
  isValidProvince,
  validateExtraction,
} from "@/lib/transport/validate";
import { EXTRACTION_SCHEMA_VERSION } from "@/lib/transport/extraction-schema";
import type {
  ExtractedDelivery,
  TransportDocumentExtraction,
} from "@/lib/transport/extraction-schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function zuinItem(overrides: Partial<ExtractedDelivery["items"][number]> = {}) {
  return {
    supplierProductCode: "NEX16618NX",
    ean: null,
    barcode: null,
    supplierOrderReference: "0B/17115",
    originalDescription: "185/55R16 83V N FERA PRIMUS RBP",
    brand: "NEXEN",
    model: "N FERA PRIMUS",
    width: 185,
    aspectRatio: 55,
    rimDiameter: 16,
    loadIndex: "83",
    speedIndex: "V",
    normalizedSize: "185/55 R16",
    quantity: 1,
    ...overrides,
  };
}

function zuinDelivery(overrides: Partial<ExtractedDelivery> = {}): ExtractedDelivery {
  return {
    deliveryDocumentNumber: "1A - 050472/VR",
    supplierOrderReference: "0B/17115",
    items: overrides.items ?? [zuinItem()],
    totalTyres: 1,
    packages: 1,
    weightKg: 7.3,
    deliveryDate: null,
    deliveryTimeWindow: null,
    deliveryInstructions: null,
    documentNotes: null,
    sourcePageStart: 1,
    sourcePageEnd: 1,
    ...overrides,
    recipient: {
      companyName: "EMMECI GOMME di Nicetto Federico",
      customerCode: "034932",
      taxCode: "NCTFRC90C06L840X",
      vatNumber: "03824320240",
      contactName: null,
      phone: "0444 420953",
      email: null,
      addressLine: "STRADA CA' BALBI 1",
      postalCode: "36050",
      city: "QUINTO VICENTINO",
      province: "VI",
      country: "IT",
      completeAddress: "STRADA CA' BALBI 1, 36050 QUINTO VICENTINO VI",
      ...(overrides.recipient ?? {}),
    },
    payment: {
      printedTerms: "RIBA 30 gg FM",
      operationalStatus: "NO_COLLECTION_REQUIRED",
      mustDriverCollect: false,
      amountToCollect: 0,
      currency: "EUR",
      paymentMethod: "RIBA",
      evidence: "RIBA 30 gg FM",
      ...(overrides.payment ?? {}),
    },
  };
}

function zuinExtraction(overrides: Partial<TransportDocumentExtraction> = {}): TransportDocumentExtraction {
  return {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    documentClassification: {
      documentType: "DDT_VENDITA",
      isTransportRelevant: true,
      documentNumber: "1A - 050472/VR",
      documentDate: "2026-08-06",
      pageCountDetected: 1,
      ...(overrides.documentClassification ?? {}),
    },
    distributor: {
      name: "ZUIN S.p.A.",
      vatNumber: "02627710284",
      warehouseName: "RIVOLI VERONESE",
      documentCustomerCode: null,
      ...(overrides.distributor ?? {}),
    },
    inboundLogistics: {
      method: "UNKNOWN",
      pickupRequired: null,
      pickupCompany: "ZUIN S.p.A.",
      pickupAddress: "VIA DELL'ARTIGIANATO 10, 37010 RIVOLI VERONESE VR",
      requestedPickupDate: null,
      requestedPickupTimeWindow: null,
      sourceCarrier: "GO RUSH TRASPORTI SRLS",
      ...(overrides.inboundLogistics ?? {}),
    },
    deliveries: overrides.deliveries ?? [zuinDelivery()],
    transportStart: null,
    warnings: [],
  };
}

const codesOf = (issues: { code: string }[]) => issues.map((issue) => issue.code);

// ---------------------------------------------------------------------------
// Italian identifiers
// ---------------------------------------------------------------------------

describe("Italian VAT check digit", () => {
  it("accepts the real Zuin distributor VAT", () => {
    expect(isValidItalianVat("02627710284")).toBe(true);
  });

  it("accepts the real EMMECI GOMME recipient VAT", () => {
    expect(isValidItalianVat("03824320240")).toBe(true);
  });

  it("rejects a VAT with a corrupted check digit", () => {
    expect(isValidItalianVat("02627710285")).toBe(false);
  });

  it("rejects wrong lengths", () => {
    expect(isValidItalianVat("0262771028")).toBe(false);
    expect(isValidItalianVat("026277102840")).toBe(false);
    expect(isValidItalianVat(null)).toBe(false);
  });

  it("tolerates formatting punctuation", () => {
    expect(isValidItalianVat("IT 02627710284")).toBe(true);
  });
});

describe("Italian tax code check character", () => {
  it("accepts the real recipient codice fiscale", () => {
    expect(isValidItalianTaxCode("NCTFRC90C06L840X")).toBe(true);
  });

  it("rejects a codice fiscale with a wrong check character", () => {
    expect(isValidItalianTaxCode("NCTFRC90C06L840A")).toBe(false);
  });

  it("validates an 11-digit company tax code as a VAT number", () => {
    expect(isValidItalianTaxCode("02627710284")).toBe(true);
    expect(isValidItalianTaxCode("02627710285")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isValidItalianTaxCode("NOTACODE")).toBe(false);
    expect(isValidItalianTaxCode(null)).toBe(false);
  });
});

describe("postal code, province and date", () => {
  it("validates CAP as exactly five digits", () => {
    expect(isValidPostalCode("36050")).toBe(true);
    expect(isValidPostalCode("3605")).toBe(false);
    expect(isValidPostalCode("360500")).toBe(false);
  });

  it("validates a two-letter province", () => {
    expect(isValidProvince("VI")).toBe(true);
    expect(isValidProvince("VIC")).toBe(false);
  });

  it("rejects a date that is not a real calendar day", () => {
    expect(isValidIsoDate("2026-08-06")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("06/08/2026")).toBe(false);
  });
});

describe("addressCompleteness", () => {
  it("requires street, city and postal code", () => {
    const complete = addressCompleteness(zuinDelivery().recipient);
    expect(complete.complete).toBe(true);

    const noCity = addressCompleteness(zuinDelivery({ recipient: { city: null } } as never).recipient);
    expect(noCity.complete).toBe(false);
    expect(noCity.missing).toContain("city");
  });
});

// ---------------------------------------------------------------------------
// The acceptance case
// ---------------------------------------------------------------------------

describe("validateExtraction - Zuin acceptance case", () => {
  const result = validateExtraction(zuinExtraction());

  it("produces exactly one confirmable transport job for one tyre", () => {
    expect(result.confirmableCount).toBe(1);
    expect(result.totalTyres).toBe(1);
  });

  it("resolves payment to no-collection with a zero amount", () => {
    expect(result.deliveries[0].resolvedPaymentStatus).toBe("NO_COLLECTION_REQUIRED");
    expect(result.deliveries[0].amountToCollectCents).toBe(0);
  });

  it("raises no blocking issues", () => {
    const blocking = [
      ...result.documentIssues.filter((i) => i.severity === "BLOCKING"),
      ...result.deliveries.flatMap((d) => d.issues.filter((i) => i.severity === "BLOCKING")),
    ];
    expect(blocking).toEqual([]);
  });

  it("warns that the inbound method needs confirming, without blocking", () => {
    expect(codesOf(result.documentIssues)).toContain("INBOUND_METHOD_UNKNOWN");
    expect(result.documentIssues.find((i) => i.code === "INBOUND_METHOD_UNKNOWN")?.severity).toBe("WARNING");
    expect(result.canConfirmAll).toBe(true);
  });

  it("never turns the taxable total into a COD amount", () => {
    // The model is given 63,74 as amountToCollect by mistake. A
    // non-collecting status must discard it, not carry it to a driver.
    const contaminated = validateExtraction(
      zuinExtraction({
        deliveries: [zuinDelivery({ payment: { amountToCollect: 63.74 } as never })],
      })
    );
    expect(contaminated.deliveries[0].amountToCollectCents).toBe(0);
    expect(contaminated.deliveries[0].canConfirm).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Blocking conditions
// ---------------------------------------------------------------------------

describe("validateExtraction - blocking conditions", () => {
  it("blocks a missing delivery address", () => {
    const result = validateExtraction(
      zuinExtraction({ deliveries: [zuinDelivery({ recipient: { addressLine: null, city: null } } as never)] })
    );
    expect(codesOf(result.deliveries[0].issues)).toContain("DELIVERY_ADDRESS_INCOMPLETE");
    expect(result.deliveries[0].canConfirm).toBe(false);
  });

  it("blocks an incomplete address missing only the postal code", () => {
    const result = validateExtraction(
      zuinExtraction({ deliveries: [zuinDelivery({ recipient: { postalCode: null } } as never)] })
    );
    expect(codesOf(result.deliveries[0].issues)).toContain("DELIVERY_ADDRESS_INCOMPLETE");
  });

  it("blocks an unreadable quantity instead of defaulting it to one", () => {
    const result = validateExtraction(
      zuinExtraction({ deliveries: [zuinDelivery({ items: [zuinItem({ quantity: null })] })] })
    );
    expect(codesOf(result.deliveries[0].issues)).toContain("QUANTITY_UNREADABLE");
    expect(result.deliveries[0].canConfirm).toBe(false);
  });

  it("blocks a zero or negative quantity", () => {
    for (const quantity of [0, -2]) {
      const result = validateExtraction(
        zuinExtraction({ deliveries: [zuinDelivery({ items: [zuinItem({ quantity })] })] })
      );
      expect(codesOf(result.deliveries[0].issues)).toContain("QUANTITY_NOT_POSITIVE_INTEGER");
    }
  });

  it("blocks a mismatch between the declared total and the line sum", () => {
    const result = validateExtraction(
      zuinExtraction({
        deliveries: [zuinDelivery({ totalTyres: 4, items: [zuinItem({ quantity: 1 })] })],
      })
    );
    expect(codesOf(result.deliveries[0].issues)).toContain("TOTAL_QUANTITY_MISMATCH");
    expect(result.deliveries[0].canConfirm).toBe(false);
  });

  it("blocks a missing document reference", () => {
    const result = validateExtraction(
      zuinExtraction({ deliveries: [zuinDelivery({ deliveryDocumentNumber: null })] })
    );
    expect(codesOf(result.deliveries[0].issues)).toContain("DOCUMENT_REFERENCE_MISSING");
  });

  it("blocks COD with no amount", () => {
    const result = validateExtraction(
      zuinExtraction({
        deliveries: [
          zuinDelivery({
            payment: { printedTerms: "CONTRASSEGNO", amountToCollect: null } as never,
          }),
        ],
      })
    );
    expect(codesOf(result.deliveries[0].issues)).toContain("COD_AMOUNT_MISSING");
    expect(result.deliveries[0].canConfirm).toBe(false);
  });

  it("accepts COD with an explicit amount", () => {
    const result = validateExtraction(
      zuinExtraction({
        deliveries: [
          zuinDelivery({
            payment: { printedTerms: "CONTRASSEGNO CONTANTI", amountToCollect: 250.5 } as never,
          }),
        ],
      })
    );
    expect(result.deliveries[0].resolvedPaymentStatus).toBe("COLLECT_CASH");
    expect(result.deliveries[0].amountToCollectCents).toBe(25050);
    expect(result.deliveries[0].canConfirm).toBe(true);
  });

  it("blocks an unclear payment status", () => {
    const result = validateExtraction(
      zuinExtraction({
        deliveries: [zuinDelivery({ payment: { printedTerms: "come da accordi" } as never })],
      })
    );
    expect(result.deliveries[0].resolvedPaymentStatus).toBe("UNKNOWN_REVIEW_REQUIRED");
    expect(codesOf(result.deliveries[0].issues)).toContain("PAYMENT_STATUS_UNRESOLVED");
    expect(result.deliveries[0].canConfirm).toBe(false);
  });

  it("blocks a document with no deliveries", () => {
    const result = validateExtraction(zuinExtraction({ deliveries: [] }));
    expect(codesOf(result.documentIssues)).toContain("NO_DELIVERIES_FOUND");
    expect(result.canConfirmAll).toBe(false);
  });

  it("blocks a non-transport document", () => {
    const result = validateExtraction(
      zuinExtraction({ documentClassification: { isTransportRelevant: false } as never })
    );
    expect(codesOf(result.documentIssues)).toContain("NOT_TRANSPORT_RELEVANT");
  });

  it("blocks a missing distributor", () => {
    const result = validateExtraction(zuinExtraction({ distributor: { name: null } as never }));
    expect(codesOf(result.documentIssues)).toContain("DISTRIBUTOR_MISSING");
  });
});

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

describe("validateExtraction - warnings that do not block", () => {
  it("warns on a bad EAN check digit", () => {
    const result = validateExtraction(
      zuinExtraction({ deliveries: [zuinDelivery({ items: [zuinItem({ ean: "4012345678902" })] })] })
    );
    const eanIssue = result.deliveries[0].issues.find((i) => i.code === "EAN_CHECK_DIGIT_INVALID");
    expect(eanIssue?.severity).toBe("WARNING");
    expect(result.deliveries[0].canConfirm).toBe(true);
  });

  it("warns on an out-of-range tyre dimension", () => {
    const result = validateExtraction(
      zuinExtraction({ deliveries: [zuinDelivery({ items: [zuinItem({ width: 1855 })] })] })
    );
    expect(codesOf(result.deliveries[0].issues)).toContain("TYRE_DIMENSION_OUT_OF_RANGE");
    expect(result.deliveries[0].canConfirm).toBe(true);
  });

  it("warns when the model's payment opinion contradicts the printed terms", () => {
    const result = validateExtraction(
      zuinExtraction({
        deliveries: [
          zuinDelivery({
            payment: {
              printedTerms: "RIBA 30 gg FM",
              operationalStatus: "COLLECT_CASH",
              amountToCollect: 63.74,
            } as never,
          }),
        ],
      })
    );
    expect(codesOf(result.deliveries[0].issues)).toContain("PAYMENT_STATUS_DISAGREEMENT");
    // The document wins.
    expect(result.deliveries[0].resolvedPaymentStatus).toBe("NO_COLLECTION_REQUIRED");
    expect(result.deliveries[0].amountToCollectCents).toBe(0);
  });

  it("warns on an invalid recipient VAT without blocking the delivery", () => {
    const result = validateExtraction(
      zuinExtraction({ deliveries: [zuinDelivery({ recipient: { vatNumber: "03824320241" } } as never)] })
    );
    expect(codesOf(result.deliveries[0].issues)).toContain("RECIPIENT_VAT_INVALID");
    expect(result.deliveries[0].canConfirm).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-recipient handling
// ---------------------------------------------------------------------------

describe("validateExtraction - multiple recipients in one paste", () => {
  it("validates each delivery independently and counts tyres across them", () => {
    const result = validateExtraction(
      zuinExtraction({
        deliveries: [
          zuinDelivery(),
          zuinDelivery({
            deliveryDocumentNumber: "1A - 050473/VR",
            recipient: { companyName: "GOMME VICENZA SRL", customerCode: "041201" } as never,
            totalTyres: 4,
            items: [zuinItem({ quantity: 4 })],
          }),
        ],
      })
    );

    expect(result.deliveries).toHaveLength(2);
    expect(result.confirmableCount).toBe(2);
    expect(result.totalTyres).toBe(5);
  });

  it("keeps identical tyres for different recipients as separate deliveries", () => {
    // The same product code and description for two customers must never be
    // merged -- they are two different transport obligations.
    const result = validateExtraction(
      zuinExtraction({
        deliveries: [
          zuinDelivery({ deliveryDocumentNumber: "1A - 050472/VR" }),
          zuinDelivery({
            deliveryDocumentNumber: "1A - 050480/VR",
            recipient: { companyName: "PNEUMATICI PADOVA SNC", customerCode: "050001" } as never,
          }),
        ],
      })
    );

    expect(result.deliveries).toHaveLength(2);
    expect(result.confirmableCount).toBe(2);
    expect(result.totalTyres).toBe(2);
  });

  it("lets one bad delivery block only itself", () => {
    const result = validateExtraction(
      zuinExtraction({
        deliveries: [
          zuinDelivery(),
          zuinDelivery({
            deliveryDocumentNumber: "1A - 050474/VR",
            recipient: { addressLine: null, city: null } as never,
          }),
        ],
      })
    );

    expect(result.deliveries[0].canConfirm).toBe(true);
    expect(result.deliveries[1].canConfirm).toBe(false);
    expect(result.canConfirmAll).toBe(false);
    expect(result.confirmableCount).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  addressKey,
  buildMappingKeys,
  companyNameKey,
  matchStoredMapping,
  resolutionCreatesMapping,
  streetNumber,
  vatKey,
  type StoredMapping,
} from "@/lib/documents/pipeline/party-mapping";
import { detectOrderType, revenueTreatmentFor } from "@/lib/documents/pipeline/order-type";

/**
 * Remembered party decisions.
 *
 * The tests that matter are the refusals: fuzzy names must not auto-confirm,
 * and a changed postcode / VAT / street number must invalidate a remembered
 * choice rather than silently preselecting the wrong company.
 */

function mapping(over: Partial<StoredMapping> = {}): StoredMapping {
  return {
    id: "m1",
    mappingRole: "DELIVERY_CUSTOMER",
    documentIssuerSupplierId: "sup-1",
    rawVatKey: "IT12345678901",
    rawSupplierCustomerCodeKey: "C0042",
    rawCompanyNameKey: "ROSSI GOMME",
    rawAddressKey: "VIA ROMA|12|36100|VICENZA",
    rawPostalCode: "36100",
    rawCityKey: "VICENZA",
    resolvedCompanyId: "cust-1",
    resolvedLocationId: "loc-1",
    resolvedOrderType: null,
    approved: true,
    disabled: false,
    useCount: 12,
    ...over,
  };
}

describe("normalisation keys", () => {
  it("strips legal forms so the same company keys identically", () => {
    expect(companyNameKey("Rossi Gomme S.r.l.")).toBe("ROSSI GOMME");
    expect(companyNameKey("ROSSI GOMME SRL")).toBe("ROSSI GOMME");
    expect(companyNameKey("Rossi Gomme S.p.A.")).toBe("ROSSI GOMME");
  });

  it("never strips a company down to nothing", () => {
    expect(companyNameKey("SRL")).toBe("SRL");
  });

  it("keeps the VAT country prefix but ignores punctuation", () => {
    expect(vatKey("IT 12345678901")).toBe("IT12345678901");
    expect(vatKey("it-12345678901")).toBe("IT12345678901");
  });

  it("extracts the civic number, the part most likely to change", () => {
    expect(streetNumber("Via Roma 12")).toBe("12");
    expect(streetNumber("Via Roma")).toBe("");
  });

  /**
   * The same doorway spelled two ways must key identically, and two different
   * doorways must not. An earlier version reduced "12/A" to "12", making it
   * indistinguishable from number 12.
   */
  it("normalises Italian civic suffixes to one form", () => {
    expect(streetNumber("Via Roma 12/A")).toBe("12/A");
    expect(streetNumber("Via Roma 12A")).toBe("12/A");
    expect(streetNumber("Viale dei Tigli 7B")).toBe("7/B");
    expect(streetNumber("Via Roma 12 bis")).toBe("12/BIS");
    expect(streetNumber("Via Roma 12/A")).not.toBe(streetNumber("Via Roma 12"));
  });

  it("builds a structured address key, not a free-text line", () => {
    const key = addressKey({ addressLine1: "Via Roma 12", postalCode: "36100", city: "Vicenza" });
    expect(key).toBe("VIA ROMA 12|12|36100|VICENZA");
  });
});

describe("matching precedence", () => {
  it("preselects automatically on an exact VAT match", () => {
    const match = matchStoredMapping(
      { companyName: "Qualcosa Diverso", vatNumber: "IT12345678901" },
      "DELIVERY_CUSTOMER",
      "sup-1",
      [mapping()]
    );
    expect(match?.strength).toBe("VAT_EXACT");
    expect(match?.autoPreselect).toBe(true);
    expect(match?.reasons).toContain("Partita IVA corrispondente");
    expect(match?.reasons).toContain("Selezione confermata in 12 documenti precedenti");
  });

  it("matches a VAT number with and without its country prefix", () => {
    const match = matchStoredMapping(
      { vatNumber: "12345678901" },
      "DELIVERY_CUSTOMER",
      "sup-1",
      [mapping()]
    );
    expect(match?.strength).toBe("VAT_EXACT");
  });

  it("prefers VAT over supplier code over address over name", () => {
    const all = [
      mapping({ id: "byName", rawVatKey: null, rawSupplierCustomerCodeKey: null, rawAddressKey: null }),
      mapping({ id: "byAddress", rawVatKey: null, rawSupplierCustomerCodeKey: null }),
      mapping({ id: "byCode", rawVatKey: null }),
      mapping({ id: "byVat" }),
    ];
    const match = matchStoredMapping(
      { companyName: "Rossi Gomme SRL", vatNumber: "IT12345678901", supplierCustomerCode: "C0042", addressLine1: "Via Roma 12", postalCode: "36100", city: "Vicenza" },
      "DELIVERY_CUSTOMER",
      "sup-1",
      all
    );
    expect(match?.mapping.id).toBe("byVat");
  });

  /** The rule the specification is emphatic about. */
  it("does NOT auto-preselect on a name match alone", () => {
    const match = matchStoredMapping(
      { companyName: "Rossi Gomme SRL" },
      "DELIVERY_CUSTOMER",
      "sup-1",
      [mapping({ rawVatKey: null, rawSupplierCustomerCodeKey: null, rawAddressKey: null, rawPostalCode: null, rawCityKey: null })]
    );
    expect(match?.strength).toBe("NAME_EXACT");
    expect(match?.autoPreselect).toBe(false);
  });

  it("does not auto-preselect even on name plus city", () => {
    const match = matchStoredMapping(
      { companyName: "Rossi Gomme SRL", city: "Vicenza" },
      "DELIVERY_CUSTOMER",
      "sup-1",
      [mapping({ rawVatKey: null, rawSupplierCustomerCodeKey: null, rawAddressKey: null })]
    );
    expect(match?.strength).toBe("NAME_AND_LOCATION");
    expect(match?.autoPreselect).toBe(false);
  });

  it("ignores unapproved and disabled mappings entirely", () => {
    expect(matchStoredMapping({ vatNumber: "IT12345678901" }, "DELIVERY_CUSTOMER", "sup-1", [mapping({ approved: false })])).toBeNull();
    expect(matchStoredMapping({ vatNumber: "IT12345678901" }, "DELIVERY_CUSTOMER", "sup-1", [mapping({ disabled: true })])).toBeNull();
  });

  it("scopes a supplier-specific code to its own issuer", () => {
    const match = matchStoredMapping(
      { supplierCustomerCode: "C0042" },
      "DELIVERY_CUSTOMER",
      "a-different-supplier",
      [mapping({ rawVatKey: null })]
    );
    expect(match).toBeNull();
  });

  it("does not cross mapping roles", () => {
    expect(matchStoredMapping({ vatNumber: "IT12345678901" }, "SUPPLIER", "sup-1", [mapping()])).toBeNull();
  });
});

describe("invalidation — history must not override fresh evidence", () => {
  it("invalidates on a different postcode", () => {
    const match = matchStoredMapping(
      { vatNumber: "IT12345678901", postalCode: "20100" },
      "DELIVERY_CUSTOMER",
      "sup-1",
      [mapping()]
    );
    expect(match?.strength).toBe("VAT_EXACT");
    expect(match?.autoPreselect).toBe(false);
    expect(match?.invalidation?.field).toBe("CAP");
  });

  it("invalidates on a different city", () => {
    const match = matchStoredMapping(
      { vatNumber: "IT12345678901", city: "Milano" },
      "DELIVERY_CUSTOMER",
      "sup-1",
      [mapping()]
    );
    expect(match?.autoPreselect).toBe(false);
    expect(match?.invalidation?.field).toBe("città");
  });

  it("invalidates on a different street number", () => {
    const match = matchStoredMapping(
      { vatNumber: "IT12345678901", addressLine1: "Via Roma 99", postalCode: "36100", city: "Vicenza" },
      "DELIVERY_CUSTOMER",
      "sup-1",
      [mapping()]
    );
    expect(match?.autoPreselect).toBe(false);
    expect(match?.invalidation?.field).toBe("numero civico");
  });

  it("invalidates on a conflicting VAT number", () => {
    const match = matchStoredMapping(
      { supplierCustomerCode: "C0042", vatNumber: "IT99999999999" },
      "DELIVERY_CUSTOMER",
      "sup-1",
      [mapping()]
    );
    expect(match?.autoPreselect).toBe(false);
    expect(match?.invalidation?.field).toBe("partita IVA");
  });

  /** Absence is not a difference, or every mapping would break on a sparse doc. */
  it("does not invalidate on a field the document simply omits", () => {
    const match = matchStoredMapping(
      { vatNumber: "IT12345678901" },
      "DELIVERY_CUSTOMER",
      "sup-1",
      [mapping()]
    );
    expect(match?.invalidation).toBeNull();
    expect(match?.autoPreselect).toBe(true);
  });
});

describe("what may be learned", () => {
  it("never learns from 'use for this order only'", () => {
    expect(resolutionCreatesMapping("USE_FOR_THIS_ORDER_ONLY")).toBe(false);
  });

  it("learns from a real confirmation", () => {
    for (const resolution of ["USE_EXISTING", "ADD_NEW_LOCATION", "UPDATE_EXISTING_LOCATION", "CREATE_NEW_CUSTOMER"] as const) {
      expect(resolutionCreatesMapping(resolution)).toBe(true);
    }
  });

  it("builds persistable keys from the raw extracted party", () => {
    const keys = buildMappingKeys({
      companyName: "Rossi Gomme S.r.l.",
      vatNumber: "IT 12345678901",
      supplierCustomerCode: "c-0042",
      addressLine1: "Via Roma 12",
      postalCode: "36100",
      city: "Vicenza",
    });
    expect(keys.raw_company_name_key).toBe("ROSSI GOMME");
    expect(keys.raw_vat_key).toBe("IT12345678901");
    expect(keys.raw_supplier_customer_code_key).toBe("C0042");
    expect(keys.raw_postal_code).toBe("36100");
  });
});

describe("order type", () => {
  it("uses an approved mapping and does not need an operator", () => {
    const result = detectOrderType({
      approvedMapping: { orderType: "TRANSPORT_JOB", useCount: 12 },
      documentText: null,
      relationshipConfig: null,
    });
    expect(result.suggested).toBe("TRANSPORT_JOB");
    expect(result.source).toBe("APPROVED_MAPPING");
    expect(result.requiresOperator).toBe(false);
    expect(result.evidence[0]).toContain("12 documenti");
  });

  it("reports a conflict when the document contradicts the mapping", () => {
    const result = detectOrderType({
      approvedMapping: { orderType: "OWN_SALE", useCount: 5 },
      documentText: "Trasporto per conto terzi — vettore incaricato",
      relationshipConfig: null,
    });
    expect(result.suggested).toBeNull();
    expect(result.requiresOperator).toBe(true);
    expect(result.conflict).toEqual({ mappingSays: "OWN_SALE", evidenceSays: "TRANSPORT_JOB" });
  });

  it("suggests from document evidence but still requires confirmation", () => {
    const result = detectOrderType({
      approvedMapping: null,
      documentText: "DDT — trasporto per conto terzi",
      relationshipConfig: null,
    });
    expect(result.suggested).toBe("TRANSPORT_JOB");
    expect(result.source).toBe("DOCUMENT_EVIDENCE");
    expect(result.requiresOperator).toBe(true);
  });

  it("refuses to choose when the evidence points both ways", () => {
    const result = detectOrderType({
      approvedMapping: null,
      documentText: "Fattura di vendita GommaRush — trasporto per conto terzi",
      relationshipConfig: null,
    });
    expect(result.suggested).toBeNull();
    expect(result.requiresOperator).toBe(true);
  });

  it("falls back to the operator with no evidence at all, and confidence 0", () => {
    const result = detectOrderType({ approvedMapping: null, documentText: "DDT 12345", relationshipConfig: null });
    expect(result.suggested).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.requiresOperator).toBe(true);
  });

  /** The rule both branches share, and the one hardest to spot when broken. */
  it("never lets a supplier document's prices become customer revenue", () => {
    expect(revenueTreatmentFor("TRANSPORT_JOB").productTotalsAreRevenue).toBe(false);
    expect(revenueTreatmentFor("OWN_SALE").productTotalsAreRevenue).toBe(false);
    expect(revenueTreatmentFor("TRANSPORT_JOB").transportRevenueFromRate).toBe(true);
    expect(revenueTreatmentFor("OWN_SALE").documentValuesAreSupplierCost).toBe(true);
  });
});

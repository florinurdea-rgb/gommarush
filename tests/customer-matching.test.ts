import { describe, expect, it } from "vitest";
import { companyKey, matchCustomer, streetKey } from "@/lib/logistics/customer-matching";
import type { CustomerLocationRow, CustomerRow } from "@/lib/types/logistics";

/**
 * Customer / location matching decisions.
 *
 * The rule under test throughout: master data is never silently overwritten. A
 * document that disagrees with what we hold must produce a decision for a human,
 * not an UPDATE.
 */

function customer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: "c1",
    name: "Rossi Gomme SRL",
    legal_name: null,
    vat_number: "IT04455667788",
    fiscal_code: null,
    phone: null,
    email: null,
    notes: null,
    active: true,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function location(overrides: Partial<CustomerLocationRow> = {}): CustomerLocationRow {
  return {
    id: "l1",
    customer_id: "c1",
    location_name: "Filiale Vicenza",
    recipient_name: null,
    address_line1: "Via Torino 42",
    address_line2: null,
    postal_code: "36100",
    city: "Vicenza",
    province: "VI",
    region: null,
    country_code: "IT",
    contact_name: null,
    phone: null,
    email: null,
    delivery_notes: null,
    is_primary: true,
    active: true,
    ...overrides,
  };
}

describe("normalisation helpers", () => {
  it("collapses legal forms so the same company matches itself", () => {
    expect(companyKey("Rossi Gomme S.r.l.")).toBe(companyKey("ROSSI GOMME SRL"));
    expect(companyKey("Rossi Gomme SpA")).toBe("rossi gomme");
  });

  it("strips street-type words so Via Torino 42 matches VIA TORINO, 42", () => {
    expect(streetKey("Via Torino 42")).toBe(streetKey("VIA TORINO, 42"));
  });
});

describe("matchCustomer", () => {
  it("MATCH CONFIRMED when company and address both agree", () => {
    const result = matchCustomer({
      extractedCustomer: { companyName: "ROSSI GOMME SRL", vatNumber: "IT04455667788" },
      extractedLocation: { addressLine1: "Via Torino 42", city: "Vicenza", postalCode: "36100" },
      customers: [customer()],
      locations: [location()],
    });

    expect(result.kind).toBe("match_confirmed");
    expect(result.requiresReview).toBe(false);
    expect(result.customer?.id).toBe("c1");
    expect(result.location?.id).toBe("l1");
  });

  it("matches on VAT even when the country prefix differs", () => {
    const result = matchCustomer({
      extractedCustomer: { companyName: "Totally Different Name", vatNumber: "04455667788" },
      extractedLocation: { addressLine1: "Via Torino 42", city: "Vicenza", postalCode: "36100" },
      customers: [customer()],
      locations: [location()],
    });
    expect(result.customer?.id).toBe("c1");
  });

  it("NEW CUSTOMER when nothing resembles the extracted company", () => {
    const result = matchCustomer({
      extractedCustomer: { companyName: "Bianchi Pneumatici SNC" },
      extractedLocation: { city: "Trento" },
      customers: [customer()],
      locations: [location()],
    });

    expect(result.kind).toBe("new_customer");
    expect(result.customer).toBeNull();
    expect(result.requiresReview).toBe(true);
  });

  it("NEW LOCATION when the company is certain but the address is unknown", () => {
    const result = matchCustomer({
      extractedCustomer: { companyName: "ROSSI GOMME SRL", vatNumber: "IT04455667788" },
      extractedLocation: {
        addressLine1: "Viale del Lavoro 7",
        city: "Verona",
        postalCode: "37135",
      },
      customers: [customer()],
      locations: [location()],
    });

    expect(result.kind).toBe("new_location");
    expect(result.customer?.id).toBe("c1");
    // The three choices the brief requires, and never a silent overwrite.
    expect(result.allowedResolutions).toEqual([
      "use_for_this_order_only",
      "add_as_new_location",
      "update_existing_location",
    ]);
  });

  it("POSSIBLE MATCH when the address is close but details differ", () => {
    const result = matchCustomer({
      extractedCustomer: { companyName: "ROSSI GOMME SRL", vatNumber: "IT04455667788" },
      // Same postcode and city, different street number/name detail.
      extractedLocation: { addressLine1: "Via Milano 42", city: "Vicenza", postalCode: "36100" },
      customers: [customer()],
      locations: [location()],
    });

    expect(result.kind).toBe("possible_match");
    expect(result.requiresReview).toBe(true);
    expect(result.differences).toContain("address_line1");
    expect(result.allowedResolutions).toContain("update_existing_location");
    expect(result.allowedResolutions).toContain("use_for_this_order_only");
  });

  it("POSSIBLE MATCH when the name only partially resembles a known customer", () => {
    const result = matchCustomer({
      extractedCustomer: { companyName: "Rossi Gomme e Ricambi" },
      extractedLocation: { addressLine1: "Via Torino 42", city: "Vicenza", postalCode: "36100" },
      customers: [customer({ vat_number: null })],
      locations: [location()],
    });

    expect(result.kind).toBe("possible_match");
    expect(result.requiresReview).toBe(true);
  });

  it("uses the supplier's learned customer code as a decisive signal", () => {
    const result = matchCustomer({
      extractedCustomer: { companyName: "R.G.", supplierCustomerCode: "CLI-9910" },
      extractedLocation: { addressLine1: "Via Torino 42", city: "Vicenza", postalCode: "36100" },
      customers: [customer()],
      locations: [location()],
      supplierRefCustomerId: "c1",
    });

    expect(result.kind).toBe("match_confirmed");
    expect(result.customer?.id).toBe("c1");
  });

  it("falls back to the primary location when the document has no address", () => {
    const result = matchCustomer({
      extractedCustomer: { companyName: "ROSSI GOMME SRL", vatNumber: "IT04455667788" },
      extractedLocation: {},
      customers: [customer()],
      locations: [location()],
    });

    expect(result.location?.id).toBe("l1");
    expect(result.kind).toBe("match_confirmed");
  });

  it("does not leak another customer's locations into the decision", () => {
    const result = matchCustomer({
      extractedCustomer: { companyName: "ROSSI GOMME SRL", vatNumber: "IT04455667788" },
      extractedLocation: { addressLine1: "Via Torino 42", city: "Vicenza", postalCode: "36100" },
      customers: [customer()],
      locations: [location({ id: "other", customer_id: "c2" })],
    });

    expect(result.locationCandidates).toHaveLength(0);
  });
});

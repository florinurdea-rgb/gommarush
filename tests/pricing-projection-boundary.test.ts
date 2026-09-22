import { describe, expect, it } from "vitest";
import { calculateTyrePrice } from "@/lib/pricing/calculate";
import { DEFAULT_PRICING_SETTINGS, type PricingSettings } from "@/lib/pricing/settings";
import { resolvedPfu, unresolvedPfu } from "@/lib/pricing/pfu";
import {
  FORBIDDEN_CUSTOMER_FIELDS,
  toCustomerOffer,
  toInternalOffer,
  type PricedListing,
} from "@/lib/pricing/projection";

/**
 * The customer / internal boundary.
 *
 * These tests are the reason the two projections are separate types rather
 * than one object with fields the customer UI happens not to render. They
 * assert on the SERIALISED payload, at every depth, because that is what
 * actually crosses the wire — a field the UI ignores is still in the JSON.
 */

const SETTINGS: PricingSettings = { ...DEFAULT_PRICING_SETTINGS, pfuVatBase: "inside_vat_base" };

function listing(overrides: Partial<PricedListing> = {}): PricedListing {
  return {
    tyre: {
      productId: "11111111-1111-1111-1111-111111111111",
      brand: "MICHELIN",
      modelPattern: "PRIMACY 4",
      description: "205/55 R16 91V PRIMACY 4",
      sizeDisplay: "205/55 R16",
      widthMm: 205,
      aspectRatio: 55,
      rimInch: 16,
      loadIndex: "91",
      speedRating: "V",
      loadSpeedRaw: "91V",
      season: "summer",
      productClass: "passenger_car",
      xl: false,
      runFlat: false,
      oldDot: false,
      eprelId: "123456",
    },
    availability: "unknown",
    supplierListingId: "22222222-2222-2222-2222-222222222222",
    supplierName: "Inter-Sprint Banden BV",
    supplierArticleId: "ISB-12851",
    costObservedAt: "2026-09-08T14:46:30.554Z",
    breakdown: calculateTyrePrice(
      { supplierCostCents: 6_150, pfu: resolvedPfu("SUPPLIER_EXACT", 316, null, "Supplier.") },
      SETTINGS
    ),
    ...overrides,
  };
}

/** Every key present anywhere in a serialised value, at any depth. */
function allKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) allKeys(entry, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      allKeys(nested, found);
    }
  }
  return found;
}

/** Every primitive value present anywhere, for scanning the payload's content. */
function allValues(value: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const entry of value) allValues(entry, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) allValues(nested, found);
    return found;
  }
  found.push(value);
  return found;
}

describe("customer projection cannot expose supplier cost or identity", () => {
  it("omits every forbidden field name", () => {
    const payload = JSON.parse(JSON.stringify(toCustomerOffer(listing())));
    const keys = allKeys(payload);

    for (const forbidden of FORBIDDEN_CUSTOMER_FIELDS) {
      expect(keys.has(forbidden), `customer payload exposed "${forbidden}"`).toBe(false);
    }
  });

  /**
   * The field-name check alone would pass if a cost were copied into an
   * innocently named field, so the VALUES are checked too.
   */
  it("does not contain the supplier cost as a value anywhere", () => {
    const source = listing();
    const payload = JSON.parse(JSON.stringify(toCustomerOffer(source)));
    const values = allValues(payload);

    expect(source.breakdown.supplierCostCents).toBe(6_150);
    expect(values).not.toContain(6_150);
    // Nor the markup amount, from which the cost could be derived.
    expect(values).not.toContain(source.breakdown.markupAmountCents);
  });

  it("does not contain the supplier name or article code anywhere", () => {
    const source = listing();
    const serialised = JSON.stringify(toCustomerOffer(source));

    expect(serialised).not.toContain("Inter-Sprint");
    expect(serialised).not.toContain("ISB-12851");
    expect(serialised).not.toContain(source.supplierListingId);
  });

  it("still gives the customer a usable selling price", () => {
    const offer = toCustomerOffer(listing());

    expect(offer.tyreSaleNetCents).toBe(7_380);
    expect(offer.customerTotalCents).toBe(9_389);
    expect(offer.priceAvailable).toBe(true);
    expect(offer.tyre.brand).toBe("MICHELIN");
  });

  /** A tyre with no cost must read as "no price", not as a free tyre. */
  it("reports no price rather than a zero price when cost is missing", () => {
    const offer = toCustomerOffer(
      listing({
        breakdown: calculateTyrePrice(
          { supplierCostCents: null, pfu: unresolvedPfu("No tariff.") },
          SETTINGS
        ),
      })
    );

    expect(offer.priceAvailable).toBe(false);
    expect(offer.tyreSaleNetCents).toBeNull();
    expect(offer.customerTotalCents).toBeNull();
    expect(offer.pfuStatus).toBe("TO_CONFIRM");
    expect(offer.pfuAmountCents).toBeNull();
  });

  /**
   * The blocked reasons explain WHY a price is missing, and some of them
   * discuss supplier data. They belong to the operator, not the customer.
   */
  it("withholds the diagnostic reasons from the customer", () => {
    const offer = toCustomerOffer(
      listing({
        breakdown: calculateTyrePrice(
          { supplierCostCents: null, pfu: unresolvedPfu("No tariff.") },
          SETTINGS
        ),
      })
    );

    expect(allKeys(JSON.parse(JSON.stringify(offer))).has("blockedReasons")).toBe(false);
  });

  /**
   * A regression guard for the usual way this breaks: someone widens the
   * source object and a spread carries the new field through. The customer
   * projection copies named fields, so an unknown extra must not appear.
   */
  it("ignores fields added to the source listing", () => {
    const widened = {
      ...listing(),
      secretSupplierRebateCents: 999,
    } as unknown as PricedListing;

    const keys = allKeys(JSON.parse(JSON.stringify(toCustomerOffer(widened))));
    expect(keys.has("secretSupplierRebateCents")).toBe(false);
  });
});

describe("internal projection receives the full commercial breakdown", () => {
  it("carries every step from supplier cost to customer total", () => {
    const offer = toInternalOffer(listing());

    expect(offer.supplierCostCents).toBe(6_150);
    expect(offer.markupPercentApplied).toBe(20);
    expect(offer.markupAmountCents).toBe(1_230);
    expect(offer.tyreSaleNetCents).toBe(7_380);
    expect(offer.pfuStatus).toBe("SUPPLIER_EXACT");
    expect(offer.pfuAmountCents).toBe(316);
    expect(offer.taxableSubtotalCents).toBe(7_696);
    expect(offer.vatRatePercentApplied).toBe(22);
    expect(offer.vatAmountCents).toBe(1_693);
    expect(offer.customerTotalCents).toBe(9_389);
  });

  it("exposes supplier identity, which is its whole purpose", () => {
    const offer = toInternalOffer(listing());

    expect(offer.supplierName).toBe("Inter-Sprint Banden BV");
    expect(offer.supplierArticleId).toBe("ISB-12851");
    expect(offer.costObservedAt).toBe("2026-09-08T14:46:30.554Z");
  });

  it("reports gross profit and gross margin separately", () => {
    const offer = toInternalOffer(listing());

    expect(offer.grossProfitCents).toBe(1_230);
    expect(offer.grossMarginPercent).toBeCloseTo(16.6667, 3);
  });

  it("explains why a price is unavailable", () => {
    const offer = toInternalOffer(
      listing({
        breakdown: calculateTyrePrice(
          { supplierCostCents: null, pfu: unresolvedPfu("No verified tariff.") },
          SETTINGS
        ),
      })
    );

    expect(offer.resolution).toBe("cost_unavailable");
    expect(offer.blockedReasons.length).toBeGreaterThan(0);
    expect(offer.blockedReasons[0]).toContain("No supplier purchase cost");
  });

  it("surfaces the open PFU question rather than hiding it", () => {
    const offer = toInternalOffer(
      listing({
        breakdown: calculateTyrePrice(
          { supplierCostCents: 6_150, pfu: unresolvedPfu("No verified PFU tariff data exists.") },
          SETTINGS
        ),
      })
    );

    expect(offer.resolution).toBe("pfu_unresolved");
    expect(offer.pfuStatus).toBe("TO_CONFIRM");
    expect(offer.pfuAmountCents).toBeNull();
    expect(offer.customerTotalCents).toBeNull();
    // The operator can still judge competitiveness on the net price.
    expect(offer.tyreSaleNetCents).toBe(7_380);
    expect(offer.grossProfitCents).toBe(1_230);
  });
});

describe("the two projections describe the same tyre", () => {
  it("agrees on every figure the customer is allowed to see", () => {
    const source = listing();
    const customer = toCustomerOffer(source);
    const internal = toInternalOffer(source);

    expect(customer.tyreSaleNetCents).toBe(internal.tyreSaleNetCents);
    expect(customer.pfuAmountCents).toBe(internal.pfuAmountCents);
    expect(customer.vatAmountCents).toBe(internal.vatAmountCents);
    expect(customer.customerTotalCents).toBe(internal.customerTotalCents);
    expect(customer.tyre).toEqual(internal.tyre);
  });
});

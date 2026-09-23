import { describe, expect, it } from "vitest";
import {
  catalogueViewState,
  hasCompleteDimensions,
  shouldQueryCatalogue,
} from "@/lib/customer/catalogue-view";
import { formatSalesOrderNumber, parseSalesOrderNumber } from "@/lib/commerce/order-number";
import {
  DEFAULT_FULFILMENT_CLASS,
  FULFILMENT_PROMISES,
  fulfilmentPromise,
  isFulfilmentClass,
} from "@/lib/commerce/fulfilment";
import { PAYMENT_METHODS } from "@/lib/server/sales-orders";
import { customerBasketPayload, type BasketResolvedLine } from "@/lib/server/customer-basket";
import { DEFAULT_PRICING_SETTINGS } from "@/lib/pricing/settings";
import { calculateTyrePrice } from "@/lib/pricing/calculate";
import { resolvePfu } from "@/lib/pricing/pfu";
import { toCustomerOffer, toInternalOffer, type PricedListing } from "@/lib/pricing/projection";

// ---------------------------------------------------------------------------
// The deliberate search
// ---------------------------------------------------------------------------

describe("the catalogue asks for a size before it asks the database", () => {
  it("needs all three dimensions, not two", () => {
    expect(hasCompleteDimensions({ widthMm: "205", aspectRatio: "55", rimInch: "16" })).toBe(true);
    expect(hasCompleteDimensions({ widthMm: "205", aspectRatio: "55", rimInch: "" })).toBe(false);
    expect(hasCompleteDimensions({ widthMm: "205", aspectRatio: "", rimInch: "16" })).toBe(false);
    expect(hasCompleteDimensions({ widthMm: "", aspectRatio: "55", rimInch: "16" })).toBe(false);
    expect(hasCompleteDimensions({ widthMm: null, aspectRatio: null, rimInch: null })).toBe(false);
  });

  it("does not accept whitespace as a chosen dimension", () => {
    expect(hasCompleteDimensions({ widthMm: "205", aspectRatio: "  ", rimInch: "16" })).toBe(false);
  });

  it("accepts numbers as well as the strings a <select> yields", () => {
    expect(hasCompleteDimensions({ widthMm: 205, aspectRatio: 55, rimInch: 16 })).toBe(true);
    expect(hasCompleteDimensions({ widthMm: 205, aspectRatio: Number.NaN, rimInch: 16 })).toBe(false);
  });

  it("gates the request on the same rule the view uses", () => {
    expect(shouldQueryCatalogue({ widthMm: "205", aspectRatio: "55", rimInch: "" })).toBe(false);
    expect(shouldQueryCatalogue({ widthMm: "205", aspectRatio: "55", rimInch: "16" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Loading behaviour
// ---------------------------------------------------------------------------

describe("the catalogue never looks frozen or stale", () => {
  const size = { widthMm: "205", aspectRatio: "55", rimInch: "16" };

  it("asks for a size before it shows a spinner", () => {
    expect(
      catalogueViewState({
        widthMm: "205",
        aspectRatio: "",
        rimInch: "",
        loading: true,
        error: false,
        refused: false,
      })
    ).toBe("awaiting_dimensions");
  });

  it("shows placeholders while a request is in flight", () => {
    expect(catalogueViewState({ ...size, loading: true, error: false, refused: false })).toBe("loading");
  });

  /**
   * The stale-results bug this rules out: changing a filter puts the view back
   * into `loading`, so the PREVIOUS selection's list cannot remain on screen
   * underneath the new filter, where it would read as an answer.
   */
  it("never shows results while loading, even when results are held", () => {
    for (const error of [false, true]) {
      for (const refused of [false, true]) {
        expect(catalogueViewState({ ...size, loading: true, error, refused })).toBe("loading");
      }
    }
  });

  it("prefers a failure over a refusal, because a failed request measured nothing", () => {
    expect(catalogueViewState({ ...size, loading: false, error: true, refused: true })).toBe("error");
  });

  it("reports a refusal rather than silently showing a truncated list", () => {
    expect(catalogueViewState({ ...size, loading: false, error: false, refused: true })).toBe("refused");
  });

  it("shows results only when nothing is pending or wrong", () => {
    expect(catalogueViewState({ ...size, loading: false, error: false, refused: false })).toBe("results");
  });
});

// ---------------------------------------------------------------------------
// Delivery promise
// ---------------------------------------------------------------------------

describe("delivery is promised by service class, not by supplier", () => {
  it("promises seven days on the standard class", () => {
    expect(DEFAULT_FULFILMENT_CLASS).toBe("standard");
    expect(fulfilmentPromise("standard").maxDays).toBe(7);
  });

  it("keeps express as a narrower, hour-bounded promise", () => {
    expect(fulfilmentPromise("express")).toMatchObject({ minHours: 24, maxHours: 48 });
  });

  /**
   * The inference channel this closes: a per-offer lead time would differ
   * between supplier lanes (Inter-Sprint 7d, Carlini 48h), and a customer
   * comparing two cards would learn which tyres come from the fast supplier.
   * The promise depends only on the class, so it cannot carry that.
   */
  it("depends on nothing but the class", () => {
    expect(Object.keys(FULFILMENT_PROMISES).sort()).toEqual(["express", "standard"]);
    expect(fulfilmentPromise("standard")).toEqual(fulfilmentPromise("standard"));
  });

  it("recognises only the two defined classes", () => {
    expect(isFulfilmentClass("standard")).toBe(true);
    expect(isFulfilmentClass("overnight")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

describe("V1 payment methods", () => {
  it("offers exactly bank transfer and cash on delivery", () => {
    expect([...PAYMENT_METHODS]).toEqual(["bank_transfer", "cash_on_delivery"]);
  });

  /** POS on delivery was in the first draft and is not an approved channel. */
  it("does not offer POS on delivery", () => {
    expect(PAYMENT_METHODS as readonly string[]).not.toContain("pos_on_delivery");
  });

  it("matches the database check constraint, so neither can drift", () => {
    const sql = require("node:fs").readFileSync(
      "supabase/pending-approval/0006_sales_orders.sql",
      "utf8"
    ) as string;
    const match = /payment_method in \(([^)]*)\)/.exec(sql);
    expect(match, "0006 must constrain payment_method").not.toBeNull();

    const allowed = (match?.[1] ?? "")
      .split(",")
      .map((v) => v.trim().replace(/^'|'$/g, ""))
      .sort();
    expect(allowed).toEqual([...PAYMENT_METHODS].sort());
  });
});

// ---------------------------------------------------------------------------
// Order number
// ---------------------------------------------------------------------------

describe("the order number is one mechanism, formatted once", () => {
  it("renders the sequence value as a padded GommaRush reference", () => {
    expect(formatSalesOrderNumber(1000)).toBe("GR-001000");
    expect(formatSalesOrderNumber(1)).toBe("GR-000001");
    expect(formatSalesOrderNumber(1234567)).toBe("GR-1234567");
  });

  it("is stable: the same allocated number always formats identically", () => {
    expect(formatSalesOrderNumber(1042)).toBe(formatSalesOrderNumber(1042));
    expect(formatSalesOrderNumber(1042)).toBe(formatSalesOrderNumber(BigInt(1042)));
  });

  it("round-trips, so a customer can quote it back", () => {
    for (const n of [1, 1000, 987654]) {
      expect(parseSalesOrderNumber(formatSalesOrderNumber(n))).toBe(n);
    }
    expect(parseSalesOrderNumber("gr-001000")).toBe(1000);
    expect(parseSalesOrderNumber("1000")).toBe(1000);
  });

  it("refuses to invent a number for something that is not one of ours", () => {
    expect(parseSalesOrderNumber("DDT-99")).toBeNull();
    expect(parseSalesOrderNumber("")).toBeNull();
    expect(parseSalesOrderNumber(null)).toBeNull();
    expect(formatSalesOrderNumber(null)).toBe("");
    expect(formatSalesOrderNumber(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Money still fails closed
// ---------------------------------------------------------------------------

/** A line priced by the REAL engine from real settings — no hand-built total. */
function realLine(quantity: number): BasketResolvedLine {
  const listing: PricedListing = {
    tyre: {
      productId: "11111111-1111-1111-1111-111111111111",
      brand: "ALPHA",
      modelPattern: "M",
      description: null,
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
      eprelId: null,
    },
    availability: "in_stock",
    supplierListingId: "l-1",
    supplierName: "SECRET SUPPLIER",
    supplierArticleId: "SECRET-SKU",
    costObservedAt: "2026-09-22T14:00:00Z",
    breakdown: calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: resolvePfu({ weightKg: 8.5 }) },
      DEFAULT_PRICING_SETTINGS
    ),
    supplierStockExact: 20,
    supplierStockMinimum: null,
    supplierStockRaw: "20",
    sellability: { sellable: true, reason: "sellable", assessedQuantity: 20, minimumApplied: 5 },
  };

  return {
    input: { productId: listing.tyre.productId, oldDot: false, quantity },
    customer: toCustomerOffer(listing),
    internal: toInternalOffer(listing),
  };
}

describe("an unresolved PFU cannot become a final total", () => {
  it("reports the tyre value and withholds the payable amount", () => {
    const basket = customerBasketPayload([realLine(4)]);

    // Known: 100.00 cost + 20% = 120.00 net, x4.
    expect(basket.tyreNetTotalCents).toBe(48_000);
    // Not known, and not guessed:
    expect(basket.monetaryStatus).toBe("pending_pfu");
    expect(basket.pfuTotalCents).toBeNull();
    expect(basket.vatTotalCents).toBeNull();
    expect(basket.grandTotalCents).toBeNull();
  });

  it("states the tax position it DOES know, so the gap is explainable", () => {
    const basket = customerBasketPayload([realLine(4)]);

    expect(basket.vatRatePercent).toBe(22);
    // D11 resolved: PFU is inside the VAT base. D3, the tariff, is not.
    expect(basket.pfuInVatBase).toBe(true);
  });

  it("carries the delivery promise on the basket too", () => {
    expect(customerBasketPayload([realLine(1)]).fulfilment).toEqual({
      class: "standard",
      maxDays: 7,
    });
  });

  it("leaks no supplier internals into the basket payload", () => {
    const json = JSON.stringify(customerBasketPayload([realLine(2)]));
    for (const secret of [
      "SECRET SUPPLIER",
      "SECRET-SKU",
      "l-1",
      "supplierCostCents",
      "grossProfitCents",
      "markupPercentApplied",
    ]) {
      expect(json, `${secret} must not reach a customer`).not.toContain(secret);
    }
  });
});

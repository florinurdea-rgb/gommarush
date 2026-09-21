import { describe, it, expect } from "vitest";
import {
  toSourcingOption,
  rankSourcingOptions,
  buildProductResult,
  stockLabel,
  type CommercialObservationRow,
} from "./search";

const NOW = new Date("2026-09-21T12:00:00Z");

function row(over: Partial<CommercialObservationRow> = {}): CommercialObservationRow {
  return {
    observation_id: "obs-1",
    supplier_listing_id: "listing-1",
    supplier_id: "sup-1",
    lane_code: "intersprint",
    supplier_name: "Inter-Sprint",
    catalogue_product_id: "prod-1",
    supplier_article_id: "12851",
    supplier_listing_key: "ISB:12851",
    old_dot: false,
    purchase_price: "80.0000",
    currency: "EUR",
    stock_exact: 12,
    stock_raw: null,
    stock_status: "in_stock",
    stock_confidence: "exact",
    lead_time_days: 2,
    delivery_class: "48h",
    observed_at: "2026-09-21T11:00:00Z",
    price_verified_at: null,
    stock_verified_at: null,
    source_type: "ftp_feed",
    pfu_amount: null,
    pfu_status: "TO_CONFIRM",
    pfu_source: null,
    dot_code: null,
    observed_by: null,
    observation_note: null,
    price_ttl_hours: 24,
    stock_ttl_hours: 24,
    stale_multiplier: "2.00",
    ...over,
  };
}

describe("TEST-DATA EXCLUSION INVARIANT", () => {
  it("THROWS if a test-data row reaches the commercial path", () => {
    expect(() => toSourcingOption(row({ is_test_data: true }), NOW)).toThrow(
      /Test-data observation .* reached the commercial path/,
    );
  });

  it("names the correct query boundary in the failure", () => {
    expect(() => toSourcingOption(row({ is_test_data: true }), NOW)).toThrow(
      /supplier_commercial_observations/,
    );
  });

  it("fails loudly rather than silently dropping the row", () => {
    // A silent drop would hide a breached boundary; a throw surfaces the defect.
    let threw = false;
    try { toSourcingOption(row({ is_test_data: true }), NOW); } catch { threw = true; }
    expect(threw).toBe(true);
  });

  it("accepts rows explicitly marked non-test", () => {
    expect(() => toSourcingOption(row({ is_test_data: false }), NOW)).not.toThrow();
  });

  it("accepts rows from the view, which omits the guard column entirely", () => {
    const r = row();
    delete (r as unknown as Record<string, unknown>).is_test_data;
    expect(() => toSourcingOption(r, NOW)).not.toThrow();
  });

  it("a poisoned batch fails the whole build - no partial fictional pricing", () => {
    expect(() =>
      buildProductResult("prod-1", [row(), row({ observation_id: "obs-2", is_test_data: true })], ["intersprint"], NOW),
    ).toThrow();
  });
});

describe("unknown is never rendered as zero", () => {
  it("marks a missing price unavailable rather than 0", () => {
    const o = toSourcingOption(row({ purchase_price: null }), NOW);
    expect(o.purchasePriceNet).toBeNull();
    expect(o.priceUnavailable).toBe(true);
    expect(o.quotable).toBe(false);
  });

  it("never renders a count when confidence is not exact/approximate", () => {
    expect(stockLabel(12, "in_stock", "boolean_only")).toBe("In stock");
    expect(stockLabel(12, "in_stock", "unknown")).toBe("In stock");
    expect(stockLabel(12, "in_stock", "exact")).toBe("12 in stock");
    expect(stockLabel(12, "in_stock", "approximate")).toBe("~12 in stock");
    expect(stockLabel(null, "unknown", "unknown")).toBe("Stock unknown");
    expect(stockLabel(null, "on_request", "stated")).toBe("On request");
  });

  it("defaults absent stock and PFU to unknown / TO_CONFIRM", () => {
    const o = toSourcingOption(
      row({ stock_status: null, stock_confidence: null, pfu_status: null }),
      NOW,
    );
    expect(o.stockStatus).toBe("unknown");
    expect(o.stockConfidence).toBe("unknown");
    expect(o.pfuStatus).toBe("TO_CONFIRM");
    expect(o.pfuProvisional).toBe(true);
  });

  it("parses numeric strings from Postgres numeric columns", () => {
    const o = toSourcingOption(row({ purchase_price: "80.0000" }), NOW);
    expect(o.purchasePriceNet).toBe(80);
  });
});

describe("freshness is surfaced per observation", () => {
  it("classifies a recent observation FRESH", () => {
    expect(toSourcingOption(row(), NOW).priceFreshness).toBe("FRESH");
  });

  it("classifies an old observation STALE and still returns it", () => {
    const o = toSourcingOption(row({ observed_at: "2026-09-01T11:00:00Z" }), NOW);
    expect(o.priceFreshness).toBe("STALE");
    expect(o.ageHours).toBeGreaterThan(400);
  });

  it("is UNKNOWN when the lane has no TTL configured", () => {
    const o = toSourcingOption(row({ price_ttl_hours: null }), NOW);
    expect(o.priceFreshness).toBe("UNKNOWN");
  });

  it("prefers explicit verified_at over observed_at", () => {
    const o = toSourcingOption(
      row({ observed_at: "2026-09-01T11:00:00Z", price_verified_at: "2026-09-21T11:30:00Z" }),
      NOW,
    );
    expect(o.priceFreshness).toBe("FRESH");
  });
});

describe("deterministic ranking", () => {
  it("puts quotable options before unquotable ones", () => {
    const ranked = rankSourcingOptions([
      toSourcingOption(row({ lane_code: "deldo", purchase_price: null }), NOW),
      toSourcingOption(row({ lane_code: "intersprint", purchase_price: "90" }), NOW),
    ]);
    expect(ranked[0].laneCode).toBe("intersprint");
  });

  it("prefers fresher over cheaper", () => {
    const ranked = rankSourcingOptions([
      toSourcingOption(row({ lane_code: "deldo", purchase_price: "70", observed_at: "2026-09-01T00:00:00Z" }), NOW),
      toSourcingOption(row({ lane_code: "intersprint", purchase_price: "90" }), NOW),
    ]);
    expect(ranked[0].laneCode).toBe("intersprint");
    expect(ranked[0].priceFreshness).toBe("FRESH");
  });

  it("prefers cheaper at equal freshness", () => {
    const ranked = rankSourcingOptions([
      toSourcingOption(row({ lane_code: "intersprint", purchase_price: "90" }), NOW),
      toSourcingOption(row({ lane_code: "deldo", purchase_price: "70" }), NOW),
    ]);
    expect(ranked[0].laneCode).toBe("deldo");
  });

  it("is stable and does not mutate its input", () => {
    const input = [
      toSourcingOption(row({ lane_code: "intersprint", purchase_price: "80" }), NOW),
      toSourcingOption(row({ lane_code: "deldo", purchase_price: "80" }), NOW),
    ];
    const snapshot = input.map((o) => o.laneCode);
    const a = rankSourcingOptions(input).map((o) => o.laneCode);
    const b = rankSourcingOptions(input).map((o) => o.laneCode);
    expect(a).toEqual(b);
    expect(input.map((o) => o.laneCode)).toEqual(snapshot);
  });
});

describe("side-by-side product result", () => {
  it("shows Inter-Sprint and Deldo together", () => {
    const result = buildProductResult(
      "prod-1",
      [
        row({ lane_code: "intersprint", supplier_name: "Inter-Sprint", purchase_price: "82.50" }),
        row({ observation_id: "obs-2", supplier_listing_id: "listing-2", lane_code: "deldo",
              supplier_name: "Deldo", purchase_price: "79.90", delivery_class: "5_7d" }),
      ],
      ["intersprint", "deldo", "it_48h"],
      NOW,
    );
    expect(result.options).toHaveLength(2);
    expect(result.options.map((o) => o.laneCode)).toEqual(["deldo", "intersprint"]);
    expect(result.options[0].deliveryClass).toBe("5_7d");
  });

  it("reports a lane with NO data as absent, not as zero stock", () => {
    const result = buildProductResult(
      "prod-1",
      [row({ lane_code: "intersprint" })],
      ["intersprint", "deldo", "it_48h"],
      NOW,
    );
    expect(result.lanesWithoutData).toEqual(["deldo", "it_48h"]);
    expect(result.options.some((o) => o.laneCode === "deldo")).toBe(false);
  });

  it("handles a product with no sourcing options at all", () => {
    const result = buildProductResult("prod-1", [], ["intersprint", "deldo"], NOW);
    expect(result.options).toEqual([]);
    expect(result.lanesWithoutData).toEqual(["intersprint", "deldo"]);
  });
});

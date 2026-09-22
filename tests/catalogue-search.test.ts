import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Catalogue search, end to end through the pricing layer.
 *
 * The database is mocked, but the pricing engine and both projections are the
 * real ones — the point is to prove that a row carrying supplier cost and
 * supplier identity comes out priced for an operator and stripped for a
 * customer, from a single query.
 *
 * The mock rows deliberately carry a purchase price even though the live
 * Inter-Sprint catalogue currently has none. Testing only against today's
 * empty commercial data would leave the leak assertions vacuously true.
 */

const from = vi.fn();
const captured: { filters: [string, unknown][] } = { filters: [] };

vi.mock("@/lib/supabase/server-admin", () => ({
  createSupabaseAdminClient: () => ({ from }),
}));

function mockListings(data: unknown, error: unknown = null) {
  captured.filters = [];
  const chain: Record<string, unknown> = {};
  const self = () => chain;

  chain.select = self;
  chain.eq = (column: string, value: unknown) => {
    captured.filters.push([column, value]);
    return chain;
  };
  chain.not = self;
  chain.order = self;
  chain.limit = self;
  chain.range = () => Promise.resolve({ data, error });

  from.mockReturnValue(chain);
}

const PRODUCT = {
  id: "11111111-1111-1111-1111-111111111111",
  brand: "MICHELIN",
  model_pattern: "PRIMACY 4",
  description: "205/55 R16 91V",
  size_display: "205/55 R16",
  width_mm: 205,
  aspect_ratio: 55,
  rim_inch: 16,
  load_index: "91",
  speed_rating: "V",
  load_speed_raw: "91V",
  season: "summer",
  product_class: "passenger_car",
  xl: false,
  run_flat: false,
  old_dot: false,
  eprel_id: "123456",
  weight_kg: 8.5,
  active: true,
};

function listingRow(price: Record<string, unknown> | null) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    supplier_article_id: "ISB-12851",
    old_dot: false,
    catalogue_products: PRODUCT,
    suppliers: { name: "Inter-Sprint Banden BV" },
    supplier_listing_prices: price ? [price] : [],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("catalogue search filters", () => {
  it("filters on the size tuple and season the operator chose", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");
    mockListings([]);

    await searchCatalogue({ widthMm: 205, aspectRatio: 55, rimInch: 16, season: "summer" });

    expect(captured.filters).toContainEqual(["catalogue_products.width_mm", 205]);
    expect(captured.filters).toContainEqual(["catalogue_products.aspect_ratio", 55]);
    expect(captured.filters).toContainEqual(["catalogue_products.rim_inch", 16]);
    expect(captured.filters).toContainEqual(["catalogue_products.season", "summer"]);
  });

  /** Inactive listings are history, not offers. */
  it("always restricts to active listings and active products", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");
    mockListings([]);

    await searchCatalogue({ widthMm: 205 });

    expect(captured.filters).toContainEqual(["active", true]);
    expect(captured.filters).toContainEqual(["catalogue_products.active", true]);
  });

  it("omits a filter that was not asked for", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");
    mockListings([]);

    await searchCatalogue({ widthMm: 205 });

    const columns = captured.filters.map(([column]) => column);
    expect(columns).not.toContain("catalogue_products.season");
    expect(columns).not.toContain("catalogue_products.rim_inch");
  });

  it("accepts only the seasons the catalogue actually holds", async () => {
    const { isSearchableSeason } = await import("@/lib/server/catalogue-search");

    expect(isSearchableSeason("summer")).toBe(true);
    expect(isSearchableSeason("winter")).toBe(true);
    expect(isSearchableSeason("all_season")).toBe(true);
    expect(isSearchableSeason("SUMMER")).toBe(false);
    expect(isSearchableSeason("estivo")).toBe(false);
    expect(isSearchableSeason(null)).toBe(false);
    expect(isSearchableSeason(undefined)).toBe(false);
  });
});

describe("search results carry cost internally and never to the customer", () => {
  it("prices a listing that has a supplier cost", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");
    const { DEFAULT_PRICING_SETTINGS } = await import("@/lib/pricing/settings");

    mockListings([
      listingRow({
        purchase_price: "61.5000",
        currency: "EUR",
        stock_raw: ">20",
        stock_exact: null,
        stock_minimum: 20,
        observed_at: "2026-09-08T14:46:30.554Z",
      }),
    ]);

    const result = await searchCatalogue(
      { widthMm: 205 },
      { ...DEFAULT_PRICING_SETTINGS, pfuVatBase: "inside_vat_base" }
    );

    const [internal] = result.internal;
    expect(internal.supplierCostCents).toBe(6_150);
    expect(internal.markupAmountCents).toBe(1_230);
    expect(internal.tyreSaleNetCents).toBe(7_380);
    expect(internal.supplierName).toBe("Inter-Sprint Banden BV");
    expect(internal.availability).toBe("in_stock");
  });

  /** numeric(12,4) arrives as a string; parsing it must not lose cents. */
  it("converts a numeric string price to exact cents", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");

    mockListings([
      listingRow({
        purchase_price: "0.0100",
        currency: "EUR",
        stock_raw: null,
        stock_exact: null,
        stock_minimum: null,
        observed_at: null,
      }),
    ]);

    const result = await searchCatalogue({ widthMm: 205 });
    expect(result.internal[0].supplierCostCents).toBe(1);
  });

  it("keeps supplier cost and identity out of the customer projection", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");

    mockListings([
      listingRow({
        purchase_price: "61.5000",
        currency: "EUR",
        stock_raw: ">20",
        stock_exact: null,
        stock_minimum: 20,
        observed_at: "2026-09-08T14:46:30.554Z",
      }),
    ]);

    const result = await searchCatalogue({ widthMm: 205 });
    const serialised = JSON.stringify(result.customer);

    expect(serialised).not.toContain("Inter-Sprint");
    expect(serialised).not.toContain("ISB-12851");
    expect(serialised).not.toContain("6150");
    expect(serialised).not.toContain("61.5");
    // The tyre itself is still there.
    expect(serialised).toContain("MICHELIN");
  });

  /**
   * The state the live catalogue is actually in today: 9,559 listings, every
   * one with a null purchase price.
   */
  it("reports no price for a listing with no commercial data", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");

    mockListings([listingRow(null)]);

    const result = await searchCatalogue({ widthMm: 205 });
    const [internal] = result.internal;

    expect(internal.resolution).toBe("cost_unavailable");
    expect(internal.supplierCostCents).toBeNull();
    expect(internal.tyreSaleNetCents).toBeNull();
    expect(internal.availability).toBe("unknown");
    // The operator still sees the listing, and why it is not offered.
    expect(internal.sellable).toBe(false);
    expect(internal.sellabilityReason).toBe("stock_unknown");
    expect(internal.tyre.brand).toBe("MICHELIN");

    // With no stock figure at all we will not offer it, so it does not reach
    // the customer projection.
    expect(result.customer).toHaveLength(0);
  });

  it("marks PFU to-confirm for every result while no tariff exists", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");

    mockListings([
      listingRow({
        purchase_price: "61.5000",
        currency: "EUR",
        stock_raw: null,
        stock_exact: null,
        stock_minimum: null,
        observed_at: null,
      }),
    ]);

    const result = await searchCatalogue({ widthMm: 205 });

    expect(result.internal[0].pfuStatus).toBe("TO_CONFIRM");
    expect(result.internal[0].pfuAmountCents).toBeNull();
    expect(result.internal[0].customerTotalCents).toBeNull();
    // This fixture states no stock, so it is not offered; PFU is asserted on
    // the internal view. Customer-side PFU is covered where stock permits.
    expect(result.internal[0].sellable).toBe(false);
    expect(result.customer).toHaveLength(0);
  });

  it("refuses a negative supplier price rather than pricing from it", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");

    mockListings([
      listingRow({
        purchase_price: "-5.0000",
        currency: "EUR",
        stock_raw: null,
        stock_exact: null,
        stock_minimum: null,
        observed_at: null,
      }),
    ]);

    const result = await searchCatalogue({ widthMm: 205 });
    expect(result.internal[0].resolution).toBe("cost_unavailable");
  });

  it("offers a listing whose stock clears the minimum", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");

    mockListings([
      listingRow({
        purchase_price: "61.5000",
        currency: "EUR",
        stock_raw: "6",
        stock_exact: 6,
        stock_minimum: 6,
        observed_at: "2026-09-08T14:46:30.554Z",
      }),
    ]);

    const result = await searchCatalogue({ widthMm: 205 });

    expect(result.internal[0].sellable).toBe(true);
    expect(result.customer).toHaveLength(1);
    expect(result.customer[0].tyre.brand).toBe("MICHELIN");
  });

  /**
   * The owner's <5 rule. The supplier genuinely holds 3; we decline to sell
   * from that pool, and the 3 survives untouched on the internal view.
   */
  it("suppresses a listing below the minimum without altering its stock", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");

    mockListings([
      listingRow({
        purchase_price: "61.5000",
        currency: "EUR",
        stock_raw: "3",
        stock_exact: 3,
        stock_minimum: 3,
        observed_at: "2026-09-08T14:46:30.554Z",
      }),
    ]);

    const result = await searchCatalogue({ widthMm: 205 });

    expect(result.customer).toHaveLength(0);
    expect(result.internal[0].sellable).toBe(false);
    expect(result.internal[0].sellabilityReason).toBe("below_minimum_offer_quantity");
    // The supplier's real figure is preserved, not rewritten to zero.
    expect(result.internal[0].supplierStockExact).toBe(3);
    expect(result.internal[0].supplierStockRaw).toBe("3");
    expect(result.internal[0].minimumOfferQuantity).toBe(5);
  });

  it("offers a banded listing on the strength of its floor", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");

    mockListings([
      listingRow({
        purchase_price: "61.5000",
        currency: "EUR",
        stock_raw: ">  20",
        stock_exact: null,
        stock_minimum: 20,
        observed_at: "2026-09-08T14:46:30.554Z",
      }),
    ]);

    const result = await searchCatalogue({ widthMm: 205 });

    expect(result.customer).toHaveLength(1);
    expect(result.internal[0].supplierStockExact).toBeNull();
    expect(result.internal[0].supplierStockMinimum).toBe(20);

    // The band reached the customer as an availability WORD, never as a
    // quantity. Checked by field rather than by substring: '20' also occurs
    // inside '205/55 R16', which is the tyre's width and perfectly public.
    const customer = result.customer[0] as unknown as Record<string, unknown>;
    expect(customer.availability).toBe("in_stock");
    for (const key of Object.keys(customer)) {
      expect(key.toLowerCase()).not.toContain("stock");
    }
    expect(Object.values(customer)).not.toContain(20);
  });

  it("degrades to an empty result when the catalogue tables are absent", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");

    mockListings(null, { code: "42P01", message: 'relation "supplier_product_listings" does not exist' });

    const result = await searchCatalogue({ widthMm: 205 });

    expect(result.schemaAvailable).toBe(false);
    expect(result.internal).toEqual([]);
    expect(result.customer).toEqual([]);
  });
});

describe("lane attribution is no longer hardcoded", () => {
  /**
   * Until M11B the selling policy was called with a literal
   * `laneCode: "intersprint"` for every listing. That was true while
   * Inter-Sprint was the only supplier with data and would have silently
   * applied its offer policy to every other lane the moment a second one had
   * any. The lane now comes from the adapter that wrote the listing.
   */
  it("derives the lane from the listing's own import adapter", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");
    const { DEFAULT_SELLING_POLICY } = await import("@/lib/commerce/selling-policy");

    const withRun = (adapter: string | null) => ({
      ...listingRow({
        purchase_price: "61.5000", currency: "EUR", stock_raw: "6",
        stock_exact: 6, stock_minimum: 6, observed_at: "2026-09-08T14:46:30.554Z",
      }),
      catalogue_import_runs: adapter ? { adapter } : null,
    });

    // A per-supplier floor that only Inter-Sprint should feel.
    const policy = { ...DEFAULT_SELLING_POLICY, bySupplier: { intersprint: 10 } };

    mockListings([withRun("intersprint-feed")]);
    const isb = await searchCatalogue({ widthMm: 205 }, undefined, policy);
    expect(isb.internal[0].minimumOfferQuantity).toBe(10);
    expect(isb.internal[0].sellable).toBe(false);

    // A different lane keeps the default floor of 5 and stays sellable.
    mockListings([withRun("deldo-feed")]);
    const deldo = await searchCatalogue({ widthMm: 205 }, undefined, policy);
    expect(deldo.internal[0].minimumOfferQuantity).toBe(5);
    expect(deldo.internal[0].sellable).toBe(true);
  });

  it("falls back to the default policy for an unattributed listing", async () => {
    const { searchCatalogue } = await import("@/lib/server/catalogue-search");
    mockListings([
      { ...listingRow({
          purchase_price: "61.5000", currency: "EUR", stock_raw: "6",
          stock_exact: 6, stock_minimum: 6, observed_at: "2026-09-08T14:46:30.554Z",
        }),
        catalogue_import_runs: null },
    ]);

    const result = await searchCatalogue({ widthMm: 205 });
    expect(result.internal[0].minimumOfferQuantity).toBe(5);
  });
});

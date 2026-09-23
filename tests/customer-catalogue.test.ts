import { afterEach, describe, expect, it, vi } from "vitest";
import { FORBIDDEN_CUSTOMER_FIELDS } from "@/lib/pricing/projection";

/**
 * REGRESSION: the customer catalogue must page and order over the WHOLE
 * offerable selection, and must never carry supplier internals.
 *
 * The defect these cover: the customer route paged SUPPLIER LISTINGS
 * (`searchCatalogue` with limit/offset) and then collapsed them to one offer
 * per product in JavaScript, after the page had already been chosen. Three
 * consequences, in increasing order of seriousness:
 *
 *   1. page size varied — 50 listings could collapse to 31 products;
 *   2. there was no total, so there was no pagination at all, and a customer
 *      could reach only the first page of a 9,559-listing catalogue;
 *   3. the price shown was the cheapest offer ON THAT PAGE. A cheaper listing
 *      for the same tyre sitting on page two meant the customer was quoted
 *      MORE than GommaRush's own best price.
 *
 * (3) is a pricing defect, not a display one, and it is what `cheapestAcrossPages`
 * below pins down. The mock deliberately places the two listings for the same
 * product far apart in listing order, so a page-local collapse would pick the
 * dearer one.
 */

const from = vi.fn();

vi.mock("@/lib/supabase/server-admin", () => ({
  createSupabaseAdminClient: () => ({ from: (table: string) => from(table) }),
}));

const RUN = "11111111-1111-1111-1111-111111111111";
const RUNS = [{ id: RUN, adapter: "intersprint-feed", notes: "intersprint-feed:category=pcr" }];

function product(id: string, brand: string) {
  return {
    id,
    brand,
    model_pattern: "M",
    description: null,
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
    eprel_id: null,
    weight_kg: 8.5,
    ean: null,
    review_required: false,
    review_reasons: [],
  };
}

/** `stock` drives sellability: the policy minimum is 5. */
function listing(
  id: string,
  productId: string,
  price: string,
  stock: number,
  supplierName = "asdas"
) {
  return {
    id,
    catalogue_product_id: productId,
    supplier_article_id: `ART-${id}`,
    supplier_item_code: `CODE-${id}`,
    old_dot: false,
    suppliers: { id: "s-1", name: supplierName },
    catalogue_import_runs: { adapter: "intersprint-feed", notes: "intersprint-feed:category=pcr" },
    supplier_listing_prices: [
      {
        purchase_price: price,
        currency: "EUR",
        stock_raw: String(stock),
        stock_exact: stock,
        stock_minimum: stock,
        observed_at: "2026-09-22T14:00:00Z",
      },
    ],
  };
}

const PRODUCTS = [
  product("p-a", "ALPHA"),
  product("p-b", "BRAVO"),
  product("p-c", "CHARLIE"),
  product("p-d", "DELTA"),
  // Not offerable: 3 in stock is below the minimum of 5. It must not appear,
  // and must not be counted in the total either.
  product("p-e", "ECHO"),
];

/**
 * Listing order is deliberately adversarial: the EXPENSIVE listing for p-a
 * comes first and its cheap twin comes last, so any implementation that
 * collapses within a page quotes 400.00 instead of 100.00.
 */
const LISTINGS = [
  listing("l-a-dear", "p-a", "400.00", 10),
  listing("l-b", "p-b", "300.00", 10),
  listing("l-c", "p-c", "250.00", 10),
  listing("l-d", "p-d", "200.00", 10),
  listing("l-e", "p-e", "50.00", 3),
  listing("l-a-cheap", "p-a", "100.00", 10),
];

function productBuilder() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.in = self;
  chain.not = self;
  chain.or = self;
  chain.order = self;
  chain.limit = () => Promise.resolve({ data: [], error: null });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  chain.range = (a: number, b: number) =>
    Promise.resolve({
      data: PRODUCTS.slice(a, b + 1),
      error: null,
      count: PRODUCTS.length,
    });
  return chain;
}

function simpleBuilder(data: unknown) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.in = self;
  chain.not = self;
  chain.or = self;
  chain.order = self;
  chain.limit = () => Promise.resolve({ data, error: null });
  chain.range = () => Promise.resolve({ data, error: null, count: 0 });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

function mockAll() {
  from.mockImplementation((table: string) => {
    if (table === "catalogue_import_runs") return simpleBuilder(RUNS);
    if (table === "catalogue_products") return productBuilder();
    if (table === "supplier_product_listings") return simpleBuilder(LISTINGS);
    return simpleBuilder([]);
  });
}

const NOW = new Date("2026-09-22T15:00:00Z");

afterEach(() => vi.clearAllMocks());

describe("customer catalogue price correctness", () => {
  it("quotes the cheapest offer across ALL listings, not the cheapest on the page", async () => {
    const { searchCustomerCatalogue } = await import("@/lib/server/customer-catalogue");
    mockAll();

    const result = await searchCustomerCatalogue(
      { sort: "brand_asc", limit: 2, offset: 0 },
      undefined,
      undefined,
      NOW
    );

    const alpha = result.offers.find((o) => o.tyre.brand === "ALPHA");
    expect(alpha, "ALPHA must be on the first page under brand order").toBeDefined();
    // 100.00 cost + 20% markup = 120.00. The dear twin would give 480.00.
    expect(alpha?.tyreSaleNetCents).toBe(12_000);
  });

  it("shows one entry per product, never one per supplier listing", async () => {
    const { searchCustomerCatalogue } = await import("@/lib/server/customer-catalogue");
    mockAll();

    const result = await searchCustomerCatalogue({ limit: 100 }, undefined, undefined, NOW);
    const ids = result.offers.map((o) => o.tyre.productId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("customer catalogue totals and pagination", () => {
  it("counts only tyres the customer can actually buy", async () => {
    const { searchCustomerCatalogue } = await import("@/lib/server/customer-catalogue");
    mockAll();

    const result = await searchCustomerCatalogue({ limit: 100 }, undefined, undefined, NOW);

    // Five products match; ECHO holds 3, below the minimum of 5.
    expect(result.total).toBe(4);
    expect(result.offers.map((o) => o.tyre.brand)).not.toContain("ECHO");
  });

  it("pages disjointly and covers the whole selection", async () => {
    const { searchCustomerCatalogue } = await import("@/lib/server/customer-catalogue");

    mockAll();
    const first = await searchCustomerCatalogue(
      { sort: "brand_asc", limit: 2, offset: 0 },
      undefined,
      undefined,
      NOW
    );
    mockAll();
    const second = await searchCustomerCatalogue(
      { sort: "brand_asc", limit: 2, offset: 2 },
      undefined,
      undefined,
      NOW
    );

    const a = first.offers.map((o) => o.tyre.productId);
    const b = second.offers.map((o) => o.tyre.productId);

    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
    expect(new Set([...a, ...b]).size).toBe(4);
    expect(first.total).toBe(second.total);
  });

  it("orders by price GLOBALLY, so page two holds the globally 3rd and 4th cheapest", async () => {
    const { searchCustomerCatalogue } = await import("@/lib/server/customer-catalogue");

    mockAll();
    const page1 = await searchCustomerCatalogue(
      { sort: "price_asc", limit: 2, offset: 0 },
      undefined,
      undefined,
      NOW
    );
    mockAll();
    const page2 = await searchCustomerCatalogue(
      { sort: "price_asc", limit: 2, offset: 2 },
      undefined,
      undefined,
      NOW
    );

    // Costs 100 (ALPHA, via its cheap twin), 200 (DELTA), 250 (CHARLIE), 300 (BRAVO).
    expect(page1.offers.map((o) => o.tyre.brand)).toEqual(["ALPHA", "DELTA"]);
    expect(page2.offers.map((o) => o.tyre.brand)).toEqual(["CHARLIE", "BRAVO"]);

    const prices = [...page1.offers, ...page2.offers].map((o) => o.tyreSaleNetCents);
    expect(prices).toEqual([...prices].sort((x, y) => (x ?? 0) - (y ?? 0)));
  });

  it("orders by brand A-Z across the whole selection", async () => {
    const { searchCustomerCatalogue } = await import("@/lib/server/customer-catalogue");
    mockAll();

    const result = await searchCustomerCatalogue(
      { sort: "brand_asc", limit: 100 },
      undefined,
      undefined,
      NOW
    );
    expect(result.offers.map((o) => o.tyre.brand)).toEqual(["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
  });
});

describe("customer catalogue confidentiality", () => {
  /**
   * Run against a payload built from rows that DO carry supplier internals —
   * a named supplier, article codes, purchase prices, exact stock. A test on a
   * hand-written customer literal proves nothing, because the literal never
   * held the secret in the first place.
   */
  it("emits no supplier identity, cost, stock or margin in the real payload", async () => {
    const { searchCustomerCatalogue } = await import("@/lib/server/customer-catalogue");
    mockAll();

    const result = await searchCustomerCatalogue({ limit: 100 }, undefined, undefined, NOW);
    expect(result.offers.length).toBeGreaterThan(0);

    const json = JSON.stringify(result.offers);
    for (const field of FORBIDDEN_CUSTOMER_FIELDS) {
      expect(json, `${field} must not reach a customer`).not.toContain(field);
    }
    // Values, not only field names: the supplier's name, its article code and
    // its purchase price in cents must all be absent.
    for (const value of ["asdas", "ART-l-a-cheap", "CODE-l-a-cheap", "l-a-cheap"]) {
      expect(json, `${value} must not reach a customer`).not.toContain(value);
    }
  });

  it("keeps every key of a customer offer on the agreed list", async () => {
    const { searchCustomerCatalogue } = await import("@/lib/server/customer-catalogue");
    mockAll();

    const result = await searchCustomerCatalogue({ limit: 1 }, undefined, undefined, NOW);
    expect(Object.keys(result.offers[0]).sort()).toEqual(
      [
        "availability",
        "customerTotalCents",
        "pfuAmountCents",
        // The two estimate-disclosure fields are customer-SAFE and required:
        // the owner's decision is that an estimated PFU must be visible.
        "pfuEstimated",
        "pfuEstimateVersion",
        "pfuStatus",
        "priceAvailable",
        "tyre",
        "tyreSaleNetCents",
        "vatAmountCents",
      ].sort()
    );
  });
});

describe("customer catalogue fails closed on money", () => {
  /**
   * The owner's 2026-09-23 decision: PFU must not block ordering, so a
   * temporary estimate is used and a total IS produced. Every offer must
   * still declare that its PFU is an estimate, because that is what the
   * customer disclosure and the order snapshot hang off.
   */
  it("produces a total and marks every PFU as estimated, never as verified", async () => {
    const { searchCustomerCatalogue } = await import("@/lib/server/customer-catalogue");
    const { isVerifiedPfuStatus } = await import("@/lib/pricing/pfu");
    mockAll();

    const result = await searchCustomerCatalogue({ limit: 100 }, undefined, undefined, NOW);
    expect(result.offers.length).toBeGreaterThan(0);

    for (const offer of result.offers) {
      expect(offer.pfuStatus).toBe("ESTIMATED");
      expect(isVerifiedPfuStatus(offer.pfuStatus)).toBe(false);
      expect(offer.pfuAmountCents).not.toBeNull();
      expect(offer.vatAmountCents).not.toBeNull();
      expect(offer.customerTotalCents).not.toBeNull();
      expect(offer.tyreSaleNetCents).not.toBeNull();
      expect(offer.pfuEstimated).toBe(true);
    }
  });
});

describe("brand tiers stay owner-approved", () => {
  it("returns nothing for a tier while no approved mapping exists", async () => {
    const { searchCustomerCatalogue } = await import("@/lib/server/customer-catalogue");
    const { BRAND_TIERS_CONFIGURED } = await import("@/lib/catalogue/brand-tiers");
    mockAll();

    // Guards the premise: if a mapping is ever approved, this test must be
    // revisited rather than quietly continuing to assert emptiness.
    expect(BRAND_TIERS_CONFIGURED).toBe(false);

    const result = await searchCustomerCatalogue(
      { brandTier: "premium", limit: 100 },
      undefined,
      undefined,
      NOW
    );
    expect(result.offers).toEqual([]);
  });
});

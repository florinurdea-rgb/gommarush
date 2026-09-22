import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Catalogue workspace read.
 *
 * The database is mocked; the lane registry, state derivation, pricing engine
 * and selling policy are all real. What these cover is the behaviour an
 * operator depends on: that a row is one canonical tyre, that suppliers are
 * never merged by resemblance, that a band stays a band, and that pagination
 * is the database's job rather than JavaScript's.
 */

const from = vi.fn();
const captured: {
  table: string[];
  filters: [string, unknown][];
  orders: [string, unknown][];
  ranges: [number, number][];
  selects: string[];
} = { table: [], filters: [], orders: [], ranges: [], selects: [] };

vi.mock("@/lib/supabase/server-admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.table.push(table);
      return from(table);
    },
  }),
}));

/** Minimal PostgREST-shaped builder that records what was asked for. */
function builder(result: { data: unknown; error?: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = (cols: string) => {
    captured.selects.push(cols);
    return chain;
  };
  chain.eq = (column: string, value: unknown) => {
    captured.filters.push([column, value]);
    return chain;
  };
  chain.in = (column: string, value: unknown) => {
    captured.filters.push([column, value]);
    return chain;
  };
  chain.not = self;
  chain.or = (filter: string) => {
    captured.filters.push(["or", filter]);
    return chain;
  };
  chain.order = (column: string, options: unknown) => {
    captured.orders.push([column, options]);
    return chain;
  };
  chain.limit = () => Promise.resolve({ data: result.data, error: result.error ?? null });
  // PostgREST's builder is thenable: a query can be awaited without a
  // terminal call. The conflicts read ends on .eq(), so the mock has to be
  // awaitable too or it resolves to the builder itself.
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: result.data, error: result.error ?? null }).then(resolve);
  chain.range = (a: number, b: number) => {
    captured.ranges.push([a, b]);
    return Promise.resolve({
      data: result.data,
      error: result.error ?? null,
      count: result.count ?? (Array.isArray(result.data) ? result.data.length : 0),
    });
  };
  return chain;
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1", brand: "MICHELIN", model_pattern: "PRIMACY 4", description: "205/55 R16",
    size_display: "205/55 R16", width_mm: 205, aspect_ratio: 55, rim_inch: 16,
    load_index: "91", speed_rating: "V", load_speed_raw: "91V", season: "summer",
    product_class: "passenger_car", xl: false, run_flat: false, old_dot: false,
    eprel_id: "123", weight_kg: 8.5, ean: "4717622044652",
    review_required: false, review_reasons: [], ...overrides,
  };
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: "l-1", catalogue_product_id: "p-1", supplier_article_id: "34197",
    supplier_item_code: "205 55VR 16", old_dot: false,
    suppliers: { id: "s-1", name: "asdas" },
    catalogue_import_runs: { adapter: "intersprint-feed", notes: "intersprint-feed:category=pcr" },
    supplier_listing_prices: [{
      purchase_price: "99.2000", currency: "EUR", stock_raw: "6",
      stock_exact: 6, stock_minimum: 6, observed_at: "2026-09-22T14:29:00Z",
    }],
    ...overrides,
  };
}

/** Wires the three reads browseCatalogue performs, in order. */
function mockReads(opts: {
  products?: unknown[];
  total?: number;
  listings?: unknown[];
  conflicts?: unknown[];
}) {
  captured.table = []; captured.filters = []; captured.orders = [];
  captured.ranges = []; captured.selects = [];
  from.mockImplementation((table: string) => {
    if (table === "catalogue_products") {
      return builder({ data: opts.products ?? [], count: opts.total ?? (opts.products ?? []).length });
    }
    if (table === "supplier_product_listings") return builder({ data: opts.listings ?? [] });
    if (table === "catalogue_conflicts") return builder({ data: opts.conflicts ?? [] });
    return builder({ data: [] });
  });
}

const NOW = new Date("2026-09-22T15:00:00Z");

afterEach(() => vi.clearAllMocks());

describe("canonical grouping", () => {
  it("makes one row per catalogue product, with offers grouped under it", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({
      products: [product()],
      listings: [listing(), listing({ id: "l-2", supplier_article_id: "99999" })],
    });

    const result = await browseCatalogue({}, undefined, undefined, NOW);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].product.productId).toBe("p-1");
    expect(result.rows[0].offers).toHaveLength(2);
  });

  /**
   * Two tyres that merely look alike are two tyres. The catalogue's unique
   * index on validated EAN is what makes suppliers converge; resemblance is
   * never allowed to.
   */
  it("keeps look-alike products on separate rows", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({
      products: [product(), product({ id: "p-2", ean: "4717622057126" })],
      listings: [listing(), listing({ id: "l-2", catalogue_product_id: "p-2" })],
    });

    const result = await browseCatalogue({}, undefined, undefined, NOW);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].offers).toHaveLength(1);
    expect(result.rows[1].offers).toHaveLength(1);
  });

  it("orders offers cheapest first, with unpriced ones last", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({
      products: [product()],
      listings: [
        listing({ id: "l-a", supplier_listing_prices: [{ purchase_price: "120.00", stock_raw: "6", stock_exact: 6, stock_minimum: 6, currency: "EUR", observed_at: "2026-09-22T14:00:00Z" }] }),
        listing({ id: "l-b", supplier_listing_prices: [] }),
        listing({ id: "l-c", supplier_listing_prices: [{ purchase_price: "80.00", stock_raw: "6", stock_exact: 6, stock_minimum: 6, currency: "EUR", observed_at: "2026-09-22T14:00:00Z" }] }),
      ],
    });

    const result = await browseCatalogue({}, undefined, undefined, NOW);
    expect(result.rows[0].offers.map((o) => o.listingId)).toEqual(["l-c", "l-a", "l-b"]);
  });
});

describe("pagination is the database's job", () => {
  /**
   * The behaviour this replaces: the old search ordered a page by listing id
   * and then sorted that page by brand in JavaScript, which produces a locally
   * sorted page inside a globally unsorted sequence — page 2 could hold brands
   * belonging on page 1.
   */
  it("orders on indexed root columns in SQL, not after the fetch", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [product()] });

    await browseCatalogue({}, undefined, undefined, NOW);

    const columns = captured.orders.map(([c]) => c);
    expect(columns).toContain("brand");
    expect(columns).toContain("model_pattern");
    // Tie-broken by id, so a page boundary cannot repeat or skip a row.
    expect(columns).toContain("id");
  });

  it("asks the database for the exact page range", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [product()], total: 500 });

    const result = await browseCatalogue({ limit: 25, offset: 100 }, undefined, undefined, NOW);

    expect(captured.ranges).toContainEqual([100, 124]);
    expect(result.total).toBe(500);
    expect(result.limit).toBe(25);
    expect(result.offset).toBe(100);
  });

  it("reports a total independent of the page size, for correct controls", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [product()], total: 13183 });

    const result = await browseCatalogue({ limit: 50 }, undefined, undefined, NOW);
    expect(result.total).toBe(13183);
    expect(result.rows).toHaveLength(1);
  });

  it("clamps an absurd page size", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [] });
    const result = await browseCatalogue({ limit: 100000 }, undefined, undefined, NOW);
    expect(result.limit).toBeLessThanOrEqual(100);
  });
});

describe("filters", () => {
  it("filters the size tuple and season in the database", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [] });

    await browseCatalogue(
      { widthMm: 205, aspectRatio: 55, rimInch: 16, season: "summer", brand: "MICHELIN" },
      undefined, undefined, NOW
    );

    expect(captured.filters).toContainEqual(["width_mm", 205]);
    expect(captured.filters).toContainEqual(["aspect_ratio", 55]);
    expect(captured.filters).toContainEqual(["rim_inch", 16]);
    expect(captured.filters).toContainEqual(["season", "summer"]);
    expect(captured.filters).toContainEqual(["brand", "MICHELIN"]);
  });

  it("restricts to active products and active listings", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [product()], listings: [listing()] });
    await browseCatalogue({ lane: "intersprint" }, undefined, undefined, NOW);

    expect(captured.filters).toContainEqual(["active", true]);
    expect(captured.filters).toContainEqual(["supplier_product_listings.active", true]);
  });

  it("surfaces only flagged products under needs-review", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [] });
    await browseCatalogue({ needsReviewOnly: true }, undefined, undefined, NOW);
    expect(captured.filters).toContainEqual(["review_required", true]);
  });

  /** Exact on identifiers, prefix on the pattern — never fuzzy. */
  it("searches EAN exactly and model by prefix", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [] });
    await browseCatalogue({ search: "4717622044652" }, undefined, undefined, NOW);

    const or = captured.filters.find(([c]) => c === "or")?.[1] as string;
    expect(or).toContain("ean.eq.4717622044652");
    expect(or).toContain("model_pattern.ilike.4717622044652%");
  });

  it("shows only the chosen lane's offers", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({
      products: [product()],
      listings: [
        listing(),
        listing({ id: "l-deldo", catalogue_import_runs: { adapter: "deldo-feed", notes: null } }),
      ],
    });

    const result = await browseCatalogue({ lane: "intersprint" }, undefined, undefined, NOW);
    expect(result.rows[0].offers).toHaveLength(1);
    expect(result.rows[0].offers[0].laneCode).toBe("intersprint");
  });

  it("filters offers by vehicle class", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({
      products: [product({ product_class: null })],
      listings: [
        listing(),
        listing({ id: "l-truck", catalogue_import_runs: { adapter: "intersprint-feed", notes: "intersprint-feed:category=truck" } }),
      ],
    });

    const carVan = await browseCatalogue({ vehicle: "car_van" }, undefined, undefined, NOW);
    expect(carVan.rows[0].offers.map((o) => o.listingId)).toEqual(["l-1"]);

    mockReads({
      products: [product({ product_class: null })],
      listings: [
        listing(),
        listing({ id: "l-truck", catalogue_import_runs: { adapter: "intersprint-feed", notes: "intersprint-feed:category=truck" } }),
      ],
    });
    const truck = await browseCatalogue({ vehicle: "truck" }, undefined, undefined, NOW);
    expect(truck.rows[0].offers.map((o) => o.listingId)).toEqual(["l-truck"]);
  });
});

describe("commercial data on an offer", () => {
  it("carries the real cost, article and freshness", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [product()], listings: [listing()] });

    const offer = (await browseCatalogue({}, undefined, undefined, NOW)).rows[0].offers[0];
    expect(offer.purchasePriceCents).toBe(9_920);
    expect(offer.supplierArticleId).toBe("34197");
    expect(offer.laneCode).toBe("intersprint");
    expect(offer.ageMs).toBe(31 * 60 * 1000);
    expect(offer.state).toBe("CURRENT");
  });

  it("keeps an exact stock exact", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [product()], listings: [listing()] });
    const offer = (await browseCatalogue({}, undefined, undefined, NOW)).rows[0].offers[0];

    expect(offer.stockExact).toBe(6);
    expect(offer.stockRaw).toBe("6");
    expect(offer.sellable).toBe(true);
  });

  /** A band must never become a number anywhere in the stack. */
  it("keeps a banded stock banded", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({
      products: [product()],
      listings: [listing({ supplier_listing_prices: [{
        purchase_price: "66.08", currency: "EUR", stock_raw: ">  20",
        stock_exact: null, stock_minimum: 20, observed_at: "2026-09-22T14:29:00Z",
      }] })],
    });

    const offer = (await browseCatalogue({}, undefined, undefined, NOW)).rows[0].offers[0];
    expect(offer.stockExact).toBeNull();
    expect(offer.stockMinimum).toBe(20);
    expect(offer.stockRaw).toBe(">  20");
    expect(offer.sellable).toBe(true);
  });

  it("suppresses an offer below the selling minimum without altering its stock", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({
      products: [product()],
      listings: [listing({ supplier_listing_prices: [{
        purchase_price: "99.20", currency: "EUR", stock_raw: "3",
        stock_exact: 3, stock_minimum: 3, observed_at: "2026-09-22T14:29:00Z",
      }] })],
    });

    const offer = (await browseCatalogue({}, undefined, undefined, NOW)).rows[0].offers[0];
    expect(offer.sellable).toBe(false);
    expect(offer.sellabilityReason).toBe("below_minimum_offer_quantity");
    expect(offer.stockExact).toBe(3);
  });

  it("asks for only the latest observation, never the history", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [product()], listings: [listing()] });
    await browseCatalogue({}, undefined, undefined, NOW);

    const nested = captured.orders.find(
      ([c, o]) => c === "observed_at" && (o as { referencedTable?: string })?.referencedTable === "supplier_listing_prices"
    );
    expect(nested).toBeDefined();
    expect((nested?.[1] as { ascending: boolean }).ascending).toBe(false);
  });

  /** PFU is unresolved, so no customer-payable total may be produced. */
  it("prices the net but withholds the customer total", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [product()], listings: [listing()] });

    const offer = (await browseCatalogue({}, undefined, undefined, NOW)).rows[0].offers[0];
    expect(offer.pricing.tyreSaleNetCents).toBe(11_904);
    expect(offer.pricing.pfuStatus).toBe("TO_CONFIRM");
    expect(offer.pricing.customerTotalCents).toBeNull();
  });
});

describe("states an operator must be able to see", () => {
  it("shows a legacy listing with no current price, rather than hiding it", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({
      products: [product()],
      listings: [listing({ supplier_listing_prices: [{
        purchase_price: null, currency: "EUR", stock_raw: null,
        stock_exact: null, stock_minimum: null, observed_at: "2026-09-08T14:00:00Z",
      }] })],
    });

    const row = (await browseCatalogue({}, undefined, undefined, NOW)).rows[0];
    expect(row.state).toBe("NO_CURRENT_PRICE");
    expect(row.offers[0].purchasePriceCents).toBeNull();
    // Present and visible — it is not deactivated, because D14 is open.
    expect(row.offers).toHaveLength(1);
  });

  it("marks an incomplete product as needing review while still showing it", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({
      products: [product({ season: null, product_class: null, review_required: true,
        review_reasons: ["CLASS_OR_SEASON_UNRESOLVED"] })],
      listings: [listing({ catalogue_import_runs: { adapter: "intersprint-feed", notes: "intersprint-feed:category=pcr" } })],
    });

    const row = (await browseCatalogue({}, undefined, undefined, NOW)).rows[0];
    expect(row.state).toBe("NEEDS_REVIEW");
    expect(row.product.season).toBeNull();
    expect(row.product.reviewReasons).toContain("CLASS_OR_SEASON_UNRESOLVED");
    // Still classified, by provenance rather than by the missing class.
    expect(row.vehicle).toBe("car_van");
  });

  it("flags a product carrying an open conflict", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({
      products: [product()],
      listings: [listing()],
      conflicts: [{ catalogue_product_id: "p-1" }],
    });

    const row = (await browseCatalogue({}, undefined, undefined, NOW)).rows[0];
    expect(row.hasOpenConflict).toBe(true);
    expect(row.state).toBe("CONFLICT");
  });
});

describe("lanes with no data", () => {
  /** Deldo and Carlini are real lanes with nothing imported. Never fabricate. */
  it("returns an empty result for a lane that has no listings", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [], total: 0 });

    const deldo = await browseCatalogue({ lane: "deldo" }, undefined, undefined, NOW);
    expect(deldo.rows).toEqual([]);
    expect(deldo.total).toBe(0);
  });

  it("shows no offers for a lane when a product has none", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [product()], listings: [listing()] });

    const carlini = await browseCatalogue({ lane: "carlini" }, undefined, undefined, NOW);
    expect(carlini.rows[0].offers).toEqual([]);
  });

  it("degrades to an empty result when the catalogue tables are absent", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    from.mockImplementation(() =>
      builder({ data: null, error: { code: "42P01", message: "does not exist" } })
    );

    const result = await browseCatalogue({}, undefined, undefined, NOW);
    expect(result.schemaAvailable).toBe(false);
    expect(result.rows).toEqual([]);
  });
});

describe("sorting", () => {
  it("defaults to brand order and does not re-sort the page", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [product()], listings: [listing()] });

    const result = await browseCatalogue({}, undefined, undefined, NOW);
    expect(result.sort).toBe("brand_asc");
    expect(result.sortRefused).toBeNull();
    // Database order was already correct; re-sorting would reintroduce the
    // local-ordering bug this module exists to remove.
    expect(captured.orders.map(([c]) => c)).toContain("brand");
  });

  it("orders by cheapest offer across the whole filtered set", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({
      products: [
        product({ id: "p-dear", brand: "AAA" }),
        product({ id: "p-cheap", brand: "ZZZ" }),
      ],
      total: 2,
      listings: [
        listing({ id: "l-dear", catalogue_product_id: "p-dear",
          supplier_listing_prices: [{ purchase_price: "200.00", currency: "EUR", stock_raw: "6", stock_exact: 6, stock_minimum: 6, observed_at: "2026-09-22T14:00:00Z" }] }),
        listing({ id: "l-cheap", catalogue_product_id: "p-cheap",
          supplier_listing_prices: [{ purchase_price: "50.00", currency: "EUR", stock_raw: "6", stock_exact: 6, stock_minimum: 6, observed_at: "2026-09-22T14:00:00Z" }] }),
      ],
    });

    const result = await browseCatalogue({ sort: "price_asc" }, undefined, undefined, NOW);

    expect(result.sort).toBe("price_asc");
    // Cheapest first, even though its brand sorts last alphabetically.
    expect(result.rows.map((r) => r.product.productId)).toEqual(["p-cheap", "p-dear"]);
  });

  /**
   * The honest failure. An offer-derived sort over the entire catalogue cannot
   * be executed correctly without materialising it, so beyond the cap the
   * request is refused and the default order is used — and the caller is told.
   * A page claiming to be cheapest-first while not being so is worse.
   */
  it("refuses an offer-derived sort over a selection that is too large", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    const { OFFER_SORT_MAX_PRODUCTS } = await import("@/lib/catalogue/catalogue-sort");
    mockReads({ products: [product()], total: OFFER_SORT_MAX_PRODUCTS + 1, listings: [listing()] });

    const result = await browseCatalogue({ sort: "price_asc" }, undefined, undefined, NOW);

    expect(result.sortRefused).toEqual({
      reason: "selection_too_large",
      matched: OFFER_SORT_MAX_PRODUCTS + 1,
      maximum: OFFER_SORT_MAX_PRODUCTS,
    });
    // Falls back to the database-native order rather than a wrong one.
    expect(result.sort).toBe("brand_asc");
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("allows an offer-derived sort right up to the cap", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    const { OFFER_SORT_MAX_PRODUCTS } = await import("@/lib/catalogue/catalogue-sort");
    mockReads({ products: [product()], total: OFFER_SORT_MAX_PRODUCTS, listings: [listing()] });

    const result = await browseCatalogue({ sort: "freshest" }, undefined, undefined, NOW);
    expect(result.sortRefused).toBeNull();
    expect(result.sort).toBe("freshest");
  });

  it("slices the materialised set, so a page is a slice of a global order", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    const priceFor = (cents: string) => [{
      purchase_price: cents, currency: "EUR", stock_raw: "6",
      stock_exact: 6, stock_minimum: 6, observed_at: "2026-09-22T14:00:00Z",
    }];
    mockReads({
      products: [
        product({ id: "p1", brand: "A" }), product({ id: "p2", brand: "B" }),
        product({ id: "p3", brand: "C" }),
      ],
      total: 3,
      listings: [
        listing({ id: "l1", catalogue_product_id: "p1", supplier_listing_prices: priceFor("300.00") }),
        listing({ id: "l2", catalogue_product_id: "p2", supplier_listing_prices: priceFor("100.00") }),
        listing({ id: "l3", catalogue_product_id: "p3", supplier_listing_prices: priceFor("200.00") }),
      ],
    });

    // Page 2 of size 1 must be the SECOND cheapest globally, not the second
    // row of an arbitrary page.
    const page2 = await browseCatalogue(
      { sort: "price_asc", limit: 1, offset: 1 }, undefined, undefined, NOW
    );
    expect(page2.rows.map((r) => r.product.productId)).toEqual(["p3"]);
  });
});

describe("brand tiers", () => {
  /**
   * No approved mapping exists, so a tier must match nothing. Silently
   * ignoring the filter would make premium and value return identical
   * results, which reads as a working feature and is not one.
   */
  it("matches nothing while no brand is classified", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [], total: 0 });

    const result = await browseCatalogue({ brandTier: "premium" }, undefined, undefined, NOW);

    const brandFilter = captured.filters.filter(([column]) => column === "brand");
    expect(brandFilter.length).toBeGreaterThan(0);
    expect(result.rows).toEqual([]);
  });

  it("does not constrain brand when no tier is requested", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockReads({ products: [product()], listings: [listing()] });

    await browseCatalogue({}, undefined, undefined, NOW);
    expect(captured.filters.filter(([c]) => c === "brand")).toEqual([]);
  });
});

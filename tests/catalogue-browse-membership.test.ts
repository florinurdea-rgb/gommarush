import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * REGRESSION: lane and vehicle must decide PRODUCT MEMBERSHIP in the
 * database, not merely which offers are drawn under an already-chosen page.
 *
 * The defect these cover: `fetchProductPage` created an `!inner` embed on
 * supplier_product_listings but constrained it only with `active = true`. No
 * adapter and no feed-category predicate ever reached the join, so `count`
 * described "products with any active listing" whatever tab was selected, and
 * the page was a slice of that wrong set. Offers were then filtered after
 * pagination, which made the screen look plausible while the totals and the
 * page boundaries were wrong.
 *
 * The fix resolves import runs to ids first and filters the joined relation on
 * `last_import_run_id`, which IS a column, so PostgREST turns it into a join
 * predicate. These tests assert the predicate is present and that membership
 * and totals actually move with it.
 */

const from = vi.fn();

interface Capture {
  filters: [string, unknown][];
  embeds: string[];
  ranges: [number, number][];
}
const captured: Capture = { filters: [], embeds: [], ranges: [] };

vi.mock("@/lib/supabase/server-admin", () => ({
  createSupabaseAdminClient: () => ({ from: (table: string) => from(table) }),
}));

const PCR_RUN = "11111111-1111-1111-1111-111111111111";
const TRUCK_RUN = "22222222-2222-2222-2222-222222222222";
const LEGACY_RUN = "33333333-3333-3333-3333-333333333333";

const RUNS = [
  { id: PCR_RUN, adapter: "intersprint-feed", notes: "intersprint-feed:category=pcr" },
  { id: TRUCK_RUN, adapter: "intersprint-feed", notes: "intersprint-feed:category=truck" },
  { id: LEGACY_RUN, adapter: "isb", notes: null },
];

/**
 * A builder that MODELS membership: it records the run-id predicate and
 * returns only the products whose listing satisfies it, with a matching
 * count. Without this the tests would pass whether or not the predicate was
 * ever applied — which is how the original defect survived review.
 */
function productBuilder(universe: { id: string; runId: string; product: Record<string, unknown> }[]) {
  let runFilter: string[] | null = null;
  let classFilter: { classes: string[]; allowNull: boolean } | null = null;
  const chain: Record<string, unknown> = {};
  const self = () => chain;

  chain.select = (cols: string) => {
    captured.embeds.push(cols);
    return chain;
  };
  chain.eq = (column: string, value: unknown) => {
    captured.filters.push([column, value]);
    return chain;
  };
  chain.in = (column: string, value: unknown) => {
    captured.filters.push([column, value]);
    if (column === "supplier_product_listings.last_import_run_id") {
      runFilter = value as string[];
    }
    return chain;
  };
  chain.not = self;
  chain.or = (filter: string) => {
    captured.filters.push(["or", filter]);
    // Model the legacy class fallback the same way PostgreSQL would:
    // product_class.in.(...) OR product_class.is.null.
    const inMatch = /product_class\.in\.\(([^)]*)\)/.exec(filter);
    if (inMatch) {
      classFilter = {
        classes: inMatch[1].split(",").map((c) => c.trim()).filter(Boolean),
        allowNull: filter.includes("product_class.is.null"),
      };
    }
    return chain;
  };
  chain.order = self;
  chain.limit = () => Promise.resolve({ data: [], error: null });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  chain.range = (a: number, b: number) => {
    captured.ranges.push([a, b]);
    let matching = runFilter === null
      ? universe
      : universe.filter((entry) => (runFilter as string[]).includes(entry.runId));
    if (classFilter) {
      const { classes, allowNull } = classFilter;
      matching = matching.filter((entry) => {
        const cls = entry.product.product_class as string | null;
        return cls === null ? allowNull : classes.includes(cls);
      });
    }
    return Promise.resolve({
      data: matching.slice(a, b + 1).map((entry) => entry.product),
      error: null,
      count: matching.length,
    });
  };
  return chain;
}

function simpleBuilder(data: unknown) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self; chain.eq = self; chain.in = self; chain.not = self;
  chain.or = self; chain.order = self;
  chain.limit = () => Promise.resolve({ data, error: null });
  chain.range = () => Promise.resolve({ data, error: null, count: 0 });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

function product(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, brand: `BRAND_${id}`, model_pattern: "M", description: null,
    size_display: "205/55 R16", width_mm: 205, aspect_ratio: 55, rim_inch: 16,
    load_index: "91", speed_rating: "V", load_speed_raw: "91V", season: "summer",
    product_class: "passenger_car", xl: false, run_flat: false, old_dot: false,
    eprel_id: null, weight_kg: 8.5, ean: null, review_required: false,
    review_reasons: [], ...overrides,
  };
}

function priceRow(cents: string, observedAt = "2026-09-22T14:00:00Z") {
  return [{
    purchase_price: cents, currency: "EUR", stock_raw: "6",
    stock_exact: 6, stock_minimum: 6, observed_at: observedAt,
  }];
}

function listingFor(productId: string, adapter: string, notes: string | null, price: string) {
  return {
    id: `l-${productId}`, catalogue_product_id: productId,
    supplier_article_id: `art-${productId}`, supplier_item_code: null, old_dot: false,
    suppliers: { id: "s-1", name: "asdas" },
    catalogue_import_runs: { adapter, notes },
    supplier_listing_prices: priceRow(price),
  };
}

/** Three Inter-Sprint PCR products, two truck, one legacy. */
const UNIVERSE = [
  { id: "pcr-1", runId: PCR_RUN, product: product("pcr-1") },
  { id: "pcr-2", runId: PCR_RUN, product: product("pcr-2") },
  { id: "pcr-3", runId: PCR_RUN, product: product("pcr-3") },
  { id: "trk-1", runId: TRUCK_RUN, product: product("trk-1", { product_class: null }) },
  { id: "trk-2", runId: TRUCK_RUN, product: product("trk-2", { product_class: null }) },
  { id: "leg-1", runId: LEGACY_RUN, product: product("leg-1") },
];

const LISTINGS = [
  listingFor("pcr-1", "intersprint-feed", "intersprint-feed:category=pcr", "300.00"),
  listingFor("pcr-2", "intersprint-feed", "intersprint-feed:category=pcr", "100.00"),
  listingFor("pcr-3", "intersprint-feed", "intersprint-feed:category=pcr", "200.00"),
  listingFor("trk-1", "intersprint-feed", "intersprint-feed:category=truck", "500.00"),
  listingFor("trk-2", "intersprint-feed", "intersprint-feed:category=truck", "400.00"),
  listingFor("leg-1", "isb", null, "150.00"),
];

function mockAll() {
  captured.filters = []; captured.embeds = []; captured.ranges = [];
  from.mockImplementation((table: string) => {
    if (table === "catalogue_import_runs") return simpleBuilder(RUNS);
    if (table === "catalogue_products") return productBuilder(UNIVERSE);
    if (table === "supplier_product_listings") return simpleBuilder(LISTINGS);
    if (table === "catalogue_conflicts") return simpleBuilder([]);
    return simpleBuilder([]);
  });
}

const NOW = new Date("2026-09-22T15:00:00Z");

afterEach(() => vi.clearAllMocks());

describe("the run-id predicate actually reaches the join", () => {
  it("adds an inner embed and filters it on last_import_run_id", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();

    await browseCatalogue({ lane: "intersprint" }, undefined, undefined, NOW);

    expect(captured.embeds.some((e) => e.includes("supplier_product_listings!inner"))).toBe(true);
    const runPredicate = captured.filters.find(
      ([column]) => column === "supplier_product_listings.last_import_run_id"
    );
    expect(runPredicate, "lane must constrain the joined relation").toBeDefined();
    expect(runPredicate?.[1]).toEqual(expect.arrayContaining([PCR_RUN, TRUCK_RUN]));
  });

  it("applies no listing join when neither lane nor vehicle is chosen", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();

    await browseCatalogue({}, undefined, undefined, NOW);
    expect(
      captured.filters.find(([c]) => c === "supplier_product_listings.last_import_run_id")
    ).toBeUndefined();
  });
});

describe("supplier lane changes membership and total", () => {
  it("counts only the lane's products", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");

    mockAll();
    const all = await browseCatalogue({}, undefined, undefined, NOW);
    expect(all.total).toBe(6);

    mockAll();
    const intersprint = await browseCatalogue({ lane: "intersprint" }, undefined, undefined, NOW);
    // All six runs belong to Inter-Sprint adapters, so membership is unchanged
    // here — but the predicate is what decides that, not a post-filter.
    expect(intersprint.total).toBe(6);
  });

  /** A lane with no imports must match NOTHING, not everything. */
  it("returns an empty set and a zero total for a lane with no runs", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();

    const deldo = await browseCatalogue({ lane: "deldo" }, undefined, undefined, NOW);

    expect(deldo.total).toBe(0);
    expect(deldo.rows).toEqual([]);
    const runPredicate = captured.filters.find(
      ([c]) => c === "supplier_product_listings.last_import_run_id"
    );
    // A sentinel id, so the join can match no row at all.
    expect(runPredicate?.[1]).toEqual(["00000000-0000-0000-0000-000000000000"]);
  });

  it("returns nothing for Carlini too, without fabricating a listing", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();
    const carlini = await browseCatalogue({ lane: "carlini" }, undefined, undefined, NOW);
    expect(carlini.total).toBe(0);
    expect(carlini.rows).toEqual([]);
  });
});

describe("Car & Van vs Truck changes membership and total", () => {
  it("counts only truck products under Truck", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();

    const truck = await browseCatalogue({ vehicle: "truck" }, undefined, undefined, NOW);

    // Two truck products, not the six the old post-filter would have counted:
    // the truck run's two survive (class null), and the legacy car product is
    // excluded by the class fallback.
    expect(truck.total).toBe(2);
    const runPredicate = captured.filters.find(
      ([c]) => c === "supplier_product_listings.last_import_run_id"
    )?.[1] as string[];
    expect(runPredicate).toContain(TRUCK_RUN);
    expect(runPredicate).not.toContain(PCR_RUN);
    // The legacy run is admitted so its listings can fall back to class...
    expect(runPredicate).toContain(LEGACY_RUN);
    // ...and the class fallback is pushed down as a root filter.
    const classFilter = captured.filters.find(
      ([c, v]) => c === "or" && String(v).includes("product_class")
    );
    expect(classFilter, "legacy fallback must be constrained in SQL").toBeDefined();
    expect(String(classFilter?.[1])).toContain("product_class.is.null");
  });

  it("counts only car and van products under Car & Van", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();

    const carVan = await browseCatalogue({ vehicle: "car_van" }, undefined, undefined, NOW);

    const runPredicate = captured.filters.find(
      ([c]) => c === "supplier_product_listings.last_import_run_id"
    )?.[1] as string[];
    expect(runPredicate).toContain(PCR_RUN);
    expect(runPredicate).toContain(LEGACY_RUN);
    expect(runPredicate).not.toContain(TRUCK_RUN);
    expect(carVan.total).toBe(4); // 3 pcr + 1 legacy
  });

  it("gives Car & Van and Truck different totals, from the same catalogue", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();
    const carVan = await browseCatalogue({ vehicle: "car_van" }, undefined, undefined, NOW);
    mockAll();
    const truck = await browseCatalogue({ vehicle: "truck" }, undefined, undefined, NOW);
    mockAll();
    const all = await browseCatalogue({ vehicle: "all" }, undefined, undefined, NOW);

    expect(all.total).toBe(6);
    expect(carVan.total).not.toBe(all.total);
    expect(truck.total).not.toBe(all.total);
    expect(carVan.total).not.toBe(truck.total);
  });

  it("intersects lane and vehicle rather than applying only one", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();

    await browseCatalogue({ lane: "intersprint", vehicle: "truck" }, undefined, undefined, NOW);

    const runPredicate = captured.filters.find(
      ([c]) => c === "supplier_product_listings.last_import_run_id"
    )?.[1] as string[];
    // Inter-Sprint ∩ truck = the truck run only. The legacy run is Inter-Sprint
    // by adapter, so it survives the intersection and the class filter decides.
    expect(runPredicate).toContain(TRUCK_RUN);
    expect(runPredicate).not.toContain(PCR_RUN);
  });
});

describe("pagination stays globally correct under those filters", () => {
  it("pages over the filtered set, not the whole catalogue", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");

    mockAll();
    const page1 = await browseCatalogue(
      { vehicle: "car_van", limit: 2, offset: 0 }, undefined, undefined, NOW
    );
    mockAll();
    const page2 = await browseCatalogue(
      { vehicle: "car_van", limit: 2, offset: 2 }, undefined, undefined, NOW
    );

    expect(page1.total).toBe(4);
    expect(page2.total).toBe(4);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(2);

    // No product appears on both pages, and together they cover the set.
    const ids1 = page1.rows.map((r) => r.product.productId);
    const ids2 = page2.rows.map((r) => r.product.productId);
    expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);
    expect(new Set([...ids1, ...ids2]).size).toBe(4);
    // And no truck product leaked into a Car & Van page.
    expect([...ids1, ...ids2].some((id) => id.startsWith("trk"))).toBe(false);
  });

  it("asks the database for a range within the filtered set", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();

    await browseCatalogue({ lane: "intersprint", limit: 2, offset: 4 }, undefined, undefined, NOW);
    expect(captured.ranges).toContainEqual([4, 5]);
  });
});

describe("offer-derived sorting stays globally correct with those filters", () => {
  it("orders the whole filtered set by price, not just a page of it", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();

    const result = await browseCatalogue(
      { vehicle: "car_van", sort: "price_asc" }, undefined, undefined, NOW
    );

    expect(result.sort).toBe("price_asc");
    expect(result.sortRefused).toBeNull();
    // pcr-2 100, leg-1 150, pcr-3 200, pcr-1 300 — and no truck product.
    expect(result.rows.map((r) => r.product.productId)).toEqual([
      "pcr-2", "leg-1", "pcr-3", "pcr-1",
    ]);
  });

  it("makes page 2 of a filtered price sort the globally 2nd cheapest", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();

    const page2 = await browseCatalogue(
      { vehicle: "car_van", sort: "price_asc", limit: 1, offset: 1 },
      undefined, undefined, NOW
    );

    expect(page2.rows.map((r) => r.product.productId)).toEqual(["leg-1"]);
    expect(page2.total).toBe(4);
  });

  it("sorts within a lane without leaking another lane's offers", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();

    const result = await browseCatalogue(
      { lane: "intersprint", vehicle: "truck", sort: "price_asc" },
      undefined, undefined, NOW
    );

    // trk-2 at 400 before trk-1 at 500. The cheaper PCR rows are not members,
    // and the legacy car product is excluded by the class fallback.
    expect(result.rows.map((r) => r.product.productId)).toEqual(["trk-2", "trk-1"]);
  });

  it("probes the filtered total, so the sort cap applies to the selection", async () => {
    const { browseCatalogue } = await import("@/lib/server/catalogue-browse");
    mockAll();

    await browseCatalogue({ vehicle: "truck", sort: "price_asc" }, undefined, undefined, NOW);

    // The probe is a range request too, and it carries the run predicate.
    expect(captured.ranges.length).toBeGreaterThanOrEqual(2);
    expect(
      captured.filters.filter(([c]) => c === "supplier_product_listings.last_import_run_id").length
    ).toBeGreaterThanOrEqual(2);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The size lists behind the customer catalogue's three selectors.
 *
 * "It takes quite a lot to load values in dropdowns." They were filled from
 * the DEPENDENT facet query, which with no dimension chosen has nothing to
 * narrow by and read up to 20,000 rows per column across five columns before
 * the first dropdown could be offered. These are the properties that replaced
 * it: unfiltered, so there is nothing to recompute; cached, so the scan
 * happens once; and never cached when it failed, so one bad moment does not
 * empty the selectors for everyone for ten minutes.
 */

const select = vi.fn();

vi.mock("@/lib/supabase/server-admin", () => ({
  createSupabaseAdminClient: () => ({ from: () => builder() }),
}));

const logError = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: (...a: unknown[]) => logError(...a) }));

/**
 * A minimal PostgREST builder: every narrowing call returns itself, and the
 * chain resolves to whatever the test queued. `select` records the column so
 * the filters applied to it can be asserted.
 */
function builder() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = (column: string) => {
    select(column);
    return chain;
  };
  chain.eq = (...a: unknown[]) => {
    (chain.calls as unknown[]).push(["eq", ...a]);
    return self();
  };
  chain.not = (...a: unknown[]) => {
    (chain.calls as unknown[]).push(["not", ...a]);
    return self();
  };
  chain.calls = [];
  chain.limit = () => queued.shift() ?? { data: [], error: null };
  return chain as never;
}

let queued: { data: unknown; error: unknown }[] = [];

async function load() {
  const module = await import("@/lib/server/catalogue-dimensions");
  module.resetTyreDimensionsCache();
  return module;
}

beforeEach(() => {
  queued = [];
  select.mockClear();
  logError.mockClear();
});

afterEach(() => vi.clearAllMocks());

/** Three reads: widths, aspect ratios, rims. */
function queueRows() {
  queued = [
    { data: [{ width_mm: 205 }, { width_mm: 195 }, { width_mm: 205 }, { width_mm: null }], error: null },
    { data: [{ aspect_ratio: 55 }, { aspect_ratio: 45 }], error: null },
    { data: [{ rim_inch: 17 }, { rim_inch: 16 }], error: null },
  ];
}

describe("the size lists", () => {
  it("are deduplicated and sorted, so the dropdown reads as a scale", async () => {
    queueRows();
    const { getTyreDimensions } = await load();

    const dimensions = await getTyreDimensions();
    expect(dimensions.widths).toEqual([195, 205]);
    expect(dimensions.aspectRatios).toEqual([45, 55]);
    expect(dimensions.rims).toEqual([16, 17]);
    expect(dimensions.schemaAvailable).toBe(true);
  });

  it("read exactly the three dimension columns and nothing else", async () => {
    queueRows();
    const { getTyreDimensions } = await load();
    await getTyreDimensions();

    expect(select.mock.calls.map((c) => c[0]).sort()).toEqual([
      "aspect_ratio",
      "rim_inch",
      "width_mm",
    ]);
    // No season, no brand: four of the five old scans were discarded output.
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("drop a null dimension rather than offering it as an option", async () => {
    queueRows();
    const { getTyreDimensions } = await load();
    expect((await getTyreDimensions()).widths).not.toContain(null);
  });
});

describe("caching", () => {
  it("reads once and serves the rest from memory", async () => {
    queueRows();
    const { getTyreDimensions } = await load();

    const first = await getTyreDimensions();
    const second = await getTyreDimensions();

    expect(select).toHaveBeenCalledTimes(3);
    expect(second).toBe(first);
  });

  it("de-duplicates concurrent first requests, so a cold start reads once", async () => {
    queueRows();
    const { getTyreDimensions } = await load();

    const [a, b] = await Promise.all([getTyreDimensions(), getTyreDimensions()]);

    expect(select).toHaveBeenCalledTimes(3);
    expect(a).toBe(b);
  });

  it("re-reads once the entry has expired", async () => {
    queueRows();
    const { getTyreDimensions } = await load();
    const start = 1_000_000;
    await getTyreDimensions(start);

    queueRows();
    await getTyreDimensions(start + 11 * 60 * 1000);
    expect(select).toHaveBeenCalledTimes(6);
  });

  /**
   * The property that matters most. Caching an empty list would leave every
   * customer with three empty dropdowns for the whole TTL because of one bad
   * moment — the exact failure the cache was added to prevent.
   */
  it("never caches a failed read", async () => {
    queued = [{ data: null, error: { code: "57014", message: "canceling statement" } }];
    const { getTyreDimensions } = await load();

    const failed = await getTyreDimensions();
    expect(failed.schemaAvailable).toBe(false);
    expect(failed.widths).toEqual([]);
    expect(logError).toHaveBeenCalled();

    queueRows();
    const recovered = await getTyreDimensions();
    expect(recovered.widths, "the next request must try again").toEqual([195, 205]);
  });

  /**
   * An environment without the catalogue tables is not an error: the page
   * renders with empty selectors and says the catalogue is unavailable.
   */
  it("treats missing tables as empty rather than as a failure", async () => {
    queued = [
      { data: null, error: { code: "42P01", message: 'relation "catalogue_products" does not exist' } },
      { data: null, error: { code: "42P01", message: 'relation "catalogue_products" does not exist' } },
      { data: null, error: { code: "42P01", message: 'relation "catalogue_products" does not exist' } },
    ];
    const { getTyreDimensions } = await load();

    const dimensions = await getTyreDimensions();
    expect(dimensions.widths).toEqual([]);
    expect(dimensions.schemaAvailable).toBe(true);
    expect(logError).not.toHaveBeenCalled();
  });
});

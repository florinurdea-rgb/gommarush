import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The public tyre lookup.
 *
 * This endpoint is unauthenticated and one join away from supplier prices,
 * so the tests that matter here are about what does NOT come back. The
 * mock returns a row carrying supplier data deliberately: if the projection
 * ever widens to select("*"), the leak assertions below fail.
 */

const select = vi.fn();
const eq = vi.fn();
const inFilter = vi.fn();
const limit = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase/server-admin", () => ({
  createSupabaseAdminClient: () => ({ from }),
}));

function mockResult(data: unknown, error: unknown = null) {
  const chain = {
    select: (...args: unknown[]) => {
      select(...args);
      return chain;
    },
    eq: (...args: unknown[]) => {
      eq(...args);
      return chain;
    },
    in: (...args: unknown[]) => {
      inFilter(...args);
      return chain;
    },
    limit: (...args: unknown[]) => {
      limit(...args);
      return Promise.resolve({ data, error });
    },
  };
  from.mockReturnValue(chain);
}

const PRODUCT = {
  brand: "NANKANG",
  model_pattern: "TR10",
  description: "145     R10 TL 84N  NANK TR10",
  size_display: "145/80 R10",
  width_mm: 145,
  aspect_ratio: 80,
  rim_inch: 10,
  load_index: "84",
  speed_rating: "N",
  load_speed_raw: "84N",
  season: "summer",
  product_class: "light_truck_van",
  xl: false,
  run_flat: false,
  weight_kg: "6.031",
  eprel_id: null,
  active: true,
};

beforeEach(() => {
  for (const fn of [select, eq, inFilter, limit, from]) fn.mockReset();
});
afterEach(() => vi.resetModules());

async function load() {
  return import("@/lib/server/catalogue-lookup");
}

describe("publicTyreLookup — what it refuses to do", () => {
  it("never selects supplier data", async () => {
    mockResult([]);
    const { publicTyreLookup } = await load();
    await publicTyreLookup("4717622044652");

    const projection = String(select.mock.calls[0][0]);
    for (const forbidden of [
      "purchase_price",
      "supplier_article",
      "supplier_item_code",
      "supplier_listing_key",
      "supplier_id",
      "stock",
      "review_required",
      "import_run",
      "*",
    ]) {
      expect(projection).not.toContain(forbidden);
    }
  });

  it("never matches on a supplier article code", async () => {
    mockResult([]);
    const { publicTyreLookup } = await load();
    await publicTyreLookup("12851");

    const types = inFilter.mock.calls.find((call) => call[0] === "identifier_type")![1] as string[];
    expect(types).not.toContain("supplier_article_code");
    expect(types).toEqual(["ean", "gtin", "manufacturer_code"]);
  });

  it("only returns active products", async () => {
    mockResult([]);
    const { publicTyreLookup } = await load();
    await publicTyreLookup("4717622044652");
    expect(eq.mock.calls).toContainEqual(["catalogue_products.active", true]);
  });

  it("returns nothing but whitelisted fields, even if the row carries more", async () => {
    mockResult([
      {
        identifier_type: "ean",
        normalized_value: "4717622044652",
        // A row that should never exist, but would leak if we spread it.
        catalogue_products: { ...PRODUCT, purchase_price: "42.50", supplier_article_id: "12851" },
      },
    ]);
    const { publicTyreLookup } = await load();
    const result = await publicTyreLookup("4717622044652");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("42.50");
    expect(serialized).not.toContain("12851");
    expect(Object.keys(result.results[0]).sort()).toEqual(
      [
        "aspectRatio", "brand", "description", "eprelId", "loadIndex", "loadSpeedRaw",
        "matchedOn", "matchedValue", "modelPattern", "productClass", "rimInch",
        "runFlat", "season", "sizeDisplay", "speedRating", "weightKg", "widthMm", "xl",
      ].sort()
    );
  });
});

describe("publicTyreLookup — outcomes", () => {
  it("finds a tyre by a validated barcode", async () => {
    mockResult([
      { identifier_type: "ean", normalized_value: "4717622044652", catalogue_products: PRODUCT },
    ]);
    const { publicTyreLookup } = await load();
    const result = await publicTyreLookup("4717622044652");

    expect(result.status).toBe("found");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].brand).toBe("NANKANG");
    expect(result.results[0].weightKg).toBe(6.031);
    expect(result.results[0].matchedOn).toBe("ean");
  });

  it("normalizes spacing before searching, so a scanned code with spaces still matches", async () => {
    mockResult([]);
    const { publicTyreLookup } = await load();
    const result = await publicTyreLookup(" 4717-6220 44652 ");
    expect(result.query).toBe("4717622044652");
    expect(inFilter.mock.calls[0]).toEqual(["normalized_value", ["4717622044652"]]);
  });

  /**
   * A mistyped barcode is reported as a bad code, not as "not in the
   * catalogue" — otherwise someone goes hunting for a tyre when the real
   * problem is a digit.
   */
  it("rejects a numeric code whose check digit fails, without querying at all", async () => {
    mockResult([]);
    const { publicTyreLookup } = await load();
    const result = await publicTyreLookup("8019227448086");

    expect(result.status).toBe("invalid_code");
    expect(result.reason).toBe("CHECK_DIGIT_MISMATCH");
    expect(from).not.toHaveBeenCalled();
  });

  /**
   * The bug this pins: a numeric manufacturer reference is not a barcode.
   * '110181' is a real MICHELIN code in the ISB file, and rejecting it for
   * failing a check digit it was never meant to satisfy made a code that is
   * in the catalogue unfindable.
   */
  it("searches a numeric code that is not a barcode length, rather than rejecting it", async () => {
    mockResult([
      { identifier_type: "manufacturer_code", normalized_value: "110181", catalogue_products: PRODUCT },
    ]);
    const { publicTyreLookup } = await load();
    const result = await publicTyreLookup("110181");

    expect(result.status).toBe("found");
    expect(from).toHaveBeenCalled();
  });

  it("also searches the recovered form of an 11-digit code", async () => {
    mockResult([]);
    const { publicTyreLookup } = await load();
    await publicTyreLookup("29142337867");

    const values = inFilter.mock.calls.find((call) => call[0] === "normalized_value")![1] as string[];
    expect(values).toContain("29142337867");
    expect(values).toContain("029142337867");
  });

  it("still searches a non-numeric code, which is a manufacturer reference", async () => {
    mockResult([
      { identifier_type: "manufacturer_code", normalized_value: "EB208", catalogue_products: PRODUCT },
    ]);
    const { publicTyreLookup } = await load();
    const result = await publicTyreLookup("eb208");

    expect(result.status).toBe("found");
    expect(result.results[0].matchedOn).toBe("manufacturer_code");
  });

  it("reports an empty result as not found rather than as an error", async () => {
    mockResult([]);
    const { publicTyreLookup } = await load();
    expect((await publicTyreLookup("4717622057126")).status).toBe("not_found");
  });

  it("treats a blank or oversized code as invalid without touching the database", async () => {
    mockResult([]);
    const { publicTyreLookup } = await load();
    expect((await publicTyreLookup("   ")).reason).toBe("EMPTY");
    expect((await publicTyreLookup("9".repeat(60))).reason).toBe("TOO_LONG");
    expect(from).not.toHaveBeenCalled();
  });

  it("degrades to not-found when the catalogue tables do not exist yet", async () => {
    mockResult(null, { code: "42P01", message: 'relation "product_identifiers" does not exist' });
    const { publicTyreLookup } = await load();
    const result = await publicTyreLookup("4717622044652");
    expect(result.status).toBe("not_found");
  });

  it("collapses duplicate listings of the same tyre into one result", async () => {
    mockResult([
      { identifier_type: "ean", normalized_value: "4717622044652", catalogue_products: PRODUCT },
      { identifier_type: "ean", normalized_value: "4717622044652", catalogue_products: PRODUCT },
    ]);
    const { publicTyreLookup } = await load();
    expect((await publicTyreLookup("4717622044652")).results).toHaveLength(1);
  });
});

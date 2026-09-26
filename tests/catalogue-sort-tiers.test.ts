import { describe, expect, it } from "vitest";
import {
  APPROVED_BRAND_TIERS,
  BRAND_TIERS,
  BRAND_TIERS_CONFIGURED,
  brandsInTier,
  isBrandTier,
  tierForBrand,
  unclassifiedBrands,
} from "@/lib/catalogue/brand-tiers";
import {
  bestPriceCents,
  bestStock,
  isCatalogueSort,
  isDatabaseNativeSort,
  newestObservedAt,
  OFFER_SORT_MAX_PRODUCTS,
  sortRows,
  type SortableRow,
} from "@/lib/catalogue/catalogue-sort";

/**
 * Sorting and the brand taxonomy.
 *
 * Two properties matter most here: that no brand acquires a commercial tier
 * nobody approved, and that an offer-derived sort either orders the whole
 * filtered set or refuses — never a page sorted in isolation.
 */

describe("the brand taxonomy ships empty", () => {
  /**
   * Whether a brand is "premium" is a positioning decision about GommaRush's
   * market, not a fact about the manufacturer. Nothing in the data supports
   * it: Inter-Sprint's 'LUXE BANDEN' is a product segment spanning many
   * brands, not a statement about any of them.
   */
  it("has no approved assignments yet", () => {
    expect(APPROVED_BRAND_TIERS).toEqual([]);
    expect(BRAND_TIERS_CONFIGURED).toBe(false);
  });

  it("still offers the three tiers as a mechanism", () => {
    expect([...BRAND_TIERS]).toEqual(["premium", "mid_range", "value"]);
    expect(isBrandTier("premium")).toBe(true);
    expect(isBrandTier("luxury")).toBe(false);
    expect(isBrandTier(null)).toBe(false);
  });

  /** Unclassified must never drift into the cheapest bucket by omission. */
  it("returns null for every real catalogue brand, not a default tier", () => {
    for (const brand of ["MICHELIN", "BRIDGESTONE", "VREDESTEIN", "NANKANG", "SUNNY", "ROADHOG"]) {
      expect(tierForBrand(brand), brand).toBeNull();
    }
    expect(tierForBrand(null)).toBeNull();
    expect(tierForBrand("")).toBeNull();
  });

  it("reports every brand as unclassified while the mapping is empty", () => {
    const brands = ["MICHELIN", "SUNNY"];
    expect(unclassifiedBrands(brands)).toEqual(brands);
  });

  it("returns no brands for any tier", () => {
    for (const tier of BRAND_TIERS) expect(brandsInTier(tier)).toEqual([]);
  });

  /**
   * The mechanism must work the moment a mapping is approved, so the lookup is
   * exercised here against a local assignment rather than left untested until
   * someone adds one to production.
   */
  it("resolves a tier once one is approved, case- and space-insensitively", () => {
    const local = new Map<string, string>([["MICHELIN", "premium"]]);
    const lookup = (brand: string) => local.get(brand.trim().toUpperCase()) ?? null;

    expect(lookup(" michelin ")).toBe("premium");
    expect(lookup("NANKANG")).toBeNull();
  });
});

describe("which sorts the database can do", () => {
  it("treats brand order as database-native", () => {
    expect(isDatabaseNativeSort("brand_asc")).toBe(true);
  });

  /**
   * Price, freshness and stock all come from the latest supplier observation,
   * which lives in another table. Sorting a fetched page by one of them would
   * be the local-ordering bug M11B removed.
   */
  it("treats every offer-derived sort as needing materialisation", () => {
    expect(isDatabaseNativeSort("price_asc")).toBe(false);
    expect(isDatabaseNativeSort("freshest")).toBe(false);
    expect(isDatabaseNativeSort("stock_desc")).toBe(false);
  });

  it("validates a sort coming off a query string", () => {
    expect(isCatalogueSort("price_asc")).toBe(true);
    expect(isCatalogueSort("price_desc")).toBe(false);
    expect(isCatalogueSort(undefined)).toBe(false);
  });

  it("bounds how much an offer-derived sort may materialise", () => {
    expect(OFFER_SORT_MAX_PRODUCTS).toBe(1_000);
  });
});

describe("sort keys across a row's offers", () => {
  const row = (offers: SortableRow["offers"], id = "p"): SortableRow => ({
    brand: "B", modelPattern: "M", productId: id, offers,
  });
  const offer = (o: Partial<SortableRow["offers"][number]> = {}) => ({
    purchasePriceCents: null, observedAt: null, stockExact: null, stockMinimum: null, ...o,
  });

  it("takes the cheapest offer as the row's price", () => {
    expect(bestPriceCents(row([offer({ purchasePriceCents: 9_920 }), offer({ purchasePriceCents: 6_608 })])))
      .toBe(6_608);
  });

  it("has no price when no offer is priced", () => {
    expect(bestPriceCents(row([offer(), offer()]))).toBeNull();
  });

  it("takes the most recent observation as the row's freshness", () => {
    expect(
      newestObservedAt(row([
        offer({ observedAt: "2026-09-20T10:00:00Z" }),
        offer({ observedAt: "2026-09-22T14:00:00Z" }),
      ]))
    ).toBe(new Date("2026-09-22T14:00:00Z").getTime());
  });

  /** A band contributes its floor. It is never resolved into a number. */
  it("uses a band's floor for stock, never an invented count", () => {
    expect(bestStock(row([offer({ stockExact: null, stockMinimum: 20 })]))).toBe(20);
    expect(bestStock(row([offer({ stockExact: 6, stockMinimum: 6 })]))).toBe(6);
    expect(bestStock(row([offer({ stockExact: 4 }), offer({ stockMinimum: 20 })]))).toBe(20);
  });
});

describe("ordering a materialised set", () => {
  const make = (id: string, brand: string, offers: SortableRow["offers"]): SortableRow => ({
    brand, modelPattern: "M", productId: id, offers,
  });
  const priced = (cents: number | null, observedAt: string | null = null, stock: number | null = null) => ({
    purchasePriceCents: cents, observedAt, stockExact: stock, stockMinimum: stock,
  });

  it("puts the cheapest first", () => {
    const rows = [
      make("a", "AAA", [priced(9_920)]),
      make("b", "BBB", [priced(2_879)]),
      make("c", "CCC", [priced(6_608)]),
    ];
    expect(sortRows(rows, "price_asc").map((r) => r.productId)).toEqual(["b", "c", "a"]);
  });

  /** An unpriced row is not "cheapest"; it sinks below every priced one. */
  it("sinks a row with no price under ascending price", () => {
    const rows = [
      make("none", "AAA", [priced(null)]),
      make("cheap", "ZZZ", [priced(2_879)]),
    ];
    // "AAA" would sort first alphabetically; having no price outranks that.
    expect(sortRows(rows, "price_asc").map((r) => r.productId)).toEqual(["cheap", "none"]);
  });

  /** And a row with no stock sinks under descending stock, for the same reason. */
  it("sinks a row with no stock under descending stock", () => {
    const rows = [
      make("none", "AAA", [priced(1, null, null)]),
      make("stocked", "ZZZ", [priced(1, null, 8)]),
    ];
    expect(sortRows(rows, "stock_desc").map((r) => r.productId)).toEqual(["stocked", "none"]);
  });

  it("puts the most recently observed first", () => {
    const rows = [
      make("old", "AAA", [priced(1, "2026-09-01T00:00:00Z")]),
      make("new", "BBB", [priced(1, "2026-09-22T00:00:00Z")]),
    ];
    expect(sortRows(rows, "freshest").map((r) => r.productId)).toEqual(["new", "old"]);
  });

  it("puts the most available first", () => {
    const rows = [
      make("few", "AAA", [priced(1, null, 4)]),
      make("many", "BBB", [priced(1, null, 20)]),
    ];
    expect(sortRows(rows, "stock_desc").map((r) => r.productId)).toEqual(["many", "few"]);
  });

  it("orders brand A–Z with model as the tie-break", () => {
    const rows = [
      { brand: "ZZZ", modelPattern: "A", productId: "z", offers: [] },
      { brand: "AAA", modelPattern: "B", productId: "a2", offers: [] },
      { brand: "AAA", modelPattern: "A", productId: "a1", offers: [] },
    ];
    expect(sortRows(rows, "brand_asc").map((r) => r.productId)).toEqual(["a1", "a2", "z"]);
  });

  /**
   * Equal keys must not reorder between requests, or a page boundary drifts
   * and a row can be shown twice or skipped.
   */
  it("is deterministic when the sort key ties", () => {
    const rows = [
      make("b", "SAME", [priced(5_000)]),
      make("a", "SAME", [priced(5_000)]),
      make("c", "SAME", [priced(5_000)]),
    ];
    const once = sortRows(rows, "price_asc").map((r) => r.productId);
    const twice = sortRows([...rows].reverse(), "price_asc").map((r) => r.productId);
    expect(once).toEqual(twice);
    expect(once).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [make("b", "BBB", [priced(2)]), make("a", "AAA", [priced(1)])];
    const before = rows.map((r) => r.productId);
    sortRows(rows, "price_asc");
    expect(rows.map((r) => r.productId)).toEqual(before);
  });
});

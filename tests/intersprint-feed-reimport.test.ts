import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { intersprintFeedAdapter } from "@/lib/catalogue/intersprint-feed-adapter";
import { INTERSPRINT_PCR_ROWS, intersprintRow } from "./intersprint-feed-fixtures";

/**
 * Re-import behaviour: what happens the second, third and hundredth time the
 * same Inter-Sprint listing arrives with a new price.
 *
 * The feed is a price and stock file. It will be delivered repeatedly, and the
 * two failure modes worth guarding are the ones that only appear on the SECOND
 * import: an updated price overwriting a product's specifications, and a
 * listing quietly changing identity.
 */

const ROW = INTERSPRINT_PCR_ROWS.vredestein20555R16;

function normalize(overrides: Record<string, string> = {}) {
  const outcome = intersprintFeedAdapter.normalizeRow(2, intersprintRow(ROW, overrides));
  if (!outcome.normalized) throw new Error("fixture row should normalise");
  return outcome.normalized;
}

describe("a listing keeps its identity across imports", () => {
  it("produces the same listing key when only the price moved", () => {
    const monday = normalize({ "nett-price": "99.2" });
    const friday = normalize({ "nett-price": "104.75" });

    expect(friday.supplierListingKey).toBe(monday.supplierListingKey);
    expect(friday.supplierArticleId).toBe(monday.supplierArticleId);
    expect(friday.purchasePrice).toBe(104.75);
    expect(monday.purchasePrice).toBe(99.2);
  });

  it("produces the same listing key when only the stock moved", () => {
    const before = normalize({ available: "6" });
    const after = normalize({ available: ">  20" });

    expect(after.supplierListingKey).toBe(before.supplierListingKey);
    expect(before.stockExact).toBe(6);
    expect(after.stockExact).toBeNull();
    expect(after.stockMinimum).toBe(20);
  });

  /**
   * If Inter-Sprint re-points a sysnr at a different tyre, that must surface
   * as a product-level change to be reconciled, not be absorbed silently. The
   * adapter's job is to report both identities faithfully; the matching layer
   * then routes the disagreement to catalogue_conflicts.
   */
  it("reports a changed barcode on a known listing rather than hiding it", () => {
    const before = normalize();
    const after = normalize({ eancode: "4717622044652" });

    expect(after.supplierListingKey).toBe(before.supplierListingKey);
    expect(after.ean).not.toBe(before.ean);
    expect(after.productKey).not.toBe(before.productKey);
  });
});

describe("a price-only feed cannot erase the catalogue it updates", () => {
  /**
   * The load-bearing guarantee of this mission.
   *
   * The Inter-Sprint feed states no season and no product class, so every row
   * this adapter produces carries null for both. The catalogue holds 9,052
   * seasons that were derived elsewhere. If a re-import wrote those nulls
   * through, one price refresh would wipe the season off the entire
   * catalogue — silently, and with a completely successful-looking import.
   *
   * What prevents it is in the commit function: every product field is
   * written as coalesce(nullif(incoming, ''), existing). This test reads the
   * migration itself, because the protection lives in SQL and a TypeScript
   * test that mocked it would prove nothing.
   */
  const COMMIT_SQL = readFileSync(
    "supabase/migrations/20260830000100_catalogue_commit.sql",
    "utf8"
  );

  it("confirms the adapter really does emit nulls for the unstated fields", () => {
    const row = normalize();
    expect(row.season).toBeNull();
    expect(row.productClass).toBeNull();
    expect(row.sizeDisplay).toBeNull();
    expect(row.xl).toBeNull();
    expect(row.runFlat).toBeNull();
  });

  it("coalesces every text product field so a null cannot overwrite it", () => {
    for (const field of [
      "season",
      "product_class",
      "brand",
      "model_pattern",
      "description",
      "size_display",
      "load_index",
      "speed_rating",
      "e_mark",
      "eprel_id",
    ]) {
      expect(
        COMMIT_SQL.includes(
          `${field} = coalesce(nullif(v_changes ->> '${field}', ''), p.${field})`
        ),
        `product field ${field} is not null-protected in the commit function`
      ).toBe(true);
    }
  });

  it("coalesces the numeric and boolean product fields too", () => {
    for (const [field, cast] of [
      ["width_mm", "integer"],
      ["aspect_ratio", "integer"],
      ["rim_inch", "integer"],
      ["xl", "boolean"],
      ["run_flat", "boolean"],
      ["weight_kg", "numeric"],
    ] as const) {
      expect(
        COMMIT_SQL.includes(
          `${field} = coalesce((v_changes ->> '${field}')::${cast}, p.${field})`
        ),
        `product field ${field} is not null-protected in the commit function`
      ).toBe(true);
    }
  });
});

describe("absence from a feed is not a stock of zero", () => {
  /**
   * Inter-Sprint has never told us whether a delivered file is the complete
   * catalogue or only what changed. Until they do, a listing missing from a
   * file means nothing about its availability.
   *
   * The importer only proposes deactivation when the OPERATOR declares the
   * file a complete snapshot (importMode 'complete'), which is a human
   * assertion rather than an inference from the file. This test pins the
   * adapter side of it: nothing about a row says anything about rows that
   * are absent.
   */
  it("says nothing about stock for a listing the file does not contain", () => {
    const row = normalize();
    // The only stock statements that exist are about THIS listing.
    expect(row.supplierListingKey).toBe("ISB:34197");
    expect(row.stockRaw).toBe("6");
  });

  it("distinguishes a stated zero from an absent figure", () => {
    const statedZero = normalize({ available: "0" });
    expect(statedZero.stockExact).toBe(0);
    expect(statedZero.stockRaw).toBe("0");

    const absent = normalize({ available: "" });
    expect(absent.stockExact).toBeNull();
    expect(absent.stockMinimum).toBeNull();
    expect(absent.stockRaw).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { listSheetNames, readSheet } from "@/lib/catalogue/xlsx-reader";
import { intersprintFeedAdapter } from "@/lib/catalogue/intersprint-feed-adapter";

/**
 * The real Inter-Sprint sample workbook, end to end.
 *
 * GATED, and skipped by default: the supplier's full price list is not
 * committed to this repository. Point the variable at a real file to run it:
 *
 *   INTERSPRINT_FEED_FILE=/path/to/vrd-pcr.csv.xlsx npx vitest run \
 *     tests/intersprint-feed-real-file.test.ts
 *
 * The fixture tests pin the contract; this one proves the contract matches a
 * file Inter-Sprint actually sent, at full scale — including the million rows
 * of spreadsheet padding, which no small fixture can represent.
 */

const FEED_FILE = process.env.INTERSPRINT_FEED_FILE;
const describeMaybe = FEED_FILE ? describe : describe.skip;

describeMaybe("the real Inter-Sprint sample workbook", () => {
  const bytes = FEED_FILE ? readFileSync(FEED_FILE) : Buffer.alloc(0);

  it("resolves its sheet by suffix", async () => {
    const sheets = await listSheetNames(bytes);
    expect(intersprintFeedAdapter.resolveSheetName(sheets)).not.toBeNull();
  });

  it("parses every real row and drops every padding row", async () => {
    const sheets = await listSheetNames(bytes);
    const sheet = intersprintFeedAdapter.resolveSheetName(sheets);
    const { rows } = await readSheet(bytes, sheet as string, { maxRows: 250_000 });

    let padding = 0;
    let rejected = 0;
    let priced = 0;
    let banded = 0;
    let exact = 0;
    const listingKeys = new Set<string>();

    for (const row of rows) {
      if (intersprintFeedAdapter.isPaddingRow(row.cells)) {
        padding++;
        continue;
      }
      const outcome = intersprintFeedAdapter.normalizeRow(row.sourceRow, row.cells);
      if (!outcome.normalized) {
        rejected++;
        continue;
      }
      listingKeys.add(outcome.normalized.supplierListingKey);
      if (outcome.normalized.purchasePrice !== null) priced++;
      if (outcome.normalized.stockExact !== null) exact++;
      else if (outcome.normalized.stockMinimum !== null) banded++;
    }

    // Every row that is not padding is a real listing, and every one is priced.
    expect(rejected).toBe(0);
    expect(listingKeys.size).toBe(priced);
    expect(priced).toBeGreaterThan(0);
    expect(padding).toBeGreaterThan(0);
    // Both availability forms occur, and neither was collapsed into the other.
    expect(banded).toBeGreaterThan(0);
    expect(exact).toBeGreaterThan(0);
  });
});

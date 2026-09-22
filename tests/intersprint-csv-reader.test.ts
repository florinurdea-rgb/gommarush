import { describe, expect, it } from "vitest";
import {
  CsvFeedError,
  CANDIDATE_DELIMITERS,
  detectDelimiter,
  readIntersprintCsv,
} from "@/lib/suppliers/intersprint/feed/csv-reader";
import { intersprintFeedAdapter } from "@/lib/catalogue/intersprint-feed-adapter";

/**
 * The CSV path.
 *
 * We have never seen a real Inter-Sprint CSV — the artefacts we hold are XLSX
 * exports and this environment cannot reach the FTP host. So the reader
 * DETECTS the dialect against the verified column contract and refuses what it
 * cannot prove. These tests exercise both halves of that.
 */

const HEADER_FIELDS = [
  "sysnr", "itemcode", "description", "Type", "brand", "brand description",
  "group", "group description", "E-mark", "European", "width tyre",
  "aspect ratio", "diameter", "LI/SI", "nett-price", "gross", "available",
  "eancode", "ip-code", "photolink", "", "", "", "", "weight",
  "Fuel effeciency", "Wet grip", "Rollnoise", "Noiselevel", "Snowgrip",
  "Icegrip", "EPREL-id", "EPREL-url", "wcat",
];

const ROW_FIELDS = [
  "34197", "205 55VR 16TWINTRACXL", "205/55 VR16 TL 94V  VR WINTRAC XL",
  "WINTRACXL", "VR", "VREDESTEIN", "13", "LUXE BANDEN M&S", "J", "J",
  "205", "55", "16", "94V", "99.2", "143", "6", "8714692361425",
  "AP20555016VWTRA02", "", "", "", "", "", "8.238", "C", "B", "70", "B",
  "J", "N", "615687", "https://eprel.ec.europa.eu/qr/615687", "1",
];

function csv(delimiter: string, rows: string[][] = [ROW_FIELDS]): string {
  return [HEADER_FIELDS, ...rows].map((r) => r.join(delimiter)).join("\n");
}

describe("delimiter detection", () => {
  it.each([[";"], [","], ["\t"], ["|"]])(
    "recognises the contract delimited by %j",
    (delimiter) => {
      expect(detectDelimiter(HEADER_FIELDS.join(delimiter))).toBe(delimiter);
    }
  );

  it("offers exactly the candidates it documents", () => {
    expect([...CANDIDATE_DELIMITERS]).toEqual([";", ",", "\t", "|"]);
  });

  /** The failure mode a hard-coded delimiter would produce silently. */
  it("refuses a header no candidate can turn into the contract", () => {
    expect(detectDelimiter("sysnr~itemcode~nett-price~available")).toBeNull();
    expect(detectDelimiter("this is not a feed at all")).toBeNull();
  });

  it("refuses a header missing a required column", () => {
    const withoutPrice = HEADER_FIELDS.filter((h) => h !== "nett-price");
    expect(detectDelimiter(withoutPrice.join(";"))).toBeNull();
  });
});

describe("reading a well-formed file", () => {
  it("reads rows keyed by the supplier's own column names", () => {
    const result = readIntersprintCsv(csv(";"));

    expect(result.delimiter).toBe(";");
    expect(result.headers).toHaveLength(34);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cells.sysnr).toBe("34197");
    expect(result.rows[0].cells["nett-price"]).toBe("99.2");
    expect(result.rows[0].cells.available).toBe("6");
  });

  it("reports the data row's real line number", () => {
    expect(readIntersprintCsv(csv(";")).rows[0].sourceRow).toBe(2);
  });

  it("reads a comma-delimited file identically", () => {
    const semi = readIntersprintCsv(csv(";")).rows[0].cells;
    const comma = readIntersprintCsv(csv(",")).rows[0].cells;
    expect(comma).toEqual(semi);
  });

  it("tolerates CRLF line endings", () => {
    const text = csv(";").split("\n").join("\r\n");
    expect(readIntersprintCsv(text).rows).toHaveLength(1);
  });

  /** A Windows export routinely prefixes one. */
  it("strips a UTF-8 byte-order mark", () => {
    const result = readIntersprintCsv(`﻿${csv(";")}`);
    expect(result.rows[0].cells.sysnr).toBe("34197");
  });

  it("drops the unnamed spacer columns rather than colliding on them", () => {
    const cells = readIntersprintCsv(csv(";")).rows[0].cells;
    expect(Object.keys(cells)).not.toContain("");
    expect(Object.keys(cells)).toHaveLength(30);
  });
});

describe("failing closed", () => {
  it("refuses an empty file", () => {
    expect(() => readIntersprintCsv("")).toThrow(CsvFeedError);
    expect(() => readIntersprintCsv("")).toThrow(/empty_file/);
  });

  it("refuses a file whose format changed beyond recognition", () => {
    expect(() => readIntersprintCsv("a~b~c\n1~2~3")).toThrow(/no_delimiter_matched/);
  });

  it("refuses a header missing required columns", () => {
    const header = ["sysnr", "itemcode", "available"].join(";");
    expect(() => readIntersprintCsv(`${header}\n1;2;3`)).toThrow(/no_delimiter_matched/);
  });

  it("refuses duplicate column names rather than letting one shadow the other", () => {
    const dupes = [...HEADER_FIELDS];
    dupes[5] = "sysnr";
    const text = [dupes.join(";"), ROW_FIELDS.join(";")].join("\n");
    expect(() => readIntersprintCsv(text)).toThrow(/duplicate_columns/);
  });

  it("refuses a file with a valid header but no identified row", () => {
    const blank = new Array(HEADER_FIELDS.length).fill("");
    expect(() => readIntersprintCsv(csv(";", [blank]))).toThrow(/no_data_rows/);
  });
});

describe("malformed and padding lines", () => {
  /**
   * A short line is NOT padded out with empty strings. Doing so would give the
   * row a blank price and a blank stock that look like real "not supplied"
   * answers rather than a broken file.
   */
  it("records a short line as malformed and does not import it", () => {
    const short = ROW_FIELDS.slice(0, 10);
    const result = readIntersprintCsv(csv(";", [ROW_FIELDS, short]));

    expect(result.rows).toHaveLength(1);
    expect(result.malformedLines).toEqual([3]);
  });

  it("records an over-long line as malformed rather than truncating it", () => {
    const long = [...ROW_FIELDS, "extra"];
    const result = readIntersprintCsv(csv(";", [ROW_FIELDS, long]));

    expect(result.rows).toHaveLength(1);
    expect(result.malformedLines).toEqual([3]);
  });

  it("skips blank and identity-less lines as padding", () => {
    const blank = new Array(HEADER_FIELDS.length).fill("");
    const result = readIntersprintCsv(`${csv(";", [ROW_FIELDS, blank])}\n`);

    expect(result.rows).toHaveLength(1);
    expect(result.paddingLines).toBe(1);
  });
});

describe("the CSV path reuses the M8 commercial mapping", () => {
  /**
   * The point of the whole reader: it produces exactly the cell shape the
   * existing adapter consumes, so there is ONE commercial interpretation of
   * nett-price and available regardless of container format.
   */
  it("hands rows straight to the existing adapter", () => {
    const result = readIntersprintCsv(csv(";"));
    const outcome = intersprintFeedAdapter.normalizeRow(
      result.rows[0].sourceRow,
      result.rows[0].cells as Record<string, string>
    );

    expect(outcome.normalized?.supplierListingKey).toBe("ISB:34197");
    expect(outcome.normalized?.purchasePrice).toBe(99.2);
    expect(outcome.normalized?.stockExact).toBe(6);
    expect(outcome.normalized?.weightKg).toBeCloseTo(8.238, 3);
  });

  it("produces the same normalized row from CSV as the XLSX path would", async () => {
    const { INTERSPRINT_PCR_ROWS } = await import("./intersprint-feed-fixtures");
    const fromXlsx = intersprintFeedAdapter.normalizeRow(
      2,
      INTERSPRINT_PCR_ROWS.vredestein20555R16
    ).normalized;

    const csvResult = readIntersprintCsv(csv(";"));
    const fromCsv = intersprintFeedAdapter.normalizeRow(
      2,
      csvResult.rows[0].cells as Record<string, string>
    ).normalized;

    expect(fromCsv?.supplierListingKey).toBe(fromXlsx?.supplierListingKey);
    expect(fromCsv?.purchasePrice).toBe(fromXlsx?.purchasePrice);
    expect(fromCsv?.stockExact).toBe(fromXlsx?.stockExact);
    expect(fromCsv?.stockMinimum).toBe(fromXlsx?.stockMinimum);
    expect(fromCsv?.ean).toBe(fromXlsx?.ean);
  });
});

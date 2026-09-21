import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readDeldoCsv,
  splitDelimitedLine,
  CsvStructureError,
} from "@/lib/suppliers/deldo/feed/csv-reader";
import {
  DELDO_FEED_COLUMNS,
  DELDO_FEED_DELIMITER,
  normalizeDeldoRow,
  parseDeldoPrice,
  parseDeldoStock,
  parseDeldoRim,
  parseDeldoLoadSpeed,
  type DeldoNormalizedRow,
} from "@/lib/suppliers/deldo/feed/parse";

/**
 * The fixture is ten REAL rows from the supplier's own 26933TEST.csv, chosen
 * to carry every convention the full 6,729-row file contains: an old-DOT
 * duplicate pair, imperial sizing, a truck rim in tenths, a parenthesised load
 * index, a damaged load index, a missing EAN, an 11-digit EAN and a zero
 * aspect ratio.
 *
 * Real rows rather than invented ones on purpose — the whole risk in this
 * integration is that the file does not look like what we imagined, and a
 * fixture we made up would reproduce our imagination rather than the supplier.
 */
const FIXTURE = readFileSync(
  join(__dirname, "fixtures", "deldo-feed-sample.csv"),
  "utf8"
);

function readFixture() {
  return readDeldoCsv(FIXTURE, {
    delimiter: DELDO_FEED_DELIMITER,
    expectedHeader: DELDO_FEED_COLUMNS,
  });
}

function rowFor(article: string): DeldoNormalizedRow {
  const { rows } = readFixture();
  const row = rows.find((r) => r.cells.Article === article);
  if (!row) throw new Error(`fixture has no article ${article}`);
  const outcome = normalizeDeldoRow(row.sourceLine, row.cells as Record<string, string>);
  if (!outcome.normalized) {
    throw new Error(`article ${article} was rejected: ${outcome.validation.errors.join("; ")}`);
  }
  return outcome.normalized;
}

describe("Deldo CSV reader", () => {
  it("reads the supplier's real header and every data row", () => {
    const { rows, malformed, totalDataLines } = readFixture();
    expect(rows).toHaveLength(10);
    expect(malformed).toHaveLength(0);
    expect(totalDataLines).toBe(10);
  });

  it("rejects a file whose header does not match the verified contract", () => {
    const tampered = FIXTURE.replace("Stock;Price;", "Price;Stock;");
    expect(() =>
      readDeldoCsv(tampered, {
        delimiter: DELDO_FEED_DELIMITER,
        expectedHeader: DELDO_FEED_COLUMNS,
      })
    ).toThrow(CsvStructureError);
  });

  /**
   * The failure that matters most: swapping two columns keeps the file
   * perfectly well-formed and every row parseable, while moving the price into
   * the stock field. Only an exact header check catches it.
   */
  it("catches a column SWAP, which would otherwise import silently", () => {
    const tampered = FIXTURE.replace("Stock;Price;", "Price;Stock;");
    let caught: CsvStructureError | null = null;
    try {
      readDeldoCsv(tampered, {
        delimiter: DELDO_FEED_DELIMITER,
        expectedHeader: DELDO_FEED_COLUMNS,
      });
    } catch (error) {
      caught = error as CsvStructureError;
    }
    expect(caught?.kind).toBe("header_mismatch");
  });

  it("names the wrong delimiter rather than reporting 35 missing columns", () => {
    const commas = FIXTURE.split(";").join(",");
    let caught: CsvStructureError | null = null;
    try {
      readDeldoCsv(commas, {
        delimiter: DELDO_FEED_DELIMITER,
        expectedHeader: DELDO_FEED_COLUMNS,
      });
    } catch (error) {
      caught = error as CsvStructureError;
    }
    expect(caught?.kind).toBe("wrong_delimiter");
  });

  it("skips a malformed line and still imports the rest", () => {
    const lines = FIXTURE.split("\n");
    lines.splice(3, 0, "TOO;FEW;FIELDS");
    const { rows, malformed } = readDeldoCsv(lines.join("\n"), {
      delimiter: DELDO_FEED_DELIMITER,
      expectedHeader: DELDO_FEED_COLUMNS,
    });
    expect(rows).toHaveLength(10);
    expect(malformed).toHaveLength(1);
    expect(malformed[0].reason).toBe("field_count_mismatch");
    expect(malformed[0].actualFields).toBe(3);
  });

  it("refuses an empty file", () => {
    expect(() =>
      readDeldoCsv("", { delimiter: ";", expectedHeader: DELDO_FEED_COLUMNS })
    ).toThrow(CsvStructureError);
  });

  it("honours RFC 4180 quoting so a quoted delimiter cannot shift a row", () => {
    expect(splitDelimitedLine('a;"b;c";d', ";")).toEqual(["a", "b;c", "d"]);
    expect(splitDelimitedLine('a;"say ""hi""";b', ";")).toEqual(["a", 'say "hi"', "b"]);
    // A quote that is not at the start of a field is data, not a delimiter.
    expect(splitDelimitedLine('31X10.50;15"rim;x', ";")).toEqual(["31X10.50", '15"rim', "x"]);
  });

  it("tolerates CRLF, which an FTP transfer can introduce", () => {
    const crlf = FIXTURE.split("\n").join("\r\n");
    const { rows, malformed } = readDeldoCsv(crlf, {
      delimiter: DELDO_FEED_DELIMITER,
      expectedHeader: DELDO_FEED_COLUMNS,
    });
    expect(rows).toHaveLength(10);
    expect(malformed).toHaveLength(0);
  });
});

describe("Deldo numeric parsing", () => {
  it("accepts the supplier's exact price format", () => {
    expect(parseDeldoPrice("48.50")).toBe(48.5);
    expect(parseDeldoPrice("1221.00")).toBe(1221);
    expect(parseDeldoPrice("195")).toBe(195);
  });

  /**
   * A comma decimal is the dangerous case: parseFloat("48,50") returns 48,
   * losing 50 cents on every row, silently. Refusing is the only safe answer.
   */
  it("refuses a comma decimal rather than truncating it", () => {
    expect(parseDeldoPrice("48,50")).toBeNull();
    expect(parseDeldoPrice("1.234,56")).toBeNull();
    expect(parseDeldoPrice("€48.50")).toBeNull();
    expect(parseDeldoPrice("")).toBeNull();
    expect(parseDeldoPrice("n/a")).toBeNull();
  });

  it("keeps zero stock as a real answer, distinct from absent", () => {
    expect(parseDeldoStock("0")).toBe(0);
    expect(parseDeldoStock("13")).toBe(13);
    expect(parseDeldoStock("")).toBeNull();
    expect(parseDeldoStock("-1")).toBeNull();
    expect(parseDeldoStock("3.5")).toBeNull();
    expect(parseDeldoStock(">20")).toBeNull();
  });

  it("reads a three-digit rim as tenths of an inch, and flags it", () => {
    expect(parseDeldoRim("16")).toEqual({ rimInch: 16, needsReview: false });
    // 225 is 22.5", not 225". Every such row in the sample is a truck tyre.
    expect(parseDeldoRim("225")).toEqual({ rimInch: 22.5, needsReview: true });
    expect(parseDeldoRim("175")).toEqual({ rimInch: 17.5, needsReview: true });
  });

  it("splits only unambiguous load/speed values", () => {
    expect(parseDeldoLoadSpeed("100Y")).toEqual({
      loadIndex: "100",
      speedRating: "Y",
      needsReview: false,
    });
    expect(parseDeldoLoadSpeed("106/104S")).toEqual({
      loadIndex: "106/104",
      speedRating: "S",
      needsReview: false,
    });
    // Parenthesised and damaged forms are flagged, never guessed at.
    expect(parseDeldoLoadSpeed("(109Y)").needsReview).toBe(true);
    expect(parseDeldoLoadSpeed("(109Y)").loadIndex).toBeNull();
    expect(parseDeldoLoadSpeed("143/141j-").needsReview).toBe(true);
  });
});

describe("Deldo row mapping", () => {
  it("maps a straightforward passenger row onto the shared model", () => {
    const row = rowFor("AF018989");
    expect(row.supplierListingKey).toBe("DELDO:AF018989");
    expect(row.supplierArticleId).toBe("AF018989");
    expect(row.ean).toBe("5420068618989");
    expect(row.productKey).toBe("GTIN:5420068618989");
    expect(row.brand).toBe("ATLAS FS ALL");
    expect(row.widthMm).toBe(245);
    expect(row.aspectRatio).toBe(45);
    expect(row.rimInch).toBe(18);
    expect(row.loadIndex).toBe("100");
    expect(row.speedRating).toBe("Y");
    expect(row.xl).toBe(true);
    expect(row.season).toBe("all_season");
    expect(row.productClass).toBe("passenger");
    expect(row.purchasePrice).toBe(48.5);
    expect(row.stockExact).toBe(13);
    expect(row.oldDot).toBe(false);
  });

  /**
   * The finding that would have broken a guessed schema. EAN 3286340672719
   * appears twice in the supplier's file: once as current stock at 82.50 and
   * once as 2022 stock at 61.00. Treating EAN as unique would have collapsed
   * them and produced the wrong price for one of the two.
   */
  it("keeps an old-DOT duplicate as a SEPARATE listing of the same product", () => {
    const current = rowFor("BR6727");
    const oldStock = rowFor("BR672722");

    expect(current.ean).toBe(oldStock.ean);
    expect(current.productKey).toBe(oldStock.productKey);
    expect(current.supplierListingKey).not.toBe(oldStock.supplierListingKey);

    expect(current.oldDot).toBe(false);
    expect(oldStock.oldDot).toBe(true);
    expect(oldStock.deldo.dotYear).toBe("2022");

    expect(current.purchasePrice).toBe(82.5);
    expect(oldStock.purchasePrice).toBe(61);
  });

  it("maps a zero aspect ratio to null, not to a zero-profile tyre", () => {
    const row = rowFor("AF019030");
    expect(row.aspectRatio).toBeNull();
    expect(row.widthMm).toBe(195);
    expect(row.rimInch).toBe(14);
  });

  it("refuses to read an imperial width as millimetres", () => {
    const row = rowFor("GO303560");
    // '31X' is 31x10.50R15 — storing 31 would file it among the 31mm tyres.
    expect(row.widthMm).toBeNull();
    expect(row.reviewRequired).toBe(true);
    expect(row.reviewReasons.join(" ")).toContain("imperial");
  });

  it("converts a truck rim and records why", () => {
    const row = rowFor("AN3837300");
    expect(row.rimInch).toBe(22.5);
    expect(row.reviewRequired).toBe(true);
  });

  /**
   * The file's one short EAN is not corrupt — it is a GTIN-12 whose leading
   * zero a spreadsheet stripped, which the existing GTIN helper recovers and
   * check-digit validates. Recovering it is correct: rejecting it would lose a
   * real, scannable barcode over a formatting artefact.
   *
   * The raw value is still kept exactly as supplied, so the recovery is
   * auditable rather than invisible.
   */
  it("recovers a GTIN-12 whose leading zero was stripped, and keeps the raw", () => {
    const row = rowFor("CZ590344");
    expect(row.eanRaw).toBe("29142922865");
    expect(row.eanStatus).toBe("recovered_leading_zero");
    expect(row.ean).toBe("029142922865");
    expect(row.scanReady).toBe(true);
    expect(row.productKey).toBe("GTIN:029142922865");
    // A recovery is not a check-digit failure, so it is not flagged for review.
    expect(row.reviewReasons.join(" ")).not.toContain("check-digit");
  });

  it("flags an EAN that genuinely fails its check digit", () => {
    const { rows } = readFixture();
    const cells = { ...(rows[0].cells as Record<string, string>), EAN: "5420068618988" };
    const outcome = normalizeDeldoRow(2, cells);
    expect(outcome.normalized?.ean).toBeNull();
    expect(outcome.normalized?.scanReady).toBe(false);
    expect(outcome.normalized?.reviewReasons.join(" ")).toContain("check-digit");
    // Without a usable EAN the product key falls back to the supplier's id,
    // so the listing still imports and simply does not bridge suppliers.
    expect(outcome.normalized?.productKey).toBe("DELDO:AF018989");
  });

  it("imports a row with no EAN at all", () => {
    const row = rowFor("BR127445");
    expect(row.ean).toBeNull();
    expect(row.eanRaw).toBeNull();
    expect(row.purchasePrice).toBe(70);
    expect(row.deldo.demo).toBe(true);
  });

  it("carries Discount verbatim and never applies it to the price", () => {
    const row = rowFor("GO303560");
    expect(row.deldo.discountRaw).toBe("41.1");
    // The Price column, untouched. Applying an undocumented quantity that is
    // negative on some rows would corrupt every downstream margin.
    expect(row.purchasePrice).toBe(165.5);
  });

  it("does not invent a weight, because weight drives PFU", () => {
    const row = rowFor("AF018989");
    expect(row.weightKg).toBeNull();
    expect(row.weightStatus).toBe("missing_or_zero");
  });

  it("treats only an exact XL as extra load, not a ply rating", () => {
    expect(rowFor("AF018989").xl).toBe(true);
    // '16PR' is a ply rating in the same column; it is not extra load.
    expect(rowFor("CM01258").xl).toBeNull();
  });

  it("rejects a row whose price cannot be parsed", () => {
    const { rows } = readFixture();
    const cells = { ...(rows[0].cells as Record<string, string>), Price: "48,50" };
    const outcome = normalizeDeldoRow(2, cells);
    expect(outcome.normalized).toBeNull();
    expect(outcome.validation.result).toBe("rejected");
    expect(outcome.validation.errors.join(" ")).toContain("Price");
  });

  it("rejects a row with no stock rather than assuming none", () => {
    const { rows } = readFixture();
    const cells = { ...(rows[0].cells as Record<string, string>), Stock: "" };
    const outcome = normalizeDeldoRow(2, cells);
    expect(outcome.normalized).toBeNull();
    expect(outcome.validation.errors.join(" ")).toContain("Stock");
  });

  it("keeps the untouched source row for audit even when rejecting", () => {
    const { rows } = readFixture();
    const cells = { ...(rows[0].cells as Record<string, string>), Price: "oops" };
    const outcome = normalizeDeldoRow(2, cells);
    expect(outcome.raw.Price).toBe("oops");
    expect(outcome.raw.Article).toBe(rows[0].cells.Article);
  });

  it("is deterministic: the same row parses identically twice", () => {
    expect(rowFor("AF018989")).toEqual(rowFor("AF018989"));
  });
});

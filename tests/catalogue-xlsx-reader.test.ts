import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  columnIndexFromRef,
  listSheetNames,
  looksLikeFormula,
  missingColumns,
  readSheet,
  WorkbookError,
} from "@/lib/catalogue/xlsx-reader";

/**
 * The workbook reader.
 *
 * tests/fixtures/isb-sample.xlsx is 26 real rows lifted from the ISB
 * catalogue by scripts/build-catalogue-fixtures.mjs, rewritten in the source
 * file's own dialect — namespace-prefixed tags, no shared string table.
 * That dialect is exactly what exceljs cannot open, so a fixture written by
 * a friendlier library would test the wrong thing.
 */

const FIXTURE = "tests/fixtures/isb-sample.xlsx";
const bytes = () => readFileSync(FIXTURE);

describe("listSheetNames", () => {
  it("reads sheet names through the namespace prefix", async () => {
    expect(await listSheetNames(bytes())).toEqual(["Tyre Import"]);
  });

  it("refuses a file that is not a zip at all", async () => {
    await expect(listSheetNames(Buffer.from("not a workbook"))).rejects.toMatchObject({
      code: "NOT_A_WORKBOOK",
    });
  });

  it("refuses an empty upload", async () => {
    await expect(listSheetNames(Buffer.alloc(0))).rejects.toMatchObject({ code: "EMPTY_FILE" });
  });
});

describe("readSheet", () => {
  it("returns every ISB column in source order", async () => {
    const { headers } = await readSheet(bytes(), "Tyre Import");
    expect(headers).toHaveLength(33);
    expect(headers[0]).toBe("supplier_listing_key");
    expect(headers).toContain("ean_status");
    expect(headers).toContain("weight_status");
    expect(headers[headers.length - 1]).toBe("source_row");
  });

  it("reads the fixture rows", async () => {
    const { rows, truncated } = await readSheet(bytes(), "Tyre Import");
    expect(rows).toHaveLength(26);
    expect(truncated).toBe(false);
  });

  it("keeps every value as source text, never as a number", async () => {
    const { rows } = await readSheet(bytes(), "Tyre Import");
    for (const row of rows) {
      for (const value of Object.values(row.cells)) {
        expect(typeof value).toBe("string");
      }
    }
  });

  /**
   * The reason this reader exists. exceljs coerces a numeric-looking cell to
   * a JavaScript number, and 0029142337867 and 29142337867 are the same
   * number and different barcodes.
   */
  it("preserves a leading zero in an EAN", async () => {
    const { rows } = await readSheet(bytes(), "Tyre Import");
    const recovered = rows.filter((row) => row.cells.ean_status === "recovered_leading_zero");
    expect(recovered.length).toBeGreaterThan(0);
    for (const row of recovered) {
      expect(row.cells.ean.startsWith("0")).toBe(true);
      expect(row.cells.ean).toHaveLength(12);
    }
  });

  it("reports the spreadsheet's own row numbers so an error can name a row", async () => {
    const { rows } = await readSheet(bytes(), "Tyre Import");
    // Header is row 1, so data starts at 2 and is contiguous in the fixture.
    expect(rows[0].sourceRow).toBe(2);
    expect(rows[rows.length - 1].sourceRow).toBe(27);
  });

  it("omits empty cells rather than inventing an empty string", async () => {
    const { rows } = await readSheet(bytes(), "Tyre Import");
    const withoutEan = rows.find((row) => row.cells.ean_status === "missing");
    expect(withoutEan).toBeDefined();
    expect("ean" in withoutEan!.cells).toBe(false);
  });

  it("carries the whole duplicate-EAN pair through as two separate rows", async () => {
    const { rows } = await readSheet(bytes(), "Tyre Import");
    const byEan = new Map<string, number>();
    for (const row of rows) {
      const ean = row.cells.ean;
      if (ean) byEan.set(ean, (byEan.get(ean) ?? 0) + 1);
    }
    const duplicated = [...byEan.values()].filter((count) => count > 1);
    expect(duplicated.length).toBeGreaterThan(0);
  });

  it("stops at maxRows and says so rather than silently truncating", async () => {
    const { rows, truncated } = await readSheet(bytes(), "Tyre Import", { maxRows: 5 });
    expect(rows).toHaveLength(5);
    expect(truncated).toBe(true);
  });

  it("names a sheet it cannot find", async () => {
    await expect(readSheet(bytes(), "Nope")).rejects.toMatchObject({
      code: "SHEET_NOT_FOUND",
    });
  });

  it("is a WorkbookError, so a route can map it to a message", async () => {
    await expect(readSheet(bytes(), "Nope")).rejects.toBeInstanceOf(WorkbookError);
  });
});

describe("columnIndexFromRef", () => {
  it("maps spreadsheet column letters to 1-based indexes", () => {
    expect(columnIndexFromRef("A1")).toBe(1);
    expect(columnIndexFromRef("Z9")).toBe(26);
    expect(columnIndexFromRef("AA1")).toBe(27);
    expect(columnIndexFromRef("AG9559")).toBe(33);
  });
});

describe("looksLikeFormula", () => {
  it("flags the prefixes a spreadsheet treats as executable", () => {
    for (const value of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tx", "\rx"]) {
      expect(looksLikeFormula(value)).toBe(true);
    }
  });

  it("leaves ordinary catalogue values alone", () => {
    for (const value of ["4717622044652", "NANKANG", "205/55 R16", "91V"]) {
      expect(looksLikeFormula(value)).toBe(false);
    }
  });
});

describe("missingColumns", () => {
  it("names exactly what a file is missing", () => {
    expect(missingColumns(["a", "b"], ["a", "b", "c"])).toEqual(["c"]);
    expect(missingColumns(["a", "b", "c"], ["a"])).toEqual([]);
  });
});

/**
 * Opt-in: points at the full 9,559-row supplier file when it is available
 * locally. Never required for a green run — the committed fixture covers the
 * behaviour; this only proves the reader holds up at real catalogue scale.
 */
const FULL = process.env.ISB_FULL_WORKBOOK;
describe.skipIf(!FULL || !existsSync(FULL))("full ISB catalogue", () => {
  it("reads the whole supplier file", async () => {
    const { headers, rows, truncated } = await readSheet(readFileSync(FULL!), "Tyre Import");
    expect(headers).toHaveLength(33);
    expect(rows).toHaveLength(9559);
    expect(truncated).toBe(false);
    expect(new Set(rows.map((row) => row.cells.supplier_listing_key)).size).toBe(9559);
  });
});

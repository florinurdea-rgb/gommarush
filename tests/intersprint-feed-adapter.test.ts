import { describe, expect, it } from "vitest";
import {
  intersprintFeedAdapter,
  parseAvailability,
  parseLoadSpeed,
} from "@/lib/catalogue/intersprint-feed-adapter";
import { getAdapter, IMPORT_ADAPTERS } from "@/lib/catalogue/isb-adapter";
import {
  INTERSPRINT_PCR_ROWS,
  INTERSPRINT_PADDING_ROW,
  intersprintRow,
} from "./intersprint-feed-fixtures";

/**
 * The Inter-Sprint price and stock feed adapter.
 *
 * Fixtures are real rows from the `vrd-pcr` sample Antonello Moio supplied on
 * 5 August 2026, copied verbatim including the odd whitespace in `itemcode`
 * and the two spaces inside '>  20'. Four rows rather than 9,559: the point is
 * to pin the contract, not to commit a supplier's price list to the
 * repository.
 */

const ROW_12851 = INTERSPRINT_PCR_ROWS.nankang145R10;
const ROW_34197 = INTERSPRINT_PCR_ROWS.vredestein20555R16;
const ROW_538231 = INTERSPRINT_PCR_ROWS.bridgestone28535R20;

function normalize(cells: Record<string, string>, sourceRow = 2) {
  return intersprintFeedAdapter.normalizeRow(sourceRow, cells);
}

describe("price-bearing row parsing", () => {
  it("reads an exact nett-price", () => {
    const { normalized } = normalize(ROW_12851);
    expect(normalized?.purchasePrice).toBe(66.08);
  });

  it("reads prices across the file's real range without drift", () => {
    expect(normalize(ROW_34197).normalized?.purchasePrice).toBe(99.2);
    expect(normalize(ROW_538231).normalized?.purchasePrice).toBe(222.93);
  });

  /**
   * `gross` is Inter-Sprint's list/consumer price and is 0 on 2,227 of 9,559
   * rows. Mistaking it for our cost would price those tyres at pure markup on
   * nothing.
   */
  it("never takes `gross` as the purchase price", () => {
    const { normalized } = normalize(intersprintRow(ROW_34197, { gross: "143" }));
    expect(normalized?.purchasePrice).toBe(99.2);
    expect(normalized?.purchasePrice).not.toBe(143);
  });

  it("refuses a missing, zero or malformed price rather than inventing one", () => {
    for (const price of ["", "0", "0.00", "n/a", "1.2.3", "price"]) {
      const { normalized, validation } = normalize(intersprintRow(ROW_12851, { "nett-price": price }));
      expect(normalized?.purchasePrice, `price ${JSON.stringify(price)}`).toBeNull();
      expect(validation.reasons).toContain("PRICE_MISSING");
    }
  });

  /**
   * A leading '-' is how a spreadsheet starts a formula, so the injection
   * guard fires before the price is even looked at and the whole row is
   * rejected. That is a stronger refusal than "no price", and worth pinning
   * separately so nobody later "fixes" it into a soft validation reason.
   */
  it("rejects the whole row for a negative-looking price, as a formula", () => {
    const { normalized, validation } = normalize(intersprintRow(ROW_12851, { "nett-price": "-5" }));
    expect(normalized).toBeNull();
    expect(validation.result).toBe("rejected");
    expect(validation.errors[0]).toContain("FORMULA_IN_CELL");
  });

  it("accepts a comma decimal without changing the value", () => {
    const { normalized } = normalize(intersprintRow(ROW_12851, { "nett-price": "66,08" }));
    expect(normalized?.purchasePrice).toBe(66.08);
  });

  it("refuses a formula cell outright", () => {
    const { normalized, validation } = normalize(
      intersprintRow(ROW_12851, { "nett-price": "=1+1" })
    );
    expect(normalized).toBeNull();
    expect(validation.result).toBe("rejected");
    expect(validation.errors[0]).toContain("FORMULA_IN_CELL");
  });
});

describe("availability semantics", () => {
  it("keeps an exact count as an exact count", () => {
    const { normalized } = normalize(ROW_34197);
    expect(normalized?.stockRaw).toBe("6");
    expect(normalized?.stockExact).toBe(6);
    expect(normalized?.stockMinimum).toBe(6);
  });

  /** The whole point: '>  20' is a floor, not a quantity. */
  it("preserves '>  20' as a minimum and never as an exact value", () => {
    const { normalized } = normalize(ROW_12851);

    expect(normalized?.stockRaw).toBe(">  20");
    expect(normalized?.stockExact).toBeNull();
    expect(normalized?.stockMinimum).toBe(20);
    // The numbers a careless reader might have invented.
    expect(normalized?.stockExact).not.toBe(21);
    expect(normalized?.stockExact).not.toBe(50);
    expect(normalized?.stockExact).not.toBe(100);
  });

  it("tolerates any spacing in the band", () => {
    for (const raw of [">20", "> 20", ">  20", ">   20"]) {
      expect(parseAvailability(raw)).toEqual({ raw, exact: null, minimum: 20 });
    }
  });

  it("reports missing availability rather than assuming none in stock", () => {
    const { normalized, validation } = normalize(intersprintRow(ROW_12851, { available: "" }));
    expect(normalized?.stockRaw).toBeNull();
    expect(normalized?.stockExact).toBeNull();
    expect(normalized?.stockMinimum).toBeNull();
    expect(validation.reasons).toContain("AVAILABILITY_MISSING");
  });

  /** A zero the supplier actually states is a real answer and is kept. */
  it("keeps a stated zero as zero", () => {
    expect(parseAvailability("0")).toEqual({ raw: "0", exact: 0, minimum: 0 });
  });

  it("keeps an unrecognised form verbatim and understands nothing from it", () => {
    expect(parseAvailability("op aanvraag")).toEqual({
      raw: "op aanvraag",
      exact: null,
      minimum: null,
    });
  });
});

describe("supplier listing identity", () => {
  /**
   * Not a preference. Production's 9,559 listings carry
   * supplier_article_id = sysnr, and the sorted sysnr set of this feed hashes
   * to the same MD5 as the sorted supplier_article_id set already stored.
   */
  it("keys the listing on sysnr", () => {
    const { normalized } = normalize(ROW_12851);
    expect(normalized?.supplierArticleId).toBe("12851");
    expect(normalized?.supplierListingKey).toBe("ISB:12851");
  });

  it("preserves itemcode verbatim, including its internal spacing", () => {
    const { normalized } = normalize(ROW_12851);
    expect(normalized?.supplierItemCode).toBe("145    R 10TTR10");
  });

  it("rejects a row with no sysnr rather than inventing an identity", () => {
    const { normalized, validation } = normalize(intersprintRow(ROW_12851, { sysnr: "" }));
    expect(normalized).toBeNull();
    expect(validation.errors).toContain("MISSING_SYSNR");
  });

  /**
   * EAN identifies the TYRE. Nine EANs appear on more than one row in the
   * sample and twelve rows carry none, so it cannot key a supplier offer —
   * and a price and a stock figure belong to the offer.
   */
  it("uses EAN for the product key but never for listing identity", () => {
    const { normalized } = normalize(ROW_12851);
    expect(normalized?.productKey).toBe("GTIN:4717622044652");
    expect(normalized?.supplierListingKey).toBe("ISB:12851");
  });

  it("keeps the supplier listing identity when the EAN is absent", () => {
    const { normalized } = normalize(intersprintRow(ROW_12851, { eancode: "" }));
    expect(normalized?.supplierListingKey).toBe("ISB:12851");
    expect(normalized?.supplierArticleId).toBe("12851");
    // With no usable barcode the product falls back to the listing key.
    expect(normalized?.productKey).toBe("ISB:12851");
    expect(normalized?.ean).toBeNull();
  });

  /** Two listings of the same tyre must stay two listings. */
  it("gives two rows sharing an EAN two distinct listing identities", () => {
    const a = normalize(intersprintRow(ROW_12851, { sysnr: "12851" })).normalized;
    const b = normalize(intersprintRow(ROW_12851, { sysnr: "99999" })).normalized;

    expect(a?.productKey).toBe(b?.productKey);
    expect(a?.supplierListingKey).not.toBe(b?.supplierListingKey);
  });

  it("revalidates the barcode instead of trusting the feed", () => {
    const { normalized } = normalize(intersprintRow(ROW_12851, { eancode: "4717622044653" }));
    expect(normalized?.ean).toBeNull();
    expect(normalized?.scanReady).toBe(false);
    expect(normalized?.eanStatus).toBe("invalid_check_digit");
  });
});

describe("what the feed does not state is not invented", () => {
  /**
   * There is no season column. `group description` carries Dutch merchandising
   * groups; 'LUXE BANDEN M&S' hints at winter but 3PMSF is shared by winter
   * and all-season stock, and guessing would mislabel the catalogue.
   */
  it("leaves season and product class null and says so", () => {
    const { normalized, validation } = normalize(ROW_34197);
    expect(normalized?.season).toBeNull();
    expect(normalized?.productClass).toBeNull();
    expect(validation.reasons).toContain("CLASS_OR_SEASON_UNRESOLVED");
  });

  it("leaves XL and run-flat unknown rather than parsing marketing prose", () => {
    // The description literally contains 'XL'.
    expect(ROW_34197.description).toContain("XL");
    const { normalized } = normalize(ROW_34197);
    expect(normalized?.xl).toBeNull();
    expect(normalized?.runFlat).toBeNull();
  });

  it("treats a zero weight as absent, with provenance to match", () => {
    const { normalized } = normalize(ROW_538231);
    expect(ROW_538231.weight).toBe("0");
    expect(normalized?.weightKg).toBeNull();
    expect(normalized?.weightStatus).toBe("missing_or_zero");
  });

  it("keeps a real weight with supplier provenance", () => {
    const { normalized } = normalize(ROW_12851);
    expect(normalized?.weightKg).toBeCloseTo(6.031, 3);
    expect(normalized?.weightStatus).toBe("supplier_reported");
  });

  /** wcat is a supplier bucket, not kilograms. */
  it("keeps wcat as text and apart from the weight", () => {
    const { normalized } = normalize(ROW_12851);
    expect(normalized?.weightCategory).toBe("1");
  });
});

describe("dimensions", () => {
  it("reads the size tuple from the supplier's own columns", () => {
    const { normalized } = normalize(ROW_34197);
    expect(normalized?.widthMm).toBe(205);
    expect(normalized?.aspectRatio).toBe(55);
    expect(normalized?.rimInch).toBe(16);
  });

  it("splits LI/SI into load index and speed rating", () => {
    expect(parseLoadSpeed("94V")).toEqual({ raw: "94V", loadIndex: "94", speedRating: "V" });
    expect(parseLoadSpeed("104N")).toEqual({ raw: "104N", loadIndex: "104", speedRating: "N" });
  });

  it("leaves an unrecognised LI/SI unparsed but keeps the original", () => {
    const parsed = parseLoadSpeed("(94V)");
    expect(parsed.raw).toBe("(94V)");
    expect(parsed.loadIndex).toBeNull();
    expect(parsed.speedRating).toBeNull();
  });

  /**
   * The truck file writes 22.5" as '225'. It is kept as supplied and flagged;
   * dividing by ten into an integer column would store 22, a different tyre.
   */
  it("flags a truck rim rather than converting it", () => {
    const { normalized, validation } = normalize(intersprintRow(ROW_12851, { diameter: "225" }));
    expect(normalized?.rimInch).toBe(225);
    expect(validation.reasons).toContain("RIM_LOOKS_LIKE_TENTHS");
  });
});

describe("spreadsheet padding", () => {
  /**
   * The samples are saved out to Excel's full 1,048,576-row grid. 1,039,016
   * PCR rows carry a stray '20' in the nett-price column and nothing else.
   * Read as data they would each claim a EUR 20 tyre with no identity.
   */
  it("recognises a padding row", () => {
    expect(intersprintFeedAdapter.isPaddingRow(INTERSPRINT_PADDING_ROW)).toBe(true);
  });

  it("does not mistake a real row for padding", () => {
    expect(intersprintFeedAdapter.isPaddingRow(ROW_12851)).toBe(false);
  });

  it("would refuse the padding row's stray price even if it were normalised", () => {
    expect(INTERSPRINT_PADDING_ROW["nett-price"]).toBe("20");
    const { normalized, validation } = normalize(INTERSPRINT_PADDING_ROW);
    expect(normalized).toBeNull();
    expect(validation.errors).toContain("MISSING_SYSNR");
  });
});

describe("sheet resolution", () => {
  it("finds the sample sheets by suffix, ignoring the account prefix", () => {
    expect(intersprintFeedAdapter.resolveSheetName(["vrd-pcr"])).toBe("vrd-pcr");
    expect(intersprintFeedAdapter.resolveSheetName(["vrd-truck"])).toBe("vrd-truck");
    expect(intersprintFeedAdapter.resolveSheetName(["gorush-pcr"])).toBe("gorush-pcr");
  });

  it("accepts a single-sheet workbook whose name we do not recognise", () => {
    expect(intersprintFeedAdapter.resolveSheetName(["Sheet1"])).toBe("Sheet1");
  });

  it("refuses to guess between several unrecognised sheets", () => {
    expect(intersprintFeedAdapter.resolveSheetName(["Sheet1", "Notes"])).toBeNull();
  });
});

describe("adapter registration", () => {
  it("is reachable by id alongside the pre-normalised ISB adapter", () => {
    expect(getAdapter("intersprint-feed")).toBe(intersprintFeedAdapter);
    expect(Object.keys(IMPORT_ADAPTERS)).toContain("isb");
    expect(Object.keys(IMPORT_ADAPTERS)).toContain("intersprint-feed");
  });

  it("requires only the identity and commercial columns", () => {
    expect([...intersprintFeedAdapter.requiredColumns]).toEqual([
      "sysnr",
      "itemcode",
      "nett-price",
      "available",
    ]);
  });
});

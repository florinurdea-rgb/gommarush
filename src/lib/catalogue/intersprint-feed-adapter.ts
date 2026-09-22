import { looksLikeFormula } from "@/lib/catalogue/xlsx-reader";
import { isScannable, validateGtin } from "@/lib/catalogue/gtin";
import { readIntersprintCsv } from "@/lib/suppliers/intersprint/feed/csv-reader";
import type {
  NormalizedCatalogueRow,
  NormalizedRowOutcome,
  RowValidation,
  SupplierImportAdapter,
  WeightStatus,
} from "@/lib/types/catalogue";

// Inter-Sprint PRICE AND STOCK FEED adapter.
//
// This is the format Inter-Sprint actually delivers: the `vrd-pcr` and
// `vrd-truck` files Antonello Moio supplied on 5 August 2026 as samples of
// what their integration places on our FTP folder. Its columns are the
// supplier's own — `sysnr`, `itemcode`, `nett-price`, `available` — and
// nothing has been renamed on the way in.
//
// It is SEPARATE from `isb-adapter.ts`, which reads an already-normalised
// workbook whose columns (`supplier_listing_key`, `width_mm`, `season`) do not
// exist in any file Inter-Sprint sends. That adapter built the catalogue we
// have; this one reads the supplier's real feed. Both write the same
// normalised row, so there is exactly one commercial mapping downstream.
//
// WHY THIS MATTERS COMMERCIALLY: the existing 9,559 listings carry no price
// and no stock, and the reason is simply that the pre-normalised workbook
// dropped those two columns. They are present on every row of the real feed.
//
// Pure: no database, no I/O, fully unit-testable.

/**
 * Columns without which this is not an Inter-Sprint feed.
 *
 * Only the four that carry identity and commerce. Everything else is optional
 * because the truck file legitimately omits `wcat`, and a supplier adding or
 * dropping a descriptive column must not stop a price refresh.
 */
const REQUIRED_COLUMNS = ["sysnr", "itemcode", "nett-price", "available"] as const;

/**
 * The column that distinguishes the PCR feed from the truck feed.
 *
 * VERIFIED in both the August samples and the September production headers:
 * the PCR file carries `wcat` (Inter-Sprint's weight bucket) and the truck
 * file does not.
 *
 * Deliberately NOT the filename. Production delivers
 * `vrd-001-21185-107.csv` (PCR) and `vrd-001-21185.csv` (truck) — the truck
 * name is a STRICT PREFIX of the PCR name, so any startsWith/includes match
 * classifies PCR as truck and applies a minimum release of 10 instead of 60.
 */
const PCR_ONLY_COLUMN = "wcat";

/**
 * Sheet names seen in the supplied samples.
 *
 * Matched by SUFFIX, not exactly. The `vrd-` prefix is unexplained — it is
 * presumably an Inter-Sprint account or route code, and we have no document
 * saying it will be `vrd` for GommaRush's own files. Hard-coding it would mean
 * the first real FTP delivery fails to open for a reason nobody could guess.
 */
const SHEET_SUFFIXES = ["pcr", "truck"] as const;

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A positive integer, or null. Never rounds, never coerces a decimal. */
function positiveInteger(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * A positive decimal price.
 *
 * The feed writes a POINT decimal separator ('66.08'). A comma is accepted too
 * because the same values pass through spreadsheet software on the way to us
 * and locale settings are not ours to control, but anything else is refused
 * rather than coerced: a price is the one field where a silent reinterpretation
 * is unaffordable.
 */
function positiveDecimal(value: string | undefined): number | null {
  const trimmed = value?.trim().replace(",", ".");
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Inter-Sprint ships 'J'/'N' — ja/nee, Dutch for yes/no. */
function dutchBoolean(value: string | undefined): boolean | null {
  const upper = value?.trim().toUpperCase();
  if (upper === "J") return true;
  if (upper === "N") return false;
  return null;
}

/**
 * Availability, preserving exactly what the supplier said.
 *
 * The feed uses two forms, and the difference between them is commercial:
 *
 *   '8'      an exact count of 8.
 *   '>  20'  at least 21, quantity not disclosed. 7,991 of 9,559 PCR rows.
 *
 * A band sets `minimum` and leaves `exact` NULL. Resolving '>  20' into 21, 50
 * or 100 would be inventing stock the supplier never promised — and because
 * the band is the MOST common value in the file, that invention would be on
 * the majority of the catalogue.
 *
 * An exact count sets both: 8 in stock is also at least 8.
 *
 * Note the literal spacing: the feed writes '>' then two spaces then the
 * number. The pattern tolerates any spacing rather than depending on it.
 */
export function parseAvailability(value: string | undefined): {
  raw: string | null;
  exact: number | null;
  minimum: number | null;
} {
  const raw = value?.trim() ? value.trim() : null;
  if (!raw) return { raw: null, exact: null, minimum: null };

  if (/^\d+$/.test(raw)) {
    const count = Number(raw);
    if (!Number.isSafeInteger(count)) return { raw, exact: null, minimum: null };
    return { raw, exact: count, minimum: count };
  }

  const band = /^>\s*(\d+)$/.exec(raw);
  if (band) {
    const floor = Number(band[1]);
    return Number.isSafeInteger(floor)
      ? { raw, exact: null, minimum: floor }
      : { raw, exact: null, minimum: null };
  }

  // Anything else is kept verbatim and understood as nothing. A form we have
  // not seen is not a number to guess at.
  return { raw, exact: null, minimum: null };
}

/**
 * Splits Inter-Sprint's 'LI/SI' column, e.g. '104N' or '116N'.
 *
 * Load index is 2-3 digits, speed rating the trailing letters. A value that
 * does not match is left unparsed rather than cut at a fixed offset — the
 * catalogue already contains load/speed combinations that a naive split would
 * mangle, and `loadSpeedRaw` preserves the original either way.
 */
export function parseLoadSpeed(value: string | undefined): {
  raw: string | null;
  loadIndex: string | null;
  speedRating: string | null;
} {
  const raw = text(value);
  if (!raw) return { raw: null, loadIndex: null, speedRating: null };

  const match = /^(\d{2,3})\s*([A-Z]{1,2})$/.exec(raw.toUpperCase());
  if (!match) return { raw, loadIndex: null, speedRating: null };
  return { raw, loadIndex: match[1], speedRating: match[2] };
}

export class IntersprintFeedAdapter implements SupplierImportAdapter {
  readonly id = "intersprint-feed";
  readonly label = "Inter-Sprint price & stock feed";
  /** The PCR sample's sheet. `resolveSheetName` is what actually selects one. */
  readonly sheetName = "vrd-pcr";
  readonly requiredColumns = REQUIRED_COLUMNS;

  /**
   * Picks the feed sheet out of a workbook.
   *
   * Each sample holds exactly one sheet, named for the file. Matching on the
   * `-pcr` / `-truck` suffix keeps the unexplained account prefix from
   * deciding whether the import works.
   */
  resolveSheetName(available: readonly string[]): string | null {
    for (const suffix of SHEET_SUFFIXES) {
      const match = available.find(
        (name) =>
          name.trim().toLowerCase() === suffix ||
          name.trim().toLowerCase().endsWith(`-${suffix}`)
      );
      if (match) return match;
    }
    // A single-sheet workbook whose name we do not recognise is still almost
    // certainly the feed; refusing it would be pedantry, and every row is
    // validated individually anyway.
    return available.length === 1 ? available[0] : null;
  }

  /**
   * True for a row that is spreadsheet padding rather than data.
   *
   * The supplied samples are saved out to Excel's full 1,048,576-row grid.
   * Rows past the data carry a stray '20' in the `nett-price` column and
   * nothing else — 1,039,016 of them in the PCR file. They are not malformed
   * data to be reported; they are not data at all, and staging a million
   * rejection records for them would bury the real errors.
   *
   * The test is identity: no `sysnr` and no `itemcode` means no listing.
   */
  isPaddingRow(cells: Record<string, string>): boolean {
    return !text(cells.sysnr) && !text(cells.itemcode);
  }

  /**
   * Reads the real production delivery, which is semicolon-delimited CSV.
   *
   * Delegates to the M9 reader, which detects the dialect against the verified
   * column contract and refuses what it cannot prove. The importer calls this
   * only when the bytes are not a workbook; the XLSX path is unchanged.
   */
  readDelimitedText(text: string): {
    headers: string[];
    rows: { sourceRow: number; cells: Record<string, string> }[];
    malformedLines: number[];
    paddingLines: number;
  } {
    const result = readIntersprintCsv(text);
    return {
      headers: [...result.headers],
      rows: result.rows.map((row) => ({
        sourceRow: row.sourceRow,
        cells: { ...row.cells },
      })),
      malformedLines: [...result.malformedLines],
      paddingLines: result.paddingLines,
    };
  }

  /**
   * Which Inter-Sprint feed a header belongs to.
   *
   * Content, not filename — see PCR_ONLY_COLUMN. Returns null when the header
   * is recognisably a feed but carries no category signal, so the caller can
   * decide rather than being handed a guess.
   */
  detectCategory(headers: readonly string[]): "pcr" | "truck" | null {
    const present = new Set(headers.map((header) => header.trim()));
    if (!present.has("sysnr") || !present.has("nett-price")) return null;
    return present.has(PCR_ONLY_COLUMN) ? "pcr" : "truck";
  }

  normalizeRow(sourceRow: number, cells: Record<string, string>): NormalizedRowOutcome {
    const raw = { ...cells };
    const errors: string[] = [];
    const reasons: string[] = [];

    for (const [column, value] of Object.entries(cells)) {
      if (looksLikeFormula(value)) {
        errors.push(`FORMULA_IN_CELL:${column}`);
        break;
      }
    }

    // --- supplier listing identity ----------------------------------------
    //
    // `sysnr` is the identity, and this is not a preference. Production's
    // 9,559 listings carry supplier_article_id = sysnr and supplier_item_code
    // = itemcode, and the sorted sysnr set of this feed hashes to exactly the
    // same MD5 as the sorted supplier_article_id set already stored. The
    // existing catalogue was built from this feed family, keyed this way.
    //
    // `eancode` is NOT the identity even though it is nearly unique: 9 EANs
    // appear on more than one row and 12 rows have none. An EAN identifies the
    // TYRE; sysnr identifies Inter-Sprint's offer of it, which is what a
    // purchase order and a stock figure belong to.
    //
    // `ip-code` is not the identity either — 24 duplicates and 15 blanks.
    const sysnr = text(cells.sysnr);
    const itemcode = text(cells.itemcode);

    if (!sysnr) errors.push("MISSING_SYSNR");
    if (!itemcode) reasons.push("ITEMCODE_MISSING");

    if (errors.length > 0) {
      return {
        sourceRow,
        raw,
        normalized: null,
        validation: { result: "rejected", errors, reasons: [] },
      };
    }

    const supplierListingKey = `ISB:${sysnr}`;

    // --- barcode: revalidated here, never taken on the feed's word --------
    const gtin = validateGtin(cells.eancode);
    const scanReady = isScannable(gtin.status);
    if (gtin.status === "missing") reasons.push("EAN_MISSING");
    if (gtin.status === "invalid_check_digit") {
      reasons.push(`EAN_INVALID:${gtin.reason ?? "CHECK_DIGIT_MISMATCH"}`);
    }

    // --- dimensions -------------------------------------------------------
    //
    // `diameter` is the rim, and for truck tyres the feed writes 22.5" as
    // '225'. It is stored as supplied and flagged, never divided by ten: the
    // catalogue's rim_inch is an integer column, and a 225 that silently
    // became 22 would be a different tyre.
    const widthMm = positiveInteger(cells["width tyre"]);
    const aspectRatio = positiveInteger(cells["aspect ratio"]);
    const rimInch = positiveInteger(cells.diameter);
    if (widthMm === null || aspectRatio === null || rimInch === null) {
      reasons.push("DIMENSIONS_INCOMPLETE");
    }
    if (rimInch !== null && rimInch > 30) reasons.push("RIM_LOOKS_LIKE_TENTHS");

    const loadSpeed = parseLoadSpeed(cells["LI/SI"]);
    if (!loadSpeed.loadIndex || !loadSpeed.speedRating) reasons.push("LI_SI_UNPARSED");

    // --- weight -----------------------------------------------------------
    // Present on every sample row, and it is the supplier's own figure, so it
    // carries `supplier_reported` provenance. Zero or absent is not a weight.
    const weightValue = positiveDecimal(cells.weight);
    const weightStatus: WeightStatus =
      weightValue !== null ? "supplier_reported" : "missing_or_zero";
    if (weightValue === null) reasons.push("WEIGHT_MISSING");

    // --- season and class: NOT STATED BY THIS FEED ------------------------
    //
    // There is no season column and no vehicle-class column. `group
    // description` carries Dutch merchandising groups ('LUXE BANDEN',
    // 'BESTELWAGEN BANDEN', '4 X 4', 'TRUCKBANDEN') which describe the segment
    // and say nothing about summer, winter or all-season. `Snowgrip` is a
    // 3PMSF marking, which winter and many all-season tyres share.
    //
    // So both are left null and the row is flagged. This is safe on re-import:
    // the commit function coalesces every product field, so a null here can
    // never erase the 9,052 seasons the catalogue already holds. Deriving a
    // season from a marketing group would be exactly the invention CLAUDE.md
    // forbids, and it would be wrong on all-season stock in particular.
    reasons.push("CLASS_OR_SEASON_UNRESOLVED");

    // --- commercial data: the point of this adapter -----------------------
    //
    // `nett-price` is carried as the supplier price observation. Whether it is
    // the price Go Rush actually pays — after any account discount, and with
    // or without transport — is NOT stated anywhere in the feed, and the
    // downstream observation layer is what decides commercial usability.
    //
    // `gross` is Inter-Sprint's own list/consumer price (0 on 2,227 rows). It
    // is not a cost to us and is deliberately not mapped to purchasePrice.
    const purchasePrice = positiveDecimal(cells["nett-price"]);
    if (purchasePrice === null) reasons.push("PRICE_MISSING");

    const availability = parseAvailability(cells.available);
    if (availability.raw === null) reasons.push("AVAILABILITY_MISSING");

    const productKey =
      scanReady && gtin.normalized ? `GTIN:${gtin.normalized}` : supplierListingKey;

    const normalized: NormalizedCatalogueRow = {
      sourceRow,

      supplierListingKey,
      supplierArticleId: sysnr!,
      supplierItemCode: itemcode,
      // The feed proposes no product key of its own.
      sourceProductKey: null,
      productKey,

      ean: gtin.normalized,
      eanRaw: gtin.raw,
      eanStatus: gtin.status,

      // 'ip-code' is Inter-Sprint's manufacturer/reference code.
      manufacturerProductCode: text(cells["ip-code"]),
      brandCode: text(cells.brand),
      brand: text(cells["brand description"]),
      // The feed has no separate pattern column; 'Type' is the pattern code.
      modelPattern: text(cells.Type),
      description: text(cells.description),

      productClass: null,
      season: null,

      widthMm,
      aspectRatio,
      rimInch,
      // The feed states no assembled size string; the catalogue keeps its own.
      sizeDisplay: null,

      loadSpeedRaw: loadSpeed.raw,
      loadIndex: loadSpeed.loadIndex,
      speedRating: loadSpeed.speedRating,

      // Not stated as flags. XL and run-flat appear inside the description
      // text ('... XL', '... RFT'), and parsing marketing prose into a boolean
      // that drives fitment is not something this adapter will guess at.
      xl: null,
      runFlat: null,
      oldDot: false,

      weightKg: weightValue,
      weightStatus,
      // Inter-Sprint's 'wcat' bucket. Present on the PCR file, absent on the
      // truck file. TEXT, and explicitly NOT kilograms.
      weightCategory: text(cells.wcat),

      eMark: text(cells["E-mark"]),
      european: dutchBoolean(cells.European),
      eprelId: text(cells["EPREL-id"]),

      scanReady,
      reviewRequired: reasons.length > 0,
      reviewReasons: reasons,

      purchasePrice,
      stockRaw: availability.raw,
      stockExact: availability.exact,
      stockMinimum: availability.minimum,
    };

    const validation: RowValidation = {
      result: reasons.length > 0 ? "review" : "valid",
      errors: [],
      reasons,
    };

    return { sourceRow, raw, normalized, validation };
  }
}

export const intersprintFeedAdapter = new IntersprintFeedAdapter();

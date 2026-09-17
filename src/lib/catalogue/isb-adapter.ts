import { looksLikeFormula } from "@/lib/catalogue/xlsx-reader";
import { isScannable, validateGtin } from "@/lib/catalogue/gtin";
import type {
  NormalizedCatalogueRow,
  NormalizedRowOutcome,
  RowValidation,
  SupplierImportAdapter,
  WeightStatus,
} from "@/lib/types/catalogue";

// ISB catalogue adapter.
//
// Owns everything ISB-specific and nothing else: their column names, their
// Dutch 'J'/'N' booleans, their '0'/'1' flags, their ';'-separated review
// reasons and their group-derived class/season. The catalogue service below
// this never sees any of it.
//
// One rule runs through the whole file: THE SOURCE IS EVIDENCE, NOT AUTHORITY.
// The file ships its own `ean_status` and `scan_ready` columns, and both are
// ignored — every barcode is revalidated here against its own check digit.
// A supplier who ships a wrong flag should not be able to make a bad barcode
// scannable in our warehouse just by asserting that it is.
//
// Pure: no database, no I/O, fully unit-testable.

/** Columns without which the file is not an ISB catalogue at all. */
const REQUIRED_COLUMNS = [
  "supplier_listing_key",
  "supplier_article_id",
  "ean",
  "brand",
  "width_mm",
  "aspect_ratio",
  "rim_inch",
  "weight_kg",
  "weight_status",
] as const;

/** ISB ships '0'/'1'. Anything else is not a boolean and stays unknown. */
function flag(value: string | undefined): boolean | null {
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

/** ISB ships 'J'/'N' — ja/nee. */
function dutchBoolean(value: string | undefined): boolean | null {
  const upper = value?.trim().toUpperCase();
  if (upper === "J") return true;
  if (upper === "N") return false;
  return null;
}

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

/** A positive decimal, accepting a comma decimal separator. */
function positiveDecimal(value: string | undefined): number | null {
  const trimmed = value?.trim().replace(",", ".");
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * ISB writes 'WEIGHT_MISSING;CLASS_OR_SEASON_UNRESOLVED'. The pipe is
 * tolerated too, because the first file we were handed used one in its
 * documentation and the cost of accepting both is nil.
 */
function splitReasons(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[;|]/)
    .map((reason) => reason.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * ISB's stock column carries thresholds like '>20'. An exact count is only
 * recorded when the value is unambiguously a number; a threshold keeps its
 * raw text and sets a minimum instead. Reading '>20' as 20 would be a lie in
 * the safe direction only by accident.
 */
function parseStock(value: string | undefined): {
  raw: string | null;
  exact: number | null;
  minimum: number | null;
} {
  const raw = text(value);
  if (!raw) return { raw: null, exact: null, minimum: null };
  if (/^\d+$/.test(raw)) return { raw, exact: Number(raw), minimum: Number(raw) };
  const threshold = /^>=?\s*(\d+)$/.exec(raw);
  if (threshold) return { raw, exact: null, minimum: Number(threshold[1]) };
  return { raw, exact: null, minimum: null };
}

const KNOWN_SEASONS = new Set(["summer", "winter", "all_season"]);

export class ISBImportAdapter implements SupplierImportAdapter {
  readonly id = "isb";
  readonly label = "ISB";
  readonly sheetName = "Tyre Import";
  readonly requiredColumns = REQUIRED_COLUMNS;

  normalizeRow(sourceRow: number, cells: Record<string, string>): NormalizedRowOutcome {
    const raw = { ...cells };
    const errors: string[] = [];
    const reasons: string[] = [];

    // A catalogue cell that a spreadsheet would execute is not a catalogue
    // cell. We never evaluate anything, but a value in this shape means the
    // file is not what it claims to be, so the row does not get imported.
    for (const [column, value] of Object.entries(cells)) {
      if (looksLikeFormula(value)) {
        errors.push(`FORMULA_IN_CELL:${column}`);
        break;
      }
    }

    const supplierListingKey = text(cells.supplier_listing_key);
    const supplierArticleId = text(cells.supplier_article_id);

    if (!supplierListingKey) errors.push("MISSING_SUPPLIER_LISTING_KEY");
    if (!supplierArticleId) errors.push("MISSING_SUPPLIER_ARTICLE_ID");
    if (supplierListingKey && !/^ISB:[A-Za-z0-9._-]+$/.test(supplierListingKey)) {
      errors.push("MALFORMED_SUPPLIER_LISTING_KEY");
    }

    if (errors.length > 0) {
      return {
        sourceRow,
        raw,
        normalized: null,
        validation: { result: "rejected", errors, reasons: [] },
      };
    }

    // --- barcode: revalidated here, never taken on the file's word --------
    const gtin = validateGtin(cells.ean);
    const scanReady = isScannable(gtin.status);
    if (gtin.status === "missing") reasons.push("EAN_MISSING");
    if (gtin.status === "invalid_check_digit") {
      reasons.push(`EAN_INVALID:${gtin.reason ?? "CHECK_DIGIT_MISMATCH"}`);
    }

    // Provenance, which validation alone cannot recover.
    //
    // ISB ships the ALREADY-RECOVERED barcode in the `ean` column: the 32
    // leading-zero repairs arrive as finished 12-digit codes, so revalidating
    // them here quite correctly says "valid" and the fact that a digit was
    // restored upstream would be lost. So the file is allowed to tell us HOW
    // a code came to be — never WHETHER it is good. If our own check digit
    // disagrees, the file's claim is discarded with it.
    const declaredEanStatus = text(cells.ean_status);
    const eanStatus =
      gtin.status === "valid" && declaredEanStatus === "recovered_leading_zero"
        ? "recovered_leading_zero"
        : gtin.status;
    if (eanStatus === "recovered_leading_zero") reasons.push("EAN_LEADING_ZERO_RECOVERED");

    // --- weight: zero is missing, and a weight must declare its source ----
    const declaredWeightStatus = text(cells.weight_status);
    const weightValue = positiveDecimal(cells.weight_kg);
    const supplierReported = declaredWeightStatus === "supplier_reported" && weightValue !== null;
    const weightKg = supplierReported ? weightValue : null;
    const weightStatus: WeightStatus = supplierReported ? "supplier_reported" : "missing_or_zero";
    if (!supplierReported) reasons.push("WEIGHT_MISSING");

    // --- dimensions -------------------------------------------------------
    const widthMm = positiveInteger(cells.width_mm);
    const aspectRatio = positiveInteger(cells.aspect_ratio);
    const rimInch = positiveInteger(cells.rim_inch);
    if (widthMm === null || aspectRatio === null || rimInch === null) {
      reasons.push("DIMENSIONS_INCOMPLETE");
    }

    const rawSeason = text(cells.season);
    const season = rawSeason && KNOWN_SEASONS.has(rawSeason) ? rawSeason : null;
    const productClass = text(cells.product_class);
    if (!season || !productClass) reasons.push("CLASS_OR_SEASON_UNRESOLVED");

    const loadIndex = text(cells.load_index);
    const speedRating = text(cells.speed_rating);
    if (!loadIndex || !speedRating) reasons.push("LI_SI_UNPARSED");

    // The file's own reasons are kept alongside ours: they explain what the
    // upstream normaliser already knew, and dropping them loses provenance.
    for (const reason of splitReasons(cells.review_reasons)) {
      if (!reasons.includes(reason)) reasons.push(reason);
    }

    const stock = parseStock(cells.stock_raw ?? cells.available);

    // Our own product key, derived from what actually validated — not the
    // file's `product_key` column, which is kept separately for audit.
    const productKey = scanReady && gtin.normalized
      ? `GTIN:${gtin.normalized}`
      : supplierListingKey!;

    const normalized: NormalizedCatalogueRow = {
      sourceRow,
      supplierListingKey: supplierListingKey!,
      supplierArticleId: supplierArticleId!,
      supplierItemCode: text(cells.supplier_item_code),
      sourceProductKey: text(cells.product_key),
      productKey,

      ean: gtin.normalized,
      eanRaw: gtin.raw,
      eanStatus,

      manufacturerProductCode: text(cells.manufacturer_product_code),
      brandCode: text(cells.brand_code),
      brand: text(cells.brand),
      modelPattern: text(cells.model_pattern),
      description: text(cells.description),

      productClass,
      season,

      widthMm,
      aspectRatio,
      rimInch,
      sizeDisplay: text(cells.size_display),

      loadSpeedRaw: text(cells.load_speed_raw),
      loadIndex,
      speedRating,

      xl: flag(cells.xl),
      runFlat: flag(cells.run_flat),
      oldDot: flag(cells.old_dot) === true,

      weightKg,
      weightStatus,
      weightCategory: text(cells.weight_category),

      eMark: text(cells.e_mark),
      european: dutchBoolean(cells.european),
      eprelId: text(cells.eprel_id),

      scanReady,
      reviewRequired: reasons.length > 0,
      reviewReasons: reasons,

      purchasePrice: positiveDecimal(cells.purchase_price ?? cells["nett-price"]),
      stockRaw: stock.raw,
      stockExact: stock.exact,
      stockMinimum: stock.minimum,
    };

    const validation: RowValidation = {
      result: reasons.length > 0 ? "review" : "valid",
      errors: [],
      reasons,
    };

    return { sourceRow, raw, normalized, validation };
  }
}

export const isbAdapter = new ISBImportAdapter();

/** Every adapter the importer knows about, by id. */
export const IMPORT_ADAPTERS: Record<string, SupplierImportAdapter> = {
  [isbAdapter.id]: isbAdapter,
};

export function getAdapter(id: string): SupplierImportAdapter | null {
  return IMPORT_ADAPTERS[id] ?? null;
}

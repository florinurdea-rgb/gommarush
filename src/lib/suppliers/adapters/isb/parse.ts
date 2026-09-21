/**
 * Inter-Sprint (ISB) catalogue row parser.
 *
 * AUTHORITY: this parser is written against the REAL ISB rows already ingested
 * into production (`catalogue_import_rows.raw_payload`, import run
 * `GommaRush_ISB_Tyre_Catalogue_Import-3.xlsx`, 9,559 rows committed
 * 2026-09-08). Under the precedence rule in CLAUDE.md section 0, a proven
 * production fact outranks the specification, and no Inter-Sprint protocol
 * documentation is available in this repository. Nothing here is inferred from
 * undocumented protocol behaviour.
 *
 * Verified field domains observed across all 9,559 production rows:
 *   data_status       NEEDS_EAN | NEEDS_EAN_AND_WEIGHT | NEEDS_WEIGHT | READY | REVIEW_REQUIRED
 *   product_class     light_truck_van | motorcycle | old_dot | passenger_car |
 *                     passenger_car_runflat | scooter | spare | suv_4x4
 *   season            all_season | not_applicable | summer | winter
 *   weight_status     missing_or_zero | supplier_reported
 *   weight_category   1 | 2 | 3 | 4
 *   european          J | N
 *   booleans          "0" / "1" (xl, run_flat, old_dot, scan_ready, import_ready,
 *                     review_required, enrichment_needed)
 *   product_key       GTIN:<ean> when trustworthy, else ISB:<article_id>
 *   supplier_listing_key  ISB:<article_id>
 *
 * The ISB catalogue file carries NO price and NO stock columns. Every offer
 * this parser emits therefore has purchasePriceNet = null and stockStatus =
 * "unknown". That is a fact about the feed, not a defect — unknown is better
 * than invented.
 */

import { resolveEan, deriveProductKey } from "../../ean";
import type { ParseOutcome, SupplierOffer } from "../../types";

export const ISB_LANE_CODE = "intersprint";
export const ISB_KEY_PREFIX = "ISB";

/** Raw ISB row: every value arrives as a string from the spreadsheet export. */
export type IsbRawRow = Record<string, unknown>;

function text(row: IsbRawRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** ISB booleans are "0"/"1". Anything else is unknown, not false. */
function bool(row: IsbRawRow, key: string): boolean | null {
  const value = text(row, key);
  if (value === null) return null;
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

function int(row: IsbRawRow, key: string): number | null {
  const value = text(row, key);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function decimal(row: IsbRawRow, key: string): number | null {
  const value = text(row, key);
  if (value === null) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** `european` is the string "J"/"N" (ja/nee), not a 0/1 boolean. */
function jaNee(row: IsbRawRow, key: string): boolean | null {
  const value = text(row, key);
  if (value === null) return null;
  if (value.toUpperCase() === "J") return true;
  if (value.toUpperCase() === "N") return false;
  return null;
}

export interface IsbParseOptions {
  isTestData: boolean;
  observedAt: string;
}

/**
 * Parse one ISB row.
 *
 * A row is REJECTED only when it lacks the supplier article identifier, which
 * is the one field without which the row cannot be addressed at all. Every
 * other quality problem is recorded as a review reason and the row is still
 * ingested — matching production's behaviour, where 9,559 of 9,559 rows were
 * accepted and 1,726 products were flagged for review rather than dropped.
 */
export function parseIsbRow(
  row: IsbRawRow,
  options: IsbParseOptions,
): ParseOutcome {
  const sourceRow = int(row, "source_row");
  const supplierArticleId = text(row, "supplier_article_id");

  if (!supplierArticleId) {
    return {
      ok: false,
      sourceRow,
      errors: ["MISSING_SUPPLIER_ARTICLE_ID"],
      raw: row,
    };
  }

  const ean = resolveEan(row["ean"]);
  const reviewReasons = [...ean.reasons];

  const { productKey, provisional } = deriveProductKey({
    ean: ean.ean,
    eanStatus: ean.status,
    lanePrefix: ISB_KEY_PREFIX,
    supplierArticleId,
  });
  if (provisional) reviewReasons.push("PROVISIONAL_NO_VALID_EAN");

  const widthMm = int(row, "width_mm");
  const aspectRatio = int(row, "aspect_ratio");
  const rimInch = int(row, "rim_inch");
  if (widthMm === null || aspectRatio === null || rimInch === null) {
    reviewReasons.push("DIMENSIONS_INCOMPLETE");
  }

  const weightKg = decimal(row, "weight_kg");
  const weightStatus = text(row, "weight_status");
  if (weightStatus !== "supplier_reported" || weightKg === null) {
    reviewReasons.push("WEIGHT_MISSING");
  }

  const productClass = text(row, "product_class");
  const season = text(row, "season");
  if (!productClass || !season) {
    reviewReasons.push("CLASS_OR_SEASON_UNRESOLVED");
  }

  if (text(row, "service_description_status") === "not_applicable_nhs") {
    reviewReasons.push("LI_SI_UNPARSED");
  }

  const offer: SupplierOffer = {
    supplierLaneCode: ISB_LANE_CODE,
    supplierArticleId,
    supplierItemCode: text(row, "supplier_item_code"),
    supplierListingKey:
      text(row, "supplier_listing_key") ?? `${ISB_KEY_PREFIX}:${supplierArticleId}`,

    ean: ean.ean,
    eanStatus: ean.status,
    productKey,
    productHints: {
      brand: text(row, "brand"),
      brandCode: text(row, "brand_code"),
      modelPattern: text(row, "model_pattern"),
      description: text(row, "description"),
      productClass,
      season,
      widthMm,
      aspectRatio,
      rimInch,
      sizeDisplay: text(row, "size_display"),
      loadSpeedRaw: text(row, "load_speed_raw"),
      loadIndex: text(row, "load_index"),
      speedRating: text(row, "speed_rating"),
      xl: bool(row, "xl"),
      runFlat: bool(row, "run_flat"),
      oldDot: bool(row, "old_dot"),
      weightKg: weightStatus === "supplier_reported" ? weightKg : null,
      weightCategory: text(row, "weight_category"),
      eMark: text(row, "e_mark"),
      european: jaNee(row, "european"),
      manufacturerProductCode: text(row, "manufacturer_product_code"),
    },

    // The ISB catalogue feed carries neither price nor stock.
    purchasePriceNet: null,
    currency: "EUR",
    stockExact: null,
    stockStatus: "unknown",
    stockConfidence: "unknown",
    leadTimeDays: null,
    deliveryClass: "unknown",

    observedAt: options.observedAt,
    priceVerifiedAt: null,
    stockVerifiedAt: null,

    sourceType: "file_import",
    isTestData: options.isTestData,

    pfu: { amount: null, status: "TO_CONFIRM", source: null },
    dotCode: null,

    reviewReasons: Array.from(new Set(reviewReasons)),
    raw: row,
  };

  return { ok: true, offer };
}

export function parseIsbRows(
  rows: readonly IsbRawRow[],
  options: IsbParseOptions,
): ParseOutcome[] {
  return rows.map((row) => parseIsbRow(row, options));
}

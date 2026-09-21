// Deldo price & stock feed — row mapping.
//
// THE COLUMN CONTRACT IS THE FILE. Deldo's API documentation deliberately does
// not describe the columns: "Step 1: we send you 1 file in CSV format so that
// you can examine file header and structure". So every column meaning below
// was read off the supplier's own sample, 26933TEST.csv (6,729 rows), and the
// evidence is recorded beside each non-obvious decision. Nothing here is
// inferred from another supplier's feed.
//
// Output is the SHARED NormalizedCatalogueRow that the ISB adapter already
// produces. Deldo does not get a parallel product model — it gets a lane into
// the existing one.
//
// Two rules run through the file:
//
//   1. COMMERCIAL FIELDS ARE STRICT. Price and stock either parse exactly or
//      the row is rejected. There is no lenient path to a number that will end
//      up in a purchase order.
//
//   2. DESCRIPTIVE FIELDS ARE CONSERVATIVE. A dimension that does not parse
//      cleanly becomes null with a review reason, never a guess. A wrong
//      aspect ratio is a cosmetic defect; a wrong price is a financial one.

import { validateGtin } from "@/lib/catalogue/gtin";
import type {
  NormalizedCatalogueRow,
  NormalizedRowOutcome,
  RowValidation,
} from "@/lib/types/catalogue";

/**
 * The verified header, exactly as it appears in 26933TEST.csv: 35 columns,
 * ';'-delimited, in this order. The reader requires an exact match, so a
 * supplier-side column change fails the import loudly instead of shifting
 * every field by one.
 */
export const DELDO_FEED_COLUMNS = [
  "Article",
  "Brand",
  "Width",
  "Height",
  "Speed",
  "Rim",
  "Loadindex",
  "Pattern",
  "Spec",
  "PR/RF",
  "Demo",
  "Dot",
  "Extra",
  "Quality",
  "Vehicle",
  "Stock",
  "Price",
  "Discount",
  "EAN",
  "IPCODE",
  "Fuel",
  "Wet",
  "Noise",
  "Decibel",
  "C Class",
  "URL_Pattern",
  "Per parcel",
  "RFT",
  "Eprel_code",
  "Eprel_RR",
  "Eprel_Wet",
  "Eprel_Noise",
  "Eprel_decibel",
  "Eprel_severe_snow",
  "Eprel_Ice_Tyre",
] as const;

export const DELDO_FEED_DELIMITER = ";";

/** Prefix for supplier_listing_key, matching the existing 'ISB:1234' shape. */
export const DELDO_LISTING_KEY_PREFIX = "DELDO";

/**
 * Deldo's extra Lane-specific facts, kept alongside the shared row rather than
 * forced into it. These have no column in the shared model and must not be
 * silently dropped: `discountRaw` in particular is commercially loaded.
 */
export interface DeldoRowExtras {
  /**
   * The Discount column, VERBATIM AND UNAPPLIED.
   *
   * Its meaning is not documented, and the sample makes the obvious reading
   * untenable: values range from -407.69 to +63.23. A plain percentage
   * discount cannot be negative, so this is either a surcharge indicator, a
   * margin figure, or a comparison against a list price that is not in the
   * feed.
   *
   * Applying an unknown quantity to a purchase price is precisely the silent
   * commercial corruption this integration must not produce, so it is carried
   * for audit and never used in arithmetic. `purchasePrice` is the Price
   * column exactly as supplied. See handoff decision D7.
   */
  readonly discountRaw: string | null;
  /** 'Per parcel' — observed values 0, 1, 2. Meaning not documented. */
  readonly perParcelRaw: string | null;
  /** 'Demo' — non-empty ('DEMO') marks a demonstration tyre. */
  readonly demo: boolean;
  /** 'Dot' — the DOT year when this is old stock, e.g. '2022'. */
  readonly dotYear: string | null;
  /** The raw Speed cell, e.g. 'VR'. Speed symbol plus radial marker. */
  readonly speedRaw: string | null;
}

export interface DeldoNormalizedRow extends NormalizedCatalogueRow {
  readonly deldo: DeldoRowExtras;
}

export interface DeldoRowOutcome extends NormalizedRowOutcome {
  readonly normalized: DeldoNormalizedRow | null;
}

function trimmed(value: string | undefined): string {
  return (value ?? "").trim();
}

function orNull(value: string | undefined): string | null {
  const t = trimmed(value);
  return t === "" ? null : t;
}

/**
 * Strict money parsing.
 *
 * The sample is uniform: an integer part, a '.', exactly two decimals, no
 * thousands separator, no currency symbol, no comma decimal. Anything else is
 * refused rather than coerced — `Number("48,50")` is NaN but `parseFloat`
 * would happily return 48, and that is a 50-cent error on every row with a
 * comma decimal.
 */
export function parseDeldoPrice(raw: string | undefined): number | null {
  const value = trimmed(raw);
  if (value === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Strict stock parsing.
 *
 * Non-negative integers only. Zero is a legitimate answer meaning none in
 * stock and is preserved as 0, which is NOT the same as null (the supplier did
 * not say). The sample carries 3..100 with no zeroes and no blanks.
 */
export function parseDeldoStock(raw: string | undefined): number | null {
  const value = trimmed(raw);
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Rim diameter in inches.
 *
 * Two conventions in one column, both present in the sample:
 *   - 2 digits  → inches directly ('16' = 16")
 *   - 3 digits  → tenths of an inch ('225' = 22.5")
 *
 * Every 3-digit row in the sample is Vehicle='Truck' with values 175, 195 and
 * 225 — the standard 17.5", 19.5" and 22.5" truck rims. Reading '225' as 225
 * inches would be absurd, but it is what a naive integer parse produces, so
 * the case is handled explicitly and the row is flagged for review rather than
 * trusted silently.
 */
export function parseDeldoRim(raw: string | undefined): {
  rimInch: number | null;
  needsReview: boolean;
} {
  const value = trimmed(raw);
  if (!/^\d{1,3}$/.test(value)) return { rimInch: null, needsReview: value !== "" };
  const numeric = Number(value);
  if (value.length === 3) return { rimInch: numeric / 10, needsReview: true };
  return { rimInch: numeric, needsReview: false };
}

/** Section width in mm. Non-numeric means imperial sizing — see below. */
function parseWidth(raw: string | undefined): {
  widthMm: number | null;
  reason: string | null;
} {
  const value = trimmed(raw);
  if (value === "") return { widthMm: null, reason: "width missing" };
  if (!/^\d+$/.test(value)) {
    // '31X' / '33X' are imperial sizes such as 31x10.50R15, where the column
    // holds the overall diameter in inches rather than a section width in mm.
    // Storing 31 as widthMm would put a light-truck tyre among the 31mm ones.
    return { widthMm: null, reason: `non-numeric width '${value}' (imperial sizing)` };
  }
  return { widthMm: Number(value), reason: null };
}

/**
 * Aspect ratio.
 *
 * '0' appears on 69 rows and is NOT an aspect ratio of zero — it marks sizes
 * that have none, such as '195 R14'. Mapped to null so nothing downstream
 * renders '195/0 R14' or treats it as a very low profile.
 */
function parseAspectRatio(raw: string | undefined): number | null {
  const value = trimmed(raw);
  if (!/^\d+$/.test(value)) return null;
  const numeric = Number(value);
  return numeric === 0 ? null : numeric;
}

/**
 * Splits a clean load index / speed symbol, e.g. '100Y' or '106/104S'.
 *
 * Returns nulls for anything else. The sample contains parenthesised forms
 * ('(100Y)', 454 rows) and damaged ones ('143/141j-'), and guessing what a
 * parenthesis means — extra load? a secondary rating? — is not something to do
 * silently on commercial data. Those keep loadSpeedRaw and are flagged.
 */
export function parseDeldoLoadSpeed(raw: string | undefined): {
  loadIndex: string | null;
  speedRating: string | null;
  needsReview: boolean;
} {
  const value = trimmed(raw);
  if (value === "") return { loadIndex: null, speedRating: null, needsReview: false };

  const match = /^(\d{2,3}(?:\/\d{2,3})?)([A-Z])$/.exec(value);
  if (!match) return { loadIndex: null, speedRating: null, needsReview: true };

  return { loadIndex: match[1], speedRating: match[2], needsReview: false };
}

/** Season, from the 'Quality' column. Observed: Summer, Winter, All Season. */
function parseSeason(raw: string | undefined): string | null {
  const value = trimmed(raw).toLowerCase();
  if (value === "summer") return "summer";
  if (value === "winter") return "winter";
  if (value === "all season") return "all_season";
  return null;
}

/** Vehicle class. Observed: Passenger car, Light Truck, Truck, Jeep / 4x4. */
function parseVehicleClass(raw: string | undefined): string | null {
  const value = trimmed(raw).toLowerCase();
  if (value === "passenger car") return "passenger";
  if (value === "light truck") return "light_truck";
  if (value === "truck") return "truck";
  if (value === "jeep / 4x4") return "suv_4x4";
  return null;
}

/**
 * Maps one verified feed row onto the shared normalized model.
 *
 * A row is REJECTED only when it cannot support a commercial decision at all:
 * no article id, or an unparseable price or stock. Everything else that looks
 * wrong produces a review reason and still imports, so one odd tyre does not
 * cost an entire hourly feed.
 */
export function normalizeDeldoRow(
  sourceLine: number,
  cells: Record<string, string>
): DeldoRowOutcome {
  const raw = { ...cells };
  const errors: string[] = [];
  const reasons: string[] = [];

  const article = trimmed(cells.Article);
  if (article === "") errors.push("Article is empty — no supplier article id");

  // Commercial fields: strict. A blank or malformed value is an error, not a
  // null to be papered over later.
  const priceCell = trimmed(cells.Price);
  const purchasePrice = parseDeldoPrice(cells.Price);
  if (priceCell === "") {
    errors.push("Price is empty");
  } else if (purchasePrice === null) {
    errors.push(`Price '${priceCell}' is not a valid decimal amount`);
  }

  const stockCell = trimmed(cells.Stock);
  const stockExact = parseDeldoStock(cells.Stock);
  if (stockCell === "") {
    errors.push("Stock is empty");
  } else if (stockExact === null) {
    errors.push(`Stock '${stockCell}' is not a non-negative integer`);
  }

  if (errors.length > 0) {
    return {
      sourceRow: sourceLine,
      raw,
      normalized: null,
      validation: { result: "rejected", errors, reasons: [] },
    };
  }

  const eanResult = validateGtin(cells.EAN);
  if (eanResult.status === "invalid_check_digit") {
    reasons.push(`EAN '${trimmed(cells.EAN)}' failed GS1 check-digit validation`);
  }

  const width = parseWidth(cells.Width);
  if (width.reason) reasons.push(width.reason);

  const rim = parseDeldoRim(cells.Rim);
  if (rim.needsReview && rim.rimInch !== null) {
    reasons.push(`rim '${trimmed(cells.Rim)}' read as ${rim.rimInch}" (truck convention)`);
  } else if (rim.rimInch === null && trimmed(cells.Rim) !== "") {
    reasons.push(`rim '${trimmed(cells.Rim)}' is not numeric`);
  }

  const loadSpeed = parseDeldoLoadSpeed(cells.Loadindex);
  if (loadSpeed.needsReview) {
    reasons.push(`load/speed '${trimmed(cells.Loadindex)}' not in a recognised form`);
  }

  const aspectRatio = parseAspectRatio(cells.Height);

  // Non-empty Dot means this listing is old stock of the same tyre, which is
  // why an EAN can legitimately appear twice in one feed. Verified in the
  // sample: EAN 3286340672719 is BR6727 (no Dot, 82.50) and BR672722
  // (Dot=2022, 61.00) — the same product at two prices. The shared model
  // already expects this and carries `oldDot` on the LISTING, not the product.
  const dotYear = orNull(cells.Dot);
  const oldDot = dotYear !== null;

  const ean = eanResult.status === "valid" || eanResult.status === "recovered_leading_zero"
    ? eanResult.normalized
    : null;

  const normalized: DeldoNormalizedRow = {
    sourceRow: sourceLine,

    supplierListingKey: `${DELDO_LISTING_KEY_PREFIX}:${article}`,
    supplierArticleId: article,
    supplierItemCode: orNull(cells.IPCODE),
    sourceProductKey: null,
    productKey: ean ? `GTIN:${ean}` : `${DELDO_LISTING_KEY_PREFIX}:${article}`,

    ean,
    eanRaw: orNull(cells.EAN),
    eanStatus: eanResult.status,

    manufacturerProductCode: null,
    brandCode: null,
    brand: orNull(cells.Brand),
    modelPattern: orNull(cells.Pattern),
    description: null,

    productClass: parseVehicleClass(cells.Vehicle),
    season: parseSeason(cells.Quality),

    widthMm: width.widthMm,
    aspectRatio,
    rimInch: rim.rimInch,
    sizeDisplay: null,

    loadSpeedRaw: orNull(cells.Loadindex),
    loadIndex: loadSpeed.loadIndex,
    speedRating: loadSpeed.speedRating,

    // 'PR/RF' mixes extra-load markers with ply ratings ('XL', but also '10PR',
    // '16PR', and load/speed pairs like '103 H'). Only an exact 'XL' is treated
    // as extra load; everything else stays unknown rather than being guessed
    // from a column that plainly holds more than one kind of value.
    xl: trimmed(cells["PR/RF"]).toUpperCase() === "XL" ? true : null,
    runFlat: trimmed(cells.RFT) === "1" ? true : trimmed(cells.RFT) === "0" ? false : null,
    oldDot,

    // Not present in the feed at all. Declared missing rather than defaulted,
    // because weight drives PFU and a fabricated weight becomes a wrong levy.
    weightKg: null,
    weightStatus: "missing_or_zero",
    weightCategory: null,

    eMark: null,
    european: null,
    eprelId: orNull(cells.Eprel_code),

    scanReady: ean !== null,
    reviewRequired: reasons.length > 0,
    reviewReasons: reasons,

    purchasePrice,
    stockRaw: orNull(cells.Stock),
    stockExact,
    stockMinimum: null,

    deldo: {
      discountRaw: orNull(cells.Discount),
      perParcelRaw: orNull(cells["Per parcel"]),
      demo: orNull(cells.Demo) !== null,
      dotYear,
      speedRaw: orNull(cells.Speed),
    },
  };

  const validation: RowValidation = {
    result: reasons.length > 0 ? "review" : "valid",
    errors: [],
    reasons,
  };

  return { sourceRow: sourceLine, raw, normalized, validation };
}

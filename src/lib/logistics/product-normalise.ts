// Product normalisation for imported supplier lines and scanned labels.
//
// Supplier documents have wildly different layouts, so everything is normalised
// into one internal structure. Two rules govern this module:
//
//   1. `raw_description` is ALWAYS preserved untouched. Normalisation adds
//      structure; it never replaces the source text.
//   2. Nothing is guessed. A field that cannot be read confidently is left null
//      and named in `reviewFields` so a human sees it, rather than being filled
//      with a plausible-looking value.
//
// Pure and dependency-free.

import type { ItemType } from "@/lib/types/logistics";

export interface NormalisedProduct {
  itemType: ItemType;
  brand: string | null;
  model: string | null;
  width: number | null;
  aspectRatio: number | null;
  rimDiameter: number | null;
  loadIndex: string | null;
  speedRating: string | null;
  extraLoad: boolean | null;
  runFlat: boolean | null;
  /** Always the untouched source text. */
  rawDescription: string;
  /** Cleaned-up human description, safe to show in a table. */
  description: string;
  /** Fields a human should confirm because they could not be read reliably. */
  reviewFields: string[];
  /** 0–1 heuristic confidence for the structured extraction. */
  confidence: number;
}

/** Brands we can recognise by name. Unknown brands are left for the human. */
const KNOWN_BRANDS = [
  "michelin",
  "pirelli",
  "continental",
  "bridgestone",
  "goodyear",
  "dunlop",
  "hankook",
  "yokohama",
  "toyo",
  "nokian",
  "vredestein",
  "falken",
  "kumho",
  "nexen",
  "maxxis",
  "kleber",
  "bfgoodrich",
  "firestone",
  "sava",
  "fulda",
  "uniroyal",
  "semperit",
  "barum",
  "matador",
  "debica",
  "riken",
  "tigar",
  "kormoran",
  "apollo",
  "ceat",
  "gt radial",
  "linglong",
  "sailun",
  "triangle",
  "windforce",
  "petlas",
  "lassa",
  "laufenn",
  "rotalla",
  "imperial",
  "nankang",
  "zeetex",
  "kenda",
  "cst",
  "vittoria",
  "schwalbe",
];

/**
 * Metric tyre size: 225/55 R18, 225/55R18, 225-55-18, 225/55 ZR18.
 * The rim group allows a decimal for commercial sizes like R17.5.
 */
const SIZE_PATTERN =
  /\b(\d{3})\s*[/\-]\s*(\d{2})\s*(?:Z?R|R|-)\s*(\d{2}(?:[.,]\d)?)\b/i;

/** Load index + speed rating: 98V, 103/101T, 91 H. */
const LOAD_SPEED_PATTERN = /\b(\d{2,3})(?:\s*\/\s*(\d{2,3}))?\s*([A-Z])\b/;

const TUBE_HINTS = ["camera", "camere", "inner tube", "tube", "cámara", "cameră"];
const WHEEL_HINTS = ["cerchio", "cerchi", "jante", "janta", "jantă", "wheel", "rim", "llanta"];
const FEE_HINTS = [
  "pfu",
  "contributo",
  "contributo ambientale",
  "eco",
  "ecotassa",
  "smaltimento",
  "taxa",
  "taxă",
  "fee",
  "spese",
  "trasporto",
  "transport",
  "spedizione",
  "shipping",
  "porto",
  "iva",
];
const SERVICE_HINTS = [
  "montaggio",
  "montare",
  "equilibratura",
  "echilibrare",
  "servizio",
  "serviciu",
  "manodopera",
  "labour",
  "service",
];
const ACCESSORY_HINTS = [
  "valvola",
  "valvole",
  "valva",
  "ventil",
  "contrappeso",
  "contrappesi",
  "greutate",
  "weight",
  "bullone",
  "sensore",
  "senzor",
  "tpms",
  "copribullone",
];

/**
 * Word-boundary hint matching.
 *
 * Substring matching is not good enough here: "rim" appears inside "PRIMACY",
 * which would classify a Michelin tyre as a wheel and generate the wrong
 * unit_type for every physical object on the line. Likewise "eco" inside plenty
 * of ordinary words would turn products into fees.
 */
function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    // \b doesn't behave for accented characters, so the boundaries are spelled
    // out as "not a letter/digit" on either side.
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "u").test(haystack);
  });
}

function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classifies a document line. A recognisable tyre size is the strongest
 * signal — but only when the line isn't obviously a fee, because "trasporto
 * pneumatici 225/55 R18" is a transport charge, not a tyre.
 */
export function detectItemType(rawDescription: string): ItemType {
  const text = normalise(rawDescription);
  if (!text) return "other";

  if (containsAny(text, FEE_HINTS)) return "fee";
  if (containsAny(text, SERVICE_HINTS)) return "service";
  if (containsAny(text, TUBE_HINTS)) return "tube";
  if (containsAny(text, WHEEL_HINTS)) return "wheel";
  if (SIZE_PATTERN.test(rawDescription)) return "tyre";
  if (containsAny(text, ACCESSORY_HINTS)) return "accessory";
  return "other";
}

export function detectBrand(rawDescription: string): string | null {
  const text = normalise(rawDescription);
  // Longest first, so "gt radial" beats a stray "gt".
  const brands = [...KNOWN_BRANDS].sort((a, b) => b.length - a.length);
  for (const brand of brands) {
    const pattern = new RegExp(`(^|[^a-z])${brand.replace(/\s/g, "\\s+")}([^a-z]|$)`, "i");
    if (pattern.test(text)) {
      return brand
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }
  }
  return null;
}

export interface TyreSize {
  width: number;
  aspectRatio: number;
  rimDiameter: number;
}

export function parseTyreSize(rawDescription: string): TyreSize | null {
  const match = SIZE_PATTERN.exec(rawDescription);
  if (!match) return null;

  const width = Number(match[1]);
  const aspectRatio = Number(match[2]);
  const rimDiameter = Number(match[3].replace(",", "."));

  // Sanity bounds: outside these it isn't a tyre size, it's a coincidence.
  if (width < 100 || width > 500) return null;
  if (aspectRatio < 20 || aspectRatio > 100) return null;
  if (rimDiameter < 10 || rimDiameter > 30) return null;

  return { width, aspectRatio, rimDiameter };
}

export function parseLoadSpeed(
  rawDescription: string,
  size: TyreSize | null
): { loadIndex: string | null; speedRating: string | null } {
  if (!size) return { loadIndex: null, speedRating: null };

  // Search only after the size, so the size's own digits can't be misread as
  // a load index.
  const sizeMatch = SIZE_PATTERN.exec(rawDescription);
  const tail = sizeMatch
    ? rawDescription.slice(sizeMatch.index + sizeMatch[0].length)
    : rawDescription;

  const match = LOAD_SPEED_PATTERN.exec(tail.toUpperCase());
  if (!match) return { loadIndex: null, speedRating: null };

  const loadIndex = match[2] ? `${match[1]}/${match[2]}` : match[1];
  return { loadIndex, speedRating: match[3] };
}

export function detectExtraLoad(rawDescription: string): boolean | null {
  const text = rawDescription.toUpperCase();
  if (/\b(XL|EXTRA\s*LOAD|REINFORCED)\b/.test(text)) return true;
  return null;
}

export function detectRunFlat(rawDescription: string): boolean | null {
  const text = rawDescription.toUpperCase();
  // Brand-specific run-flat markings, plus the generic ones.
  if (/\b(RUN\s*FLAT|RUNFLAT|ROF|RFT|ZP|SSR|DSST|MOE|EMT|SEAL|RSC)\b/.test(text)) return true;
  return null;
}

/** "225/55 R18" — the size string used on labels and in search. */
export function formatTyreSize(
  width: number | null | undefined,
  aspectRatio: number | null | undefined,
  rimDiameter: number | string | null | undefined
): string | null {
  if (width == null || aspectRatio == null || rimDiameter == null) return null;
  const rim = Number(rimDiameter);
  if (!Number.isFinite(rim)) return null;
  // String(18) is "18" and String(17.5) is "17.5", so R18 and R17.5 both
  // come out right without special-casing.
  return `${width}/${aspectRatio} R${rim}`;
}

/**
 * Normalises one document line into the internal product structure.
 *
 * `reviewFields` is the honest part of this function: for a tyre line whose
 * size or brand couldn't be read, those names end up here so the review screen
 * highlights them instead of the system inventing values.
 */
export function normaliseProduct(rawDescription: string): NormalisedProduct {
  const raw = rawDescription ?? "";
  const itemType = detectItemType(raw);
  const size = parseTyreSize(raw);
  const { loadIndex, speedRating } = parseLoadSpeed(raw, size);
  const brand = detectBrand(raw);

  const reviewFields: string[] = [];
  let confidence = 0.4;

  if (itemType === "tyre") {
    if (size) confidence += 0.3;
    else reviewFields.push("size");
    if (brand) confidence += 0.2;
    else reviewFields.push("brand");
    if (loadIndex && speedRating) confidence += 0.1;
  } else if (itemType === "other") {
    // We couldn't classify it at all — that is exactly what a human is for.
    reviewFields.push("item_type");
  } else {
    confidence += 0.3;
  }

  // Model = whatever is left after stripping the brand and the technical
  // tokens. Often noisy, so it is never treated as authoritative.
  let model: string | null = null;
  if (brand) {
    const withoutBrand = raw.replace(new RegExp(brand.replace(/\s/g, "\\s+"), "i"), " ");
    const stripped = withoutBrand
      .replace(SIZE_PATTERN, " ")
      .replace(/\b\d{2,3}(\s*\/\s*\d{2,3})?\s*[A-Z]\b/g, " ")
      .replace(/\b(XL|EXTRA\s*LOAD|RUN\s*FLAT|RUNFLAT|ROF|RFT|ZP|SSR|DSST|MOE|FR|MFS)\b/gi, " ")
      .replace(/[^\p{L}\p{N}\s.+-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    model = stripped.length >= 2 ? stripped : null;
  }

  const description = raw.replace(/\s+/g, " ").trim();

  return {
    itemType,
    brand,
    model,
    width: size?.width ?? null,
    aspectRatio: size?.aspectRatio ?? null,
    rimDiameter: size?.rimDiameter ?? null,
    loadIndex,
    speedRating,
    extraLoad: detectExtraLoad(raw),
    runFlat: detectRunFlat(raw),
    rawDescription: raw,
    description,
    reviewFields,
    confidence: Math.min(1, Number(confidence.toFixed(3))),
  };
}

export interface MergeableProductLine {
  itemType?: string | null;
  brand?: string | null;
  model?: string | null;
  width?: number | null;
  aspectRatio?: number | null;
  rimDiameter?: number | null;
  loadIndex?: string | null;
  speedRating?: string | null;
  extraLoad?: boolean | null;
  runFlat?: boolean | null;
  supplierSku?: string | null;
  unitPrice?: number | null;
  taxRate?: number | null;
  quantity?: number | null;
  rawDescription: string;
}

function mergeKey(line: MergeableProductLine): string {
  const norm = (value: string | null | undefined) => (value ? value.trim().toLowerCase() : null);
  return JSON.stringify([
    norm(line.itemType),
    norm(line.brand),
    norm(line.model),
    line.width ?? null,
    line.aspectRatio ?? null,
    line.rimDiameter ?? null,
    norm(line.loadIndex),
    norm(line.speedRating),
    line.extraLoad ?? null,
    line.runFlat ?? null,
    norm(line.supplierSku),
    line.unitPrice ?? null,
    line.taxRate ?? null,
  ]);
}

/**
 * Combines lines that are identical in every structured field except
 * quantity and free text into one, with quantities summed — so two tyres
 * of the same kind listed on separate rows of a source document show as
 * "2×" of one kind instead of two separate "1×" rows ("ai 2x de un fel,
 * nu a 1 + 1"). A line with no readable quantity is left alone: never
 * guessed, never merged away — see the DDT spec's "don't guess 1" rule.
 */
export function mergeIdenticalProductLines<T extends MergeableProductLine>(lines: T[]): T[] {
  const result: T[] = [];
  const indexByKey = new Map<string, number>();

  for (const line of lines) {
    if (line.quantity == null) {
      result.push(line);
      continue;
    }

    const key = mergeKey(line);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, result.length);
      result.push(line);
    } else {
      const existing = result[existingIndex];
      result[existingIndex] = {
        ...existing,
        quantity: (existing.quantity ?? 0) + (line.quantity ?? 0),
        rawDescription:
          existing.rawDescription === line.rawDescription
            ? existing.rawDescription
            : `${existing.rawDescription} | ${line.rawDescription}`,
      };
    }
  }

  return result;
}

/**
 * Compares a scanned supplier label against an expected order line. Returns
 * 0–1; the caller decides what counts as confident (see supplier-label-match).
 */
export function scoreProductAgainstLine(
  scanned: {
    brand?: string | null;
    size?: string | null;
    supplierSku?: string | null;
    loadIndex?: string | null;
    speedRating?: string | null;
    barcode?: string | null;
  },
  line: {
    brand?: string | null;
    supplier_sku?: string | null;
    width?: number | null;
    aspect_ratio?: number | null;
    rim_diameter?: number | string | null;
    load_index?: string | null;
    speed_rating?: string | null;
    raw_description?: string | null;
  }
): { score: number; matched: string[] } {
  const matched: string[] = [];
  let score = 0;

  // A SKU/barcode hit is nearly decisive — it is the supplier's own identifier.
  const scannedSku = (scanned.supplierSku ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const lineSku = (line.supplier_sku ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (scannedSku && lineSku && scannedSku === lineSku) {
    score += 0.6;
    matched.push("supplier_sku");
  }

  const scannedBarcode = (scanned.barcode ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (scannedBarcode && lineSku && scannedBarcode === lineSku) {
    score += 0.6;
    matched.push("barcode");
  }

  // Weights are tuned so that brand + an exact size clears the confidence
  // threshold (0.65) — that pair is what an operator actually reads off a
  // label, and on a unique line it is a real match. Either one ALONE stays
  // below the bar, because "Michelin" or "225/55 R18" on its own is ambiguous
  // across a day's orders. Ambiguity between two similar lines is caught
  // separately by the runner-up margin check.
  const lineSize = formatTyreSize(line.width, line.aspect_ratio, line.rim_diameter);
  const scannedSize = scanned.size ? normalise(scanned.size).replace(/\s/g, "") : "";
  if (lineSize && scannedSize && normalise(lineSize).replace(/\s/g, "") === scannedSize) {
    score += 0.35;
    matched.push("size");
  }

  if (scanned.brand && line.brand && normalise(scanned.brand) === normalise(line.brand)) {
    score += 0.3;
    matched.push("brand");
  }

  if (scanned.loadIndex && line.load_index && scanned.loadIndex === line.load_index) {
    score += 0.05;
    matched.push("load_index");
  }
  if (scanned.speedRating && line.speed_rating &&
      scanned.speedRating.toUpperCase() === line.speed_rating.toUpperCase()) {
    score += 0.05;
    matched.push("speed_rating");
  }

  return { score: Math.min(1, Number(score.toFixed(3))), matched };
}

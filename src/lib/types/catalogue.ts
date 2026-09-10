// Canonical contract for the tyre catalogue.
//
// Every string union here mirrors a Postgres CHECK constraint in
// supabase/migrations/20260830000000_tyre_catalogue.sql exactly — keep the
// two in sync if either changes.

import type { GtinStatus } from "@/lib/catalogue/gtin";

export type WeightStatus = "supplier_reported" | "missing_or_zero";

export type ImportMode = "complete" | "partial" | "manual_correction";

export type ImportRunStatus =
  | "uploaded"
  | "analyzing"
  | "previewed"
  | "committing"
  | "committed"
  | "failed"
  | "cancelled";

export type RowValidationResult = "pending" | "valid" | "review" | "rejected";

export type RowAction =
  | "insert_product"
  | "insert_listing"
  | "update_listing"
  | "unchanged"
  | "conflict"
  | "rejected"
  | "deactivate_listing";

export type ConflictType =
  | "ean_spec_mismatch"
  | "product_ean_change"
  | "weight_conflict"
  | "manufacturer_code_conflict"
  | "ambiguous_match"
  | "duplicate_source_row";

export type IdentifierType = "ean" | "gtin" | "manufacturer_code" | "supplier_article_code";

/**
 * One source row after normalisation, before it has been matched against
 * anything already in the database. Every field is either a confidently
 * derived value or null — nothing here is a guess.
 */
export interface NormalizedCatalogueRow {
  sourceRow: number;

  supplierListingKey: string;
  supplierArticleId: string;
  supplierItemCode: string | null;
  /** The product key the file proposed. Kept for audit even if we disagree. */
  sourceProductKey: string | null;
  /** The product key WE derived, which is what the importer actually uses. */
  productKey: string;

  /** The validated barcode. Null unless it passed a check digit here. */
  ean: string | null;
  /** Exactly what the file supplied, whether or not it validated. */
  eanRaw: string | null;
  eanStatus: GtinStatus;

  manufacturerProductCode: string | null;
  brandCode: string | null;
  brand: string | null;
  modelPattern: string | null;
  description: string | null;

  productClass: string | null;
  season: string | null;

  widthMm: number | null;
  aspectRatio: number | null;
  rimInch: number | null;
  sizeDisplay: string | null;

  loadSpeedRaw: string | null;
  loadIndex: string | null;
  speedRating: string | null;

  xl: boolean | null;
  runFlat: boolean | null;
  oldDot: boolean;

  weightKg: number | null;
  weightStatus: WeightStatus;
  weightCategory: string | null;

  eMark: string | null;
  european: boolean | null;
  eprelId: string | null;

  scanReady: boolean;
  reviewRequired: boolean;
  reviewReasons: string[];

  /** Commercial data. Absent from the first ISB file; kept off the product. */
  purchasePrice: number | null;
  stockRaw: string | null;
  stockExact: number | null;
  stockMinimum: number | null;
}

export interface RowValidation {
  result: Exclude<RowValidationResult, "pending">;
  /** Why the row cannot be imported at all. Empty unless result is 'rejected'. */
  errors: string[];
  /** Why a human should look at it. Empty unless result is 'review'. */
  reasons: string[];
}

export interface NormalizedRowOutcome {
  sourceRow: number;
  /** Untouched source cells, stored verbatim as the audit record. */
  raw: Record<string, string>;
  /** Null when the row was rejected outright. */
  normalized: NormalizedCatalogueRow | null;
  validation: RowValidation;
}

/**
 * The seam that lets a second supplier format be added without touching the
 * catalogue service. An adapter owns one supplier's column names and its
 * local conventions — ISB's 'J'/'N' booleans and group codes, someone else's
 * comma decimals — and nothing else.
 */
export interface SupplierImportAdapter {
  readonly id: string;
  readonly label: string;
  readonly sheetName: string;
  readonly requiredColumns: readonly string[];
  normalizeRow(sourceRow: number, cells: Record<string, string>): NormalizedRowOutcome;
}

/** The specification fields two products must agree on before they may merge. */
export interface ProductSpec {
  brand: string | null;
  modelPattern: string | null;
  widthMm: number | null;
  aspectRatio: number | null;
  rimInch: number | null;
  loadIndex: string | null;
  speedRating: string | null;
  xl: boolean | null;
  runFlat: boolean | null;
  season: string | null;
  eMark: string | null;
}

/** The public, customer-safe view of a tyre. No supplier data of any kind. */
export interface PublicTyreResult {
  brand: string | null;
  modelPattern: string | null;
  description: string | null;
  sizeDisplay: string | null;
  widthMm: number | null;
  aspectRatio: number | null;
  rimInch: number | null;
  loadIndex: string | null;
  speedRating: string | null;
  loadSpeedRaw: string | null;
  season: string | null;
  productClass: string | null;
  xl: boolean | null;
  runFlat: boolean | null;
  weightKg: number | null;
  eprelId: string | null;
  /** The code the visitor searched with, echoed back for confirmation. */
  matchedOn: IdentifierType;
  matchedValue: string;
}

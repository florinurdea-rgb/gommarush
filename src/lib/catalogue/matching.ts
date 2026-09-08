import type {
  ConflictType,
  NormalizedCatalogueRow,
  ProductSpec,
  RowAction,
} from "@/lib/types/catalogue";

// Deciding what a source row means against what we already hold.
//
// Pure: this module is handed the candidate rows already loaded from the
// database and returns a decision. It performs no I/O, so every rule below
// is unit-testable without a database, and the same decision is reached on
// every run for the same inputs.
//
// The governing rule is that AMBIGUITY IS AN OUTCOME, not a problem to be
// smoothed over. Where the evidence supports two readings, this returns a
// conflict for a human rather than picking the more likely one. Nothing here
// ever averages two values, prefers the newer of two contradictory facts, or
// merges two products because they happen to be the same size.

/** How a row was matched. Recorded so an import can be explained afterwards. */
export type MatchStrategy =
  | "existing_listing_key"
  | "supplier_article"
  | "validated_ean"
  | "manufacturer_code"
  | "exact_spec"
  | "new_product"
  | "conflict";

/** Two supplier-reported weights within this many kg are the same weight. */
export const DEFAULT_WEIGHT_TOLERANCE_KG = 0.1;

export interface ExistingListing {
  id: string;
  supplierId: string;
  supplierListingKey: string;
  supplierArticleId: string;
  catalogueProductId: string;
  supplierItemCode: string | null;
  oldDot: boolean;
  active: boolean;
}

export interface ExistingProduct extends ProductSpec {
  id: string;
  productKey: string;
  ean: string | null;
  eanStatus: string;
  manufacturerProductCode: string | null;
  weightKg: number | null;
  weightStatus: string;
  scanReady: boolean;
  reviewRequired: boolean;
  productClass: string | null;
  description: string | null;
  sizeDisplay: string | null;
  loadSpeedRaw: string | null;
  weightCategory: string | null;
  european: boolean | null;
  eprelId: string | null;
  brandCode: string | null;
  oldDot: boolean;
}

export interface ConflictDraft {
  conflictType: ConflictType;
  field: string | null;
  existingValue: string | null;
  incomingValue: string | null;
  catalogueProductId: string | null;
  competingProductId: string | null;
  detail: Record<string, unknown>;
}

export interface MatchDecision {
  action: RowAction;
  strategy: MatchStrategy;
  productId: string | null;
  listingId: string | null;
  /** Fields to change on the existing product. Empty means leave it alone. */
  productChanges: Record<string, unknown>;
  /** Fields to change on the existing listing. */
  listingChanges: Record<string, unknown>;
  conflicts: ConflictDraft[];
  reasons: string[];
}

export interface MatchContext {
  supplierId: string;
  /** supplier_listing_key -> listing */
  listingByKey: Map<string, ExistingListing>;
  /** `${supplierId}:${supplierArticleId}` -> listing */
  listingBySupplierArticle: Map<string, ExistingListing>;
  /** validated ean -> product */
  productByEan: Map<string, ExistingProduct>;
  /** product_key -> product */
  productByKey: Map<string, ExistingProduct>;
  /** product id -> product. Without it the listing branch is O(n) per row. */
  productById: Map<string, ExistingProduct>;
  /** uppercased manufacturer code -> products carrying it */
  productsByManufacturerCode: Map<string, ExistingProduct[]>;
  weightToleranceKg?: number;
}

function normalizeText(value: string | null): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

export function specOf(row: NormalizedCatalogueRow): ProductSpec {
  return {
    brand: row.brand,
    modelPattern: row.modelPattern,
    widthMm: row.widthMm,
    aspectRatio: row.aspectRatio,
    rimInch: row.rimInch,
    loadIndex: row.loadIndex,
    speedRating: row.speedRating,
    xl: row.xl,
    runFlat: row.runFlat,
    season: row.season,
    eMark: row.eMark,
  };
}

/**
 * Whether two specifications may describe the same tyre.
 *
 * A field where either side is unknown is not a mismatch — absence of
 * evidence is not evidence of difference, and treating it otherwise would
 * fork the catalogue every time a supplier omitted a column. A field where
 * both sides are known and differ IS a mismatch, and one mismatch is enough.
 */
export function specsCompatible(
  a: ProductSpec,
  b: ProductSpec
): { compatible: boolean; mismatches: string[] } {
  const mismatches: string[] = [];

  const compareText = (field: keyof ProductSpec) => {
    const left = normalizeText(a[field] as string | null);
    const right = normalizeText(b[field] as string | null);
    if (left !== null && right !== null && left !== right) mismatches.push(field);
  };
  const compareNumber = (field: keyof ProductSpec) => {
    const left = a[field] as number | null;
    const right = b[field] as number | null;
    if (left !== null && right !== null && left !== right) mismatches.push(field);
  };
  const compareBoolean = (field: keyof ProductSpec) => {
    const left = a[field] as boolean | null;
    const right = b[field] as boolean | null;
    if (left !== null && right !== null && left !== right) mismatches.push(field);
  };

  compareText("brand");
  compareText("modelPattern");
  compareText("loadIndex");
  compareText("speedRating");
  compareText("season");
  compareText("eMark");
  compareNumber("widthMm");
  compareNumber("aspectRatio");
  compareNumber("rimInch");
  compareBoolean("xl");
  compareBoolean("runFlat");

  return { compatible: mismatches.length === 0, mismatches };
}

/**
 * A specification complete enough to identify a tyre on its own.
 *
 * Used only by the last-resort match. "Never merge products merely because
 * they have the same dimensions" — so a size alone will not do it: brand,
 * all three dimensions, load index, speed rating and season must all be
 * present before two rows may be considered the same product on specs.
 */
export function isIdentifyingSpec(spec: ProductSpec): boolean {
  return (
    spec.brand !== null &&
    spec.widthMm !== null &&
    spec.aspectRatio !== null &&
    spec.rimInch !== null &&
    spec.loadIndex !== null &&
    spec.speedRating !== null &&
    spec.season !== null
  );
}

/**
 * What to change on a product a row has matched.
 *
 * Every rule here is one-directional: data may improve, never degrade. A
 * blank does not overwrite a value, a zero does not overwrite a weight, and
 * a contradiction is a conflict rather than an update.
 */
export function planProductUpdate(
  existing: ExistingProduct,
  row: NormalizedCatalogueRow,
  weightToleranceKg = DEFAULT_WEIGHT_TOLERANCE_KG
): { changes: Record<string, unknown>; conflicts: ConflictDraft[]; reasons: string[] } {
  const changes: Record<string, unknown> = {};
  const conflicts: ConflictDraft[] = [];
  const reasons: string[] = [];

  // --- barcode ------------------------------------------------------------
  const incomingScannable = row.ean !== null && row.scanReady;
  if (incomingScannable) {
    if (existing.ean === null) {
      // We knew of no barcode; now we have a validated one.
      changes.ean = row.ean;
      changes.ean_status = row.eanStatus;
      changes.scan_ready = true;
      reasons.push("EAN_DISCOVERED");
    } else if (existing.ean !== row.ean) {
      // A strong identifier changed. Never silently rewritten.
      conflicts.push({
        conflictType: "product_ean_change",
        field: "ean",
        existingValue: existing.ean,
        incomingValue: row.ean,
        catalogueProductId: existing.id,
        competingProductId: null,
        detail: { supplierListingKey: row.supplierListingKey, sourceRow: row.sourceRow },
      });
      reasons.push("EAN_CHANGED");
    }
  }

  // --- weight -------------------------------------------------------------
  if (row.weightStatus === "supplier_reported" && row.weightKg !== null) {
    if (existing.weightKg === null) {
      changes.weight_kg = row.weightKg;
      changes.weight_status = "supplier_reported";
      reasons.push("WEIGHT_DISCOVERED");
    } else if (Math.abs(existing.weightKg - row.weightKg) > weightToleranceKg) {
      // Two suppliers, or two files, disagree materially. Neither wins, and
      // they are certainly not averaged.
      conflicts.push({
        conflictType: "weight_conflict",
        field: "weight_kg",
        existingValue: String(existing.weightKg),
        incomingValue: String(row.weightKg),
        catalogueProductId: existing.id,
        competingProductId: null,
        detail: {
          toleranceKg: weightToleranceKg,
          differenceKg: Number(Math.abs(existing.weightKg - row.weightKg).toFixed(3)),
          supplierListingKey: row.supplierListingKey,
        },
      });
      reasons.push("WEIGHT_CONFLICT");
    }
  }
  // An incoming zero/blank weight is simply ignored: it never clears a
  // positive supplier-reported one.

  // --- manufacturer code --------------------------------------------------
  const existingCode = normalizeText(existing.manufacturerProductCode);
  const incomingCode = normalizeText(row.manufacturerProductCode);
  if (incomingCode !== null) {
    if (existingCode === null) {
      changes.manufacturer_product_code = row.manufacturerProductCode;
    } else if (existingCode !== incomingCode) {
      conflicts.push({
        conflictType: "manufacturer_code_conflict",
        field: "manufacturer_product_code",
        existingValue: existing.manufacturerProductCode,
        incomingValue: row.manufacturerProductCode,
        catalogueProductId: existing.id,
        competingProductId: null,
        detail: { supplierListingKey: row.supplierListingKey },
      });
      reasons.push("MANUFACTURER_CODE_CONFLICT");
    }
  }

  // --- descriptive fields: fill gaps only --------------------------------
  // These are not identifying, so a missing one may be filled from a new
  // file. A populated one is left alone: the first supplier to describe a
  // tyre is not overruled by the next one to mention it.
  const fillable: [keyof ExistingProduct, string, unknown][] = [
    ["brand", "brand", row.brand],
    ["brandCode", "brand_code", row.brandCode],
    ["modelPattern", "model_pattern", row.modelPattern],
    ["description", "description", row.description],
    ["productClass", "product_class", row.productClass],
    ["season", "season", row.season],
    ["sizeDisplay", "size_display", row.sizeDisplay],
    ["loadSpeedRaw", "load_speed_raw", row.loadSpeedRaw],
    ["loadIndex", "load_index", row.loadIndex],
    ["speedRating", "speed_rating", row.speedRating],
    ["weightCategory", "weight_category", row.weightCategory],
    ["eMark", "e_mark", row.eMark],
    ["eprelId", "eprel_id", row.eprelId],
    ["widthMm", "width_mm", row.widthMm],
    ["aspectRatio", "aspect_ratio", row.aspectRatio],
    ["rimInch", "rim_inch", row.rimInch],
    ["xl", "xl", row.xl],
    ["runFlat", "run_flat", row.runFlat],
    ["european", "european", row.european],
  ];
  for (const [existingField, column, incoming] of fillable) {
    if (incoming === null || incoming === undefined) continue;
    if (existing[existingField] === null || existing[existingField] === undefined) {
      changes[column] = incoming;
    }
  }

  return { changes, conflicts, reasons };
}

/**
 * The match precedence, in order:
 *
 *   1. an existing supplier_listing_key
 *   2. an existing supplier_id + supplier_article_id
 *   3. a validated EAN whose specifications are compatible
 *   4. a manufacturer code plus brand and compatible specifications
 *   5. an exact, identifying specification match
 *   6. a new product
 *   7. anything ambiguous -> conflict
 *
 * Each step is tried only when the one before it found nothing.
 */
export function matchRow(row: NormalizedCatalogueRow, context: MatchContext): MatchDecision {
  const tolerance = context.weightToleranceKg ?? DEFAULT_WEIGHT_TOLERANCE_KG;
  const spec = specOf(row);

  const base = (): MatchDecision => ({
    action: "insert_product",
    strategy: "new_product",
    productId: null,
    listingId: null,
    productChanges: {},
    listingChanges: {},
    conflicts: [],
    reasons: [],
  });

  // --- 1 & 2: the listing is already known --------------------------------
  const knownListing =
    context.listingByKey.get(row.supplierListingKey) ??
    context.listingBySupplierArticle.get(`${context.supplierId}:${row.supplierArticleId}`);

  if (knownListing) {
    const product = context.productById.get(knownListing.catalogueProductId) ?? null;

    const decision = base();
    decision.strategy = context.listingByKey.has(row.supplierListingKey)
      ? "existing_listing_key"
      : "supplier_article";
    decision.listingId = knownListing.id;
    decision.productId = knownListing.catalogueProductId;

    // Mutable supplier-side data may always be refreshed.
    if ((knownListing.supplierItemCode ?? null) !== (row.supplierItemCode ?? null)) {
      decision.listingChanges.supplier_item_code = row.supplierItemCode;
    }
    if (knownListing.oldDot !== row.oldDot) decision.listingChanges.old_dot = row.oldDot;
    if (!knownListing.active) decision.listingChanges.active = true;

    if (product) {
      const plan = planProductUpdate(product, row, tolerance);
      decision.productChanges = plan.changes;
      decision.conflicts = plan.conflicts;
      decision.reasons = plan.reasons;
    }

    if (decision.conflicts.length > 0) {
      decision.action = "conflict";
      decision.strategy = "conflict";
    } else if (
      Object.keys(decision.productChanges).length === 0 &&
      Object.keys(decision.listingChanges).length === 0
    ) {
      decision.action = "unchanged";
    } else {
      decision.action = "update_listing";
    }
    return decision;
  }

  // --- 3: a validated EAN we already hold ---------------------------------
  if (row.ean && row.scanReady) {
    const candidate = context.productByEan.get(row.ean);
    if (candidate) {
      const { compatible, mismatches } = specsCompatible(spec, candidate);
      const decision = base();
      decision.productId = candidate.id;

      if (compatible) {
        decision.strategy = "validated_ean";
        decision.action = "insert_listing";
        const plan = planProductUpdate(candidate, row, tolerance);
        decision.productChanges = plan.changes;
        decision.conflicts = plan.conflicts;
        decision.reasons = plan.reasons;
        if (decision.conflicts.length > 0) {
          decision.action = "conflict";
          decision.strategy = "conflict";
        }
        return decision;
      }

      // Same barcode, different tyre. This is never merged.
      decision.strategy = "conflict";
      decision.action = "conflict";
      decision.reasons = ["EAN_SPEC_MISMATCH", ...mismatches.map((field) => `SPEC:${field}`)];
      decision.conflicts = [
        {
          conflictType: "ean_spec_mismatch",
          field: mismatches[0] ?? null,
          existingValue: JSON.stringify(pickSpec(candidate)),
          incomingValue: JSON.stringify(pickSpec(spec)),
          catalogueProductId: candidate.id,
          competingProductId: null,
          detail: {
            ean: row.ean,
            mismatches,
            supplierListingKey: row.supplierListingKey,
            sourceRow: row.sourceRow,
          },
        },
      ];
      return decision;
    }
  }

  // --- 4: manufacturer code + brand + compatible specs --------------------
  const code = normalizeText(row.manufacturerProductCode);
  if (code && row.brand) {
    const candidates = (context.productsByManufacturerCode.get(code) ?? []).filter((candidate) => {
      if (normalizeText(candidate.brand) !== normalizeText(row.brand)) return false;
      return specsCompatible(spec, candidate).compatible;
    });

    if (candidates.length === 1) {
      const candidate = candidates[0];
      const decision = base();
      decision.strategy = "manufacturer_code";
      decision.action = "insert_listing";
      decision.productId = candidate.id;
      const plan = planProductUpdate(candidate, row, tolerance);
      decision.productChanges = plan.changes;
      decision.conflicts = plan.conflicts;
      decision.reasons = plan.reasons;
      if (decision.conflicts.length > 0) {
        decision.action = "conflict";
        decision.strategy = "conflict";
      }
      return decision;
    }

    if (candidates.length > 1) {
      const decision = base();
      decision.strategy = "conflict";
      decision.action = "conflict";
      decision.reasons = ["AMBIGUOUS_MANUFACTURER_CODE"];
      decision.conflicts = [
        {
          conflictType: "ambiguous_match",
          field: "manufacturer_product_code",
          existingValue: candidates.map((candidate) => candidate.productKey).join(", "),
          incomingValue: row.manufacturerProductCode,
          catalogueProductId: candidates[0].id,
          competingProductId: candidates[1].id,
          detail: { supplierListingKey: row.supplierListingKey, candidates: candidates.length },
        },
      ];
      return decision;
    }
  }

  // --- 5: an identifying specification match ------------------------------
  // Only for rows with no usable barcode: a scannable row that reached here
  // has a genuinely new EAN and must get its own product, not be folded into
  // a look-alike.
  if (!row.scanReady && isIdentifyingSpec(spec)) {
    const matches = [...context.productByKey.values()].filter(
      (candidate) =>
        candidate.ean === null &&
        isIdentifyingSpec(candidate) &&
        specsCompatible(spec, candidate).compatible
    );
    if (matches.length === 1) {
      const decision = base();
      decision.strategy = "exact_spec";
      decision.action = "insert_listing";
      decision.productId = matches[0].id;
      const plan = planProductUpdate(matches[0], row, tolerance);
      decision.productChanges = plan.changes;
      decision.conflicts = plan.conflicts;
      decision.reasons = plan.reasons;
      if (decision.conflicts.length > 0) {
        decision.action = "conflict";
        decision.strategy = "conflict";
      }
      return decision;
    }
    if (matches.length > 1) {
      const decision = base();
      decision.strategy = "conflict";
      decision.action = "conflict";
      decision.reasons = ["AMBIGUOUS_SPEC_MATCH"];
      decision.conflicts = [
        {
          conflictType: "ambiguous_match",
          field: null,
          existingValue: matches.map((match) => match.productKey).join(", "),
          incomingValue: row.sizeDisplay,
          catalogueProductId: matches[0].id,
          competingProductId: matches[1].id,
          detail: { supplierListingKey: row.supplierListingKey, candidates: matches.length },
        },
      ];
      return decision;
    }
  }

  // --- 6: a product we have never seen ------------------------------------
  // A row with no usable barcode gets a supplier-specific provisional
  // product: it is not scannable and it is flagged for review, because we
  // cannot yet prove it is distinct from something we already hold.
  const decision = base();
  decision.action = "insert_product";
  decision.strategy = "new_product";
  if (!row.scanReady) decision.reasons.push("PROVISIONAL_NO_VALID_EAN");
  return decision;
}

function pickSpec(spec: ProductSpec): Record<string, unknown> {
  return {
    brand: spec.brand,
    model: spec.modelPattern,
    size: [spec.widthMm, spec.aspectRatio, spec.rimInch].join("/"),
    li: spec.loadIndex,
    si: spec.speedRating,
    xl: spec.xl,
    runFlat: spec.runFlat,
    season: spec.season,
  };
}

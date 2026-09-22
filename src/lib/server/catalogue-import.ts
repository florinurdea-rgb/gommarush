import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { readSheet, listSheetNames, missingColumns, WorkbookError } from "@/lib/catalogue/xlsx-reader";
import { getAdapter } from "@/lib/catalogue/isb-adapter";
import { matchRow, type ExistingListing, type ExistingProduct, type MatchContext } from "@/lib/catalogue/matching";
import { logError, logEvent } from "@/lib/logger";
import type {
  ImportMode,
  NormalizedCatalogueRow,
  NormalizedRowOutcome,
  RowAction,
} from "@/lib/types/catalogue";

/**
 * The catalogue import pipeline.
 *
 * Two phases, and the split between them is the safety property:
 *
 *   analyze  reads the file, normalises every row, matches it against what
 *            we hold, and writes the whole decision into staging. It changes
 *            NOTHING in the catalogue. An operator can look at the result and
 *            walk away.
 *
 *   commit   replays those already-recorded decisions in batches, each batch
 *            atomic inside gorush_commit_catalogue_batch. It re-decides
 *            nothing, so what an operator approved is exactly what lands.
 *
 * Because every decision is stored as a change set before anything is
 * written, an interrupted commit resumes where it stopped
 * (catalogue_import_rows.committed_at) and a completed one can be explained
 * row by row afterwards.
 */

/** Rows per commit batch. Small enough that no request approaches a timeout. */
export const DEFAULT_BATCH_SIZE = 400;
/** Rows per staging insert. Larger than a commit batch: it is one plain insert. */
const STAGING_CHUNK = 500;
/** PostgREST caps a select at 1000 rows; everything below pages at this size. */
const PAGE_SIZE = 1000;

export function checksumOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface AnalyzeInput {
  bytes: Buffer;
  fileName: string;
  adapterId: string;
  supplierId: string;
  importMode: ImportMode;
  uploadedBy: string;
  storageBucket?: string | null;
  storagePath?: string | null;
}

export interface ImportSummary {
  sourceRows: number;
  valid: number;
  review: number;
  rejected: number;
  newProducts: number;
  newListings: number;
  updatedListings: number;
  unchangedListings: number;
  conflicts: number;
  proposedDeactivations: number;
  newEans: number;
  newWeights: number;
  missingEans: number;
  invalidEans: number;
  missingWeights: number;
  truncated: boolean;
  /**
   * Rows skipped as spreadsheet padding rather than data. Counted so a file
   * exported through Excel's full grid is visibly explained, not silently
   * shrunk.
   */
  paddingRows: number;
}

export interface AnalyzeResult {
  runId: string;
  /** Set when this exact file has already been committed for this supplier. */
  duplicateOfRunId: string | null;
  summary: ImportSummary;
  /** Row-level problems, capped, each naming its source row. */
  errors: { sourceRow: number; messages: string[] }[];
}

function emptySummary(): ImportSummary {
  return {
    sourceRows: 0, valid: 0, review: 0, rejected: 0,
    newProducts: 0, newListings: 0, updatedListings: 0, unchangedListings: 0,
    conflicts: 0, proposedDeactivations: 0, newEans: 0, newWeights: 0,
    missingEans: 0, invalidEans: 0, missingWeights: 0, truncated: false,
    paddingRows: 0,
  };
}

/** Pages a select past PostgREST's 1000-row ceiling. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

async function loadMatchContext(supplierId: string): Promise<MatchContext> {
  const supabase = createSupabaseAdminClient();

  const listings = await fetchAll<Record<string, unknown>>((from, to) =>
    supabase
      .from("supplier_product_listings")
      .select("id, supplier_id, supplier_listing_key, supplier_article_id, catalogue_product_id, supplier_item_code, old_dot, active")
      .eq("supplier_id", supplierId)
      .range(from, to)
  );

  const products = await fetchAll<Record<string, unknown>>((from, to) =>
    supabase
      .from("catalogue_products")
      .select(
        "id, product_key, ean, ean_status, brand, brand_code, model_pattern, width_mm, aspect_ratio, rim_inch, load_index, speed_rating, xl, run_flat, season, e_mark, manufacturer_product_code, weight_kg, weight_status, scan_ready, review_required, product_class, description, size_display, load_speed_raw, weight_category, european, eprel_id, old_dot"
      )
      .range(from, to)
  );

  const context: MatchContext = {
    supplierId,
    listingByKey: new Map(),
    listingBySupplierArticle: new Map(),
    productByEan: new Map(),
    productByKey: new Map(),
    productById: new Map(),
    productsByManufacturerCode: new Map(),
  };

  for (const raw of listings) {
    const listing: ExistingListing = {
      id: String(raw.id),
      supplierId: String(raw.supplier_id),
      supplierListingKey: String(raw.supplier_listing_key),
      supplierArticleId: String(raw.supplier_article_id),
      catalogueProductId: String(raw.catalogue_product_id),
      supplierItemCode: (raw.supplier_item_code as string | null) ?? null,
      oldDot: Boolean(raw.old_dot),
      active: Boolean(raw.active),
    };
    context.listingByKey.set(listing.supplierListingKey, listing);
    context.listingBySupplierArticle.set(`${supplierId}:${listing.supplierArticleId}`, listing);
  }

  for (const raw of products) {
    const product: ExistingProduct = {
      id: String(raw.id),
      productKey: String(raw.product_key),
      ean: (raw.ean as string | null) ?? null,
      eanStatus: String(raw.ean_status ?? "missing"),
      brand: (raw.brand as string | null) ?? null,
      brandCode: (raw.brand_code as string | null) ?? null,
      modelPattern: (raw.model_pattern as string | null) ?? null,
      widthMm: (raw.width_mm as number | null) ?? null,
      aspectRatio: (raw.aspect_ratio as number | null) ?? null,
      rimInch: (raw.rim_inch as number | null) ?? null,
      loadIndex: (raw.load_index as string | null) ?? null,
      speedRating: (raw.speed_rating as string | null) ?? null,
      xl: (raw.xl as boolean | null) ?? null,
      runFlat: (raw.run_flat as boolean | null) ?? null,
      season: (raw.season as string | null) ?? null,
      eMark: (raw.e_mark as string | null) ?? null,
      manufacturerProductCode: (raw.manufacturer_product_code as string | null) ?? null,
      weightKg: raw.weight_kg === null || raw.weight_kg === undefined ? null : Number(raw.weight_kg),
      weightStatus: String(raw.weight_status ?? "missing_or_zero"),
      scanReady: Boolean(raw.scan_ready),
      reviewRequired: Boolean(raw.review_required),
      productClass: (raw.product_class as string | null) ?? null,
      description: (raw.description as string | null) ?? null,
      sizeDisplay: (raw.size_display as string | null) ?? null,
      loadSpeedRaw: (raw.load_speed_raw as string | null) ?? null,
      weightCategory: (raw.weight_category as string | null) ?? null,
      european: (raw.european as boolean | null) ?? null,
      eprelId: (raw.eprel_id as string | null) ?? null,
      oldDot: Boolean(raw.old_dot),
    };
    context.productByKey.set(product.productKey, product);
    context.productById.set(product.id, product);
    if (product.ean) context.productByEan.set(product.ean, product);
    const code = product.manufacturerProductCode?.trim().toUpperCase();
    if (code) {
      const bucket = context.productsByManufacturerCode.get(code) ?? [];
      bucket.push(product);
      context.productsByManufacturerCode.set(code, bucket);
    }
  }

  return context;
}

/** The catalogue_products payload for a row that has no product yet. */
function productPayload(row: NormalizedCatalogueRow): Record<string, unknown> {
  return {
    product_key: row.productKey,
    ean: row.ean,
    ean_status: row.eanStatus,
    manufacturer_product_code: row.manufacturerProductCode,
    brand_code: row.brandCode,
    brand: row.brand,
    model_pattern: row.modelPattern,
    description: row.description,
    product_class: row.productClass,
    season: row.season,
    width_mm: row.widthMm,
    aspect_ratio: row.aspectRatio,
    rim_inch: row.rimInch,
    size_display: row.sizeDisplay,
    load_speed_raw: row.loadSpeedRaw,
    load_index: row.loadIndex,
    speed_rating: row.speedRating,
    xl: row.xl,
    run_flat: row.runFlat,
    old_dot: row.oldDot,
    // The database refuses a weight without provenance, so both travel together.
    weight_kg: row.weightStatus === "supplier_reported" ? row.weightKg : null,
    weight_status: row.weightStatus,
    weight_category: row.weightCategory,
    e_mark: row.eMark,
    european: row.european,
    eprel_id: row.eprelId,
    scan_ready: row.scanReady,
    review_required: row.reviewRequired,
    review_reasons: row.reviewReasons,
  };
}

function listingPayload(row: NormalizedCatalogueRow): Record<string, unknown> {
  return {
    supplier_listing_key: row.supplierListingKey,
    supplier_article_id: row.supplierArticleId,
    supplier_item_code: row.supplierItemCode,
    source_product_key: row.sourceProductKey,
    source_row: row.sourceRow,
    old_dot: row.oldDot,
  };
}

/** Every code this row lets us resolve back to the product. */
function identifierPayloads(row: NormalizedCatalogueRow): Record<string, unknown>[] {
  const identifiers: Record<string, unknown>[] = [];

  // Only a barcode that validated here becomes a scannable identifier.
  if (row.ean && row.scanReady) {
    identifiers.push({
      identifier_type: "ean",
      identifier_value: row.eanRaw ?? row.ean,
      normalized_value: row.ean,
      validation_status: row.eanStatus,
      supplier_scoped: false,
      source: "import",
    });
  }
  if (row.manufacturerProductCode) {
    identifiers.push({
      identifier_type: "manufacturer_code",
      identifier_value: row.manufacturerProductCode,
      normalized_value: row.manufacturerProductCode.trim().toUpperCase(),
      validation_status: "unverified",
      supplier_scoped: false,
      source: "import",
    });
  }
  identifiers.push({
    identifier_type: "supplier_article_code",
    identifier_value: row.supplierArticleId,
    normalized_value: row.supplierArticleId.trim().toUpperCase(),
    validation_status: "unverified",
    supplier_scoped: true,
    source: "import",
  });

  return identifiers;
}

function pricePayload(row: NormalizedCatalogueRow): Record<string, unknown> | null {
  if (row.purchasePrice === null && row.stockRaw === null) return null;
  return {
    purchase_price: row.purchasePrice,
    currency: "EUR",
    stock_raw: row.stockRaw,
    stock_exact: row.stockExact,
    stock_minimum: row.stockMinimum,
  };
}

export async function analyzeCatalogueImport(input: AnalyzeInput): Promise<AnalyzeResult> {
  const supabase = createSupabaseAdminClient();
  const adapter = getAdapter(input.adapterId);
  if (!adapter) throw new WorkbookError("UNKNOWN_ADAPTER", input.adapterId);

  const checksum = checksumOf(input.bytes);

  // Idempotency. Only a COMMITTED run blocks — a failed or cancelled attempt
  // at the same file must stay retryable.
  const { data: existing } = await supabase
    .from("catalogue_import_runs")
    .select("id")
    .eq("supplier_id", input.supplierId)
    .eq("adapter", adapter.id)
    .eq("file_checksum", checksum)
    .eq("status", "committed")
    .maybeSingle();

  if (existing) {
    return {
      runId: String((existing as { id: string }).id),
      duplicateOfRunId: String((existing as { id: string }).id),
      summary: emptySummary(),
      errors: [],
    };
  }

  const { data: created, error: createError } = await supabase
    .from("catalogue_import_runs")
    .insert({
      supplier_id: input.supplierId,
      adapter: adapter.id,
      original_filename: input.fileName.slice(0, 255),
      file_checksum: checksum,
      file_size: input.bytes.byteLength,
      storage_bucket: input.storageBucket ?? null,
      storage_path: input.storagePath ?? null,
      import_mode: input.importMode,
      status: "analyzing",
      uploaded_by: input.uploadedBy,
      batch_size: DEFAULT_BATCH_SIZE,
    })
    .select("id")
    .single();

  if (createError) throw createError;
  const runId = String((created as { id: string }).id);

  try {
    // An adapter may choose its own sheet: Inter-Sprint names the sheet after
    // the file, with an account prefix we have no document for.
    let sheetName = adapter.sheetName;
    if (adapter.resolveSheetName) {
      const available = await listSheetNames(input.bytes);
      const resolved = adapter.resolveSheetName(available);
      if (!resolved) throw new WorkbookError("SHEET_NOT_FOUND", available.join(", "));
      sheetName = resolved;
    }

    const { headers, rows, truncated } = await readSheet(input.bytes, sheetName);

    const missing = missingColumns(headers, adapter.requiredColumns);
    if (missing.length > 0) {
      throw new WorkbookError("MISSING_COLUMNS", missing.join(", "));
    }

    const summary = emptySummary();
    // Set after the loop, once padding has been discounted.
    summary.truncated = truncated;

    const context = await loadMatchContext(input.supplierId);
    const errors: { sourceRow: number; messages: string[] }[] = [];
    const staged: Record<string, unknown>[] = [];
    const seenKeys = new Map<string, number>();
    const keysInFile = new Set<string>();

    for (const sheetRow of rows) {
      // Padding is dropped before anything else. It is not data, so it is
      // neither validated, counted as a source row, nor staged.
      if (adapter.isPaddingRow?.(sheetRow.cells)) {
        summary.paddingRows++;
        continue;
      }

      const outcome: NormalizedRowOutcome = adapter.normalizeRow(sheetRow.sourceRow, sheetRow.cells);

      if (!outcome.normalized) {
        summary.rejected++;
        if (errors.length < 200) {
          errors.push({ sourceRow: outcome.sourceRow, messages: outcome.validation.errors });
        }
        staged.push({
          import_run_id: runId,
          source_row: outcome.sourceRow,
          supplier_listing_key: null,
          raw_payload: outcome.raw,
          normalized_payload: null,
          validation_result: "rejected",
          validation_errors: outcome.validation.errors,
          action: "rejected",
          review_reasons: [],
        });
        continue;
      }

      const row = outcome.normalized;
      keysInFile.add(row.supplierListingKey);

      // The same listing twice in one file is a source problem: we cannot
      // know which of the two the supplier meant, so neither is applied.
      const firstSeenAt = seenKeys.get(row.supplierListingKey);
      if (firstSeenAt !== undefined) {
        summary.rejected++;
        if (errors.length < 200) {
          errors.push({
            sourceRow: row.sourceRow,
            messages: [`DUPLICATE_SOURCE_ROW: also at row ${firstSeenAt}`],
          });
        }
        staged.push({
          import_run_id: runId,
          source_row: row.sourceRow,
          supplier_listing_key: row.supplierListingKey,
          raw_payload: outcome.raw,
          normalized_payload: row as unknown as Record<string, unknown>,
          validation_result: "rejected",
          validation_errors: [`DUPLICATE_SOURCE_ROW:${firstSeenAt}`],
          action: "rejected",
          change_set: {
            action: "conflict",
            conflicts: [
              {
                conflict_type: "duplicate_source_row",
                supplier_listing_key: row.supplierListingKey,
                field: "supplier_listing_key",
                existing_value: `row ${firstSeenAt}`,
                incoming_value: `row ${row.sourceRow}`,
                detail: { firstSourceRow: firstSeenAt, duplicateSourceRow: row.sourceRow },
              },
            ],
          },
          review_reasons: ["DUPLICATE_SOURCE_ROW"],
        });
        continue;
      }
      seenKeys.set(row.supplierListingKey, row.sourceRow);

      if (row.eanStatus === "missing") summary.missingEans++;
      if (row.eanStatus === "invalid_check_digit") summary.invalidEans++;
      if (row.weightStatus !== "supplier_reported") summary.missingWeights++;

      const decision = matchRow(row, context);
      const action: RowAction = decision.action;

      if (outcome.validation.result === "review") summary.review++;
      else summary.valid++;

      if (decision.reasons.includes("EAN_DISCOVERED")) summary.newEans++;
      if (decision.reasons.includes("WEIGHT_DISCOVERED")) summary.newWeights++;

      if (action === "insert_product") summary.newProducts++;
      else if (action === "insert_listing") summary.newListings++;
      else if (action === "update_listing") summary.updatedListings++;
      else if (action === "unchanged") summary.unchangedListings++;
      else if (action === "conflict") summary.conflicts++;

      // The change set IS the decision, recorded before anything is written.
      // Commit replays it rather than re-deciding, so what was previewed is
      // exactly what lands.
      const changeSet: Record<string, unknown> = {
        action,
        strategy: decision.strategy,
        productId: decision.productId,
        listingId: decision.listingId,
        productChanges: decision.productChanges,
        listingChanges: decision.listingChanges,
        identifiers: identifierPayloads(row),
        price: pricePayload(row),
        conflicts: decision.conflicts.map((conflict) => ({
          conflict_type: conflict.conflictType,
          supplier_listing_key: row.supplierListingKey,
          catalogue_product_id: conflict.catalogueProductId,
          competing_product_id: conflict.competingProductId,
          field: conflict.field,
          existing_value: conflict.existingValue,
          incoming_value: conflict.incomingValue,
          detail: conflict.detail,
        })),
        reasons: decision.reasons,
      };
      if (action === "insert_product") changeSet.product = productPayload(row);
      if (action === "insert_product" || action === "insert_listing") {
        changeSet.listing = listingPayload(row);
      }

      staged.push({
        import_run_id: runId,
        source_row: row.sourceRow,
        supplier_listing_key: row.supplierListingKey,
        raw_payload: outcome.raw,
        normalized_payload: row as unknown as Record<string, unknown>,
        validation_result: outcome.validation.result,
        validation_errors: [],
        match_result: decision.strategy,
        matched_product_id: decision.productId,
        matched_listing_id: decision.listingId,
        action,
        change_set: changeSet,
        review_reasons: [...row.reviewReasons, ...decision.reasons],
      });
    }

    // Source rows are the rows that carried data. Padding is excluded so the
    // count matches what an operator sees in the supplier's own file.
    summary.sourceRows = rows.length - summary.paddingRows;

    // A listing we hold but the file does not mention. ONLY a complete
    // snapshot may propose deactivating it; a partial file says nothing
    // about what it omits.
    if (input.importMode === "complete") {
      for (const [key, listing] of context.listingByKey) {
        if (keysInFile.has(key) || !listing.active) continue;
        summary.proposedDeactivations++;
        staged.push({
          import_run_id: runId,
          source_row: 0,
          supplier_listing_key: key,
          raw_payload: {},
          normalized_payload: null,
          validation_result: "valid",
          validation_errors: [],
          match_result: "existing_listing_key",
          matched_listing_id: listing.id,
          matched_product_id: listing.catalogueProductId,
          action: "deactivate_listing",
          change_set: { action: "deactivate_listing", listingId: listing.id },
          review_reasons: ["ABSENT_FROM_COMPLETE_SNAPSHOT"],
        });
      }
    }

    for (let index = 0; index < staged.length; index += STAGING_CHUNK) {
      const { error } = await supabase
        .from("catalogue_import_rows")
        .insert(staged.slice(index, index + STAGING_CHUNK));
      if (error) throw error;
    }

    const { error: updateError } = await supabase
      .from("catalogue_import_runs")
      .update({
        status: "previewed",
        analyzed_at: new Date().toISOString(),
        source_row_count: summary.sourceRows,
        rejected_rows: summary.rejected,
        missing_ean_count: summary.missingEans,
        invalid_ean_count: summary.invalidEans,
        missing_weight_count: summary.missingWeights,
      })
      .eq("id", runId);
    if (updateError) throw updateError;

    logEvent("catalogue_import_analyzed", {
      runId,
      supplierId: input.supplierId,
      sourceRows: summary.sourceRows,
      newProducts: summary.newProducts,
      conflicts: summary.conflicts,
    });

    return { runId, duplicateOfRunId: null, summary, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    const code = error instanceof WorkbookError ? error.code : "ANALYSIS_FAILED";
    await supabase
      .from("catalogue_import_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error_summary: `${code}: ${message}` })
      .eq("id", runId);
    logError("catalogue_import_analyze_failed", error, { runId });
    throw error;
  }
}

export interface CommitResult {
  runId: string;
  applied: number;
  newProducts: number;
  insertedListings: number;
  updatedListings: number;
  updatedProducts: number;
  unchanged: number;
  deactivated: number;
  conflicts: number;
  /** False when the run still has staged rows left to apply. */
  finished: boolean;
}

/**
 * Applies a previewed run.
 *
 * Batched, and resumable: only rows whose committed_at is null are fetched,
 * so calling this again after a timeout continues rather than repeating. The
 * run reaches 'committed' only when nothing is left, which is what makes
 * "partially committed" a state you can see rather than one you discover.
 */
export async function commitCatalogueImport(
  runId: string,
  actor: string,
  options: { maxBatches?: number } = {}
): Promise<CommitResult> {
  const supabase = createSupabaseAdminClient();

  const { data: run, error: runError } = await supabase
    .from("catalogue_import_runs")
    .select("id, supplier_id, status, batch_size")
    .eq("id", runId)
    .maybeSingle();
  if (runError) throw runError;
  if (!run) throw new WorkbookError("RUN_NOT_FOUND", runId);

  const record = run as { id: string; supplier_id: string; status: string; batch_size: number };
  if (record.status !== "previewed" && record.status !== "committing") {
    throw new WorkbookError("RUN_NOT_COMMITTABLE", record.status);
  }

  await supabase
    .from("catalogue_import_runs")
    .update({ status: "committing", committed_at: new Date().toISOString() })
    .eq("id", runId);

  const batchSize = record.batch_size || DEFAULT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? Number.MAX_SAFE_INTEGER;

  const totals: CommitResult = {
    runId, applied: 0, newProducts: 0, insertedListings: 0, updatedListings: 0,
    updatedProducts: 0, unchanged: 0, deactivated: 0, conflicts: 0, finished: false,
  };

  try {
    for (let batch = 0; batch < maxBatches; batch++) {
      const { data: pending, error: pendingError } = await supabase
        .from("catalogue_import_rows")
        .select("id, change_set, action")
        .eq("import_run_id", runId)
        .is("committed_at", null)
        .neq("action", "rejected")
        .order("source_row", { ascending: true })
        .limit(batchSize);
      if (pendingError) throw pendingError;

      const rows = (pending ?? []) as { id: string; change_set: Record<string, unknown> | null }[];
      if (rows.length === 0) {
        totals.finished = true;
        break;
      }

      const operations = rows
        .filter((row) => row.change_set)
        .map((row) => ({ ...(row.change_set as Record<string, unknown>), importRowId: row.id }));

      const { data: applied, error: rpcError } = await supabase.rpc("gorush_commit_catalogue_batch", {
        payload: { runId, supplierId: record.supplier_id, operations },
      });
      if (rpcError) throw rpcError;

      const result = (applied ?? {}) as Record<string, number>;
      totals.applied += result.applied ?? 0;
      totals.newProducts += result.newProducts ?? 0;
      totals.insertedListings += result.insertedListings ?? 0;
      totals.updatedListings += result.updatedListings ?? 0;
      totals.updatedProducts += result.updatedProducts ?? 0;
      totals.unchanged += result.unchanged ?? 0;
      totals.deactivated += result.deactivated ?? 0;
      totals.conflicts += result.conflicts ?? 0;

      // A batch that applied nothing would loop forever; stop and report.
      if ((result.applied ?? 0) === 0) break;
    }

    if (totals.finished) {
      await supabase
        .from("catalogue_import_runs")
        .update({ status: "committed", finished_at: new Date().toISOString() })
        .eq("id", runId);
    }

    logEvent("catalogue_import_committed", { actor, ...totals });
    return totals;
  } catch (error) {
    await supabase
      .from("catalogue_import_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_summary: error instanceof Error ? error.message : "COMMIT_FAILED",
      })
      .eq("id", runId);
    logError("catalogue_import_commit_failed", error, { runId });
    throw error;
  }
}

export async function cancelCatalogueImport(runId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("catalogue_import_runs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", runId)
    .in("status", ["uploaded", "analyzing", "previewed"]);
  if (error) throw error;
}

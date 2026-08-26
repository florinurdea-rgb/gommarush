import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { downloadDocumentBytes, recordUploadedDocument } from "@/lib/server/documents";
import { findOrCreateSupplier } from "@/lib/server/reference";
import { matchCustomerFromDocument, resolveCustomerForOrder } from "@/lib/server/customers";
import type { ResolveCustomerInput } from "@/lib/server/customers";
import { createOrder } from "@/lib/server/orders";
import { getTransportRatePerTyre } from "@/lib/server/settings";
import { extractDdtDocuments } from "@/lib/ddt-import/extractor";
import { processExtractedDocument } from "@/lib/ddt-import/pipeline";
import type { ProcessedDocument } from "@/lib/ddt-import/pipeline";
import { calculateTransportRevenue } from "@/lib/logistics/ddt-calculations";
import type { OrderIdentity } from "@/lib/logistics/ddt-dedup";
import type { CustomerMatchResult } from "@/lib/logistics/customer-matching";
import { logError, logEvent } from "@/lib/logger";
import { isMissingSchemaError } from "@/lib/server/schema-errors";
import type { ItemType } from "@/lib/types/logistics";

/**
 * Orchestrates the multi-DDT import pipeline end to end:
 *
 *   upload -> store original -> AI extraction (N documents) -> for each:
 *   resolve/create supplier -> load that supplier's existing DDT numbers +
 *   recent fingerprints -> deterministic classification/counting/dedup
 *   (src/lib/ddt-import/pipeline.ts) -> preview the customer match
 *   -> READY / NEEDS_REVIEW / POSSIBLE_DUPLICATE / DUPLICATE
 *
 * Nothing is written as an order here — analyzeDdtUpload() only proposes.
 * confirmDdtDocument() is the only function that creates one, and only for
 * a single document the Admin has explicitly confirmed.
 */

const LINE_TYPE_TO_ITEM_TYPE: Partial<Record<string, ItemType>> = {
  TYRE: "tyre",
  TUBE: "tube",
  RIM: "wheel",
  OTHER_PHYSICAL_ITEM: "other",
};

const CHARGE_TYPES = new Set(["PFU", "LOGISTICS_FEE", "TRANSPORT_FEE", "DISCOUNT", "VAT", "OTHER_FEE"]);

export interface ProcessedDocumentWithMatch extends ProcessedDocument {
  supplierId: string | null;
  customerMatch: CustomerMatchResult | null;
}

export interface DdtUploadResult {
  documentId: string;
  pageCount: number | null;
  documents: ProcessedDocumentWithMatch[];
  summary: {
    documentsFound: number;
    ready: number;
    readyMissingOptional: number;
    needsReview: number;
    possibleDuplicate: number;
    duplicate: number;
    totalTyres: number;
  };
  /** True when AI extraction isn't configured — an expected, disclosed state, never an error. */
  unconfigured: boolean;
  notes: string[];
  /** A genuine technical failure (timeout, HTTP error, malformed response) — distinct from "unconfigured". */
  error: string | null;
}

async function getExistingOrderIdentities(supplierId: string): Promise<OrderIdentity[]> {
  const supabase = createSupabaseAdminClient();
  // Deliberately NOT filtered to `normalized_document_number is not null`:
  // an order created before that column existed (or whose backfill update
  // failed on a prior confirm attempt) has it NULL, but still has a real
  // supplier_document_number — findExactDuplicate() falls back to
  // normalizing that raw value on the fly. Filtering those rows out here
  // is exactly what let an already-imported document look READY again and
  // crash on the database's own unique constraint instead of showing
  // "DEJA IMPORTAT".
  const { data, error } = await supabase
    .from("orders")
    .select("id, supplier_id, normalized_document_number, supplier_document_number")
    .eq("supplier_id", supplierId)
    .not("supplier_document_number", "is", null);

  if (isMissingSchemaError(error)) {
    // normalized_document_number doesn't exist yet — the DDT-import migration
    // (20260819000000_ddt_import_system.sql) hasn't been run. Degrade to "no
    // known orders" rather than crashing the whole upload: every document
    // just can't be exact-duplicate-checked until it's run.
    logError("ddt_import_normalized_document_number_missing", error);
    return [];
  }
  if (error) throw error;

  return (
    (data ?? []) as {
      id: string;
      supplier_id: string;
      normalized_document_number: string | null;
      supplier_document_number: string | null;
    }[]
  ).map((row) => ({
    id: row.id,
    supplierId: row.supplier_id,
    normalizedDocumentNumber: row.normalized_document_number,
    supplierDocumentNumber: row.supplier_document_number,
  }));
}

async function getRecentFingerprints(limit = 2000): Promise<{ orderId: string; fingerprint: string }[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, fingerprint")
    .not("fingerprint", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (isMissingSchemaError(error)) {
    logError("ddt_import_fingerprint_column_missing", error);
    return [];
  }
  if (error) throw error;

  return ((data ?? []) as { id: string; fingerprint: string | null }[])
    .filter((row): row is { id: string; fingerprint: string } => row.fingerprint !== null)
    .map((row) => ({ orderId: row.id, fingerprint: row.fingerprint }));
}

export async function analyzeDdtUpload(input: {
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
}): Promise<DdtUploadResult> {
  const stored = await recordUploadedDocument(input);
  const bytes = await downloadDocumentBytes(input.storagePath);

  const extraction = await extractDdtDocuments({ bytes, fileName: input.fileName, mimeType: input.mimeType });

  // "unconfigured" is an expected, disclosed state (see
  // src/lib/ddt-import/extractor.ts's fallback) — never surfaced as an
  // error. The document is stored either way; only a genuine technical
  // failure ("failed") gets treated as one.
  if (extraction.status === "unconfigured") {
    return {
      documentId: stored.id,
      pageCount: extraction.pageCount,
      documents: [],
      summary: {
        documentsFound: 0,
        ready: 0,
        readyMissingOptional: 0,
        needsReview: 0,
        possibleDuplicate: 0,
        duplicate: 0,
        totalTyres: 0,
      },
      unconfigured: true,
      notes: extraction.notes,
      error: null,
    };
  }

  if (extraction.status === "failed") {
    return {
      documentId: stored.id,
      pageCount: extraction.pageCount,
      documents: [],
      summary: {
        documentsFound: 0,
        ready: 0,
        readyMissingOptional: 0,
        needsReview: 0,
        possibleDuplicate: 0,
        duplicate: 0,
        totalTyres: 0,
      },
      unconfigured: false,
      notes: extraction.notes,
      error: extraction.error,
    };
  }

  const recentFingerprints = await getRecentFingerprints();
  const supplierCache = new Map<string, string>();
  // A multi-DDT upload very often has several documents from the same
  // supplier (see this function's own callers) — without this cache,
  // getExistingOrderIdentities() re-ran the identical query once per
  // document instead of once per DISTINCT supplier in the batch.
  const existingOrdersBySupplier = new Map<string, Awaited<ReturnType<typeof getExistingOrderIdentities>>>();

  const processed: ProcessedDocumentWithMatch[] = [];

  for (const extracted of extraction.documents) {
    let supplierId: string | null = null;
    if (extracted.supplier.name) {
      const cacheKey = extracted.supplier.name.trim().toLowerCase();
      supplierId = supplierCache.get(cacheKey) ?? null;
      if (!supplierId) {
        const supplier = await findOrCreateSupplier({
          name: extracted.supplier.name,
          vatNumber: extracted.supplier.vatNumber,
        });
        supplierId = supplier.id;
        supplierCache.set(cacheKey, supplierId);
      }
    }

    let existingOrders: Awaited<ReturnType<typeof getExistingOrderIdentities>> = [];
    if (supplierId) {
      existingOrders = existingOrdersBySupplier.get(supplierId) ?? (await getExistingOrderIdentities(supplierId));
      existingOrdersBySupplier.set(supplierId, existingOrders);
    }

    const result = processExtractedDocument({
      extracted,
      supplierId,
      existingOrders,
      existingFingerprints: recentFingerprints,
    });

    const customerMatch =
      result.status === "DUPLICATE"
        ? null // no point matching a customer for a document we won't import
        : extracted.customer.companyName
          ? await matchCustomerFromDocument({
              extractedCustomer: {
                companyName: extracted.customer.companyName,
                vatNumber: extracted.customer.vatNumber,
                fiscalCode: extracted.customer.fiscalCode,
                supplierCustomerCode: extracted.customer.supplierCustomerCode,
              },
              extractedLocation: {
                recipientName: extracted.customer.deliveryRecipient,
                addressLine1: extracted.customer.addressLine1,
                addressLine2: extracted.customer.addressLine2,
                city: extracted.customer.city,
                province: extracted.customer.province,
                postalCode: extracted.customer.postalCode,
                country: extracted.customer.country,
              },
              supplierId,
            })
          : null;

    processed.push({ ...result, supplierId, customerMatch });
  }

  const summary = {
    documentsFound: processed.length,
    ready: processed.filter((d) => d.status === "READY").length,
    readyMissingOptional: processed.filter((d) => d.status === "READY_MISSING_OPTIONAL").length,
    needsReview: processed.filter((d) => d.status === "NEEDS_REVIEW").length,
    possibleDuplicate: processed.filter((d) => d.status === "POSSIBLE_DUPLICATE").length,
    duplicate: processed.filter((d) => d.status === "DUPLICATE").length,
    totalTyres: processed.reduce((sum, d) => sum + d.tyreCount, 0),
  };

  logEvent("ddt_upload_analyzed", {
    documentId: stored.id,
    documentsFound: summary.documentsFound,
    ready: summary.ready,
    needsReview: summary.needsReview,
    duplicate: summary.duplicate,
  });

  return {
    documentId: stored.id,
    pageCount: extraction.pageCount,
    documents: processed,
    summary,
    unconfigured: false,
    notes: extraction.notes,
    error: null,
  };
}

export interface ConfirmDdtDocumentInput {
  processed: ProcessedDocumentWithMatch;
  sourceDocumentId: string;
  /** The Admin's decision for the customer (existing/new/location resolution) — same shape as the single-document flow. */
  customerResolution: Omit<ResolveCustomerInput, "address" | "supplierId">;
  changedBy: string;
}

export interface ConfirmDdtDocumentResult {
  orderId: string;
  orderNumber: string;
  tyreCount: number;
  transportRevenue: number;
  /** Physical lines whose quantity couldn't be read — never guessed, so never saved; the admin adds them manually from the order page. */
  droppedLineCount: number;
}

/**
 * Advances a DDT-confirmed order from 'expected' to 'stored' ("De
 * pregătit") — a scanned document should be immediately visible/actionable
 * there instead of sitting in "In attesa merce". Idempotent by design and
 * exported (not inlined in confirmDdtDocument) because the confirm route's
 * retry-recovery path (findExistingOrder in
 * app/api/admin/ddt-import/confirm/route.ts) can return a PREVIOUSLY
 * created order instead of running confirmDdtDocument again — without this
 * being callable from there too, an order whose first confirm attempt
 * created it but failed partway through the status advance (a schema-cache
 * hiccup, a dropped connection, …) would stay stuck at 'expected' forever:
 * every retry would just keep returning the same never-advanced order.
 *
 * Checks the order's CURRENT status first and no-ops if it's already past
 * 'expected' — both so calling this twice is harmless, and so it never
 * rolls a further-progressed order (already 'sorting', 'ready_for_loading',
 * …) backward to 'stored'.
 */
export async function advanceDdtOrderToStored(input: {
  orderId: string;
  processed: ProcessedDocumentWithMatch;
  ratePerTyre: number;
  transportRevenue: number;
  changedBy: string;
}): Promise<void> {
  const { orderId, processed, ratePerTyre, transportRevenue, changedBy } = input;
  const { extracted } = processed;
  const supabase = createSupabaseAdminClient();

  const { data: current, error: currentError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (currentError) {
    logError("ddt_confirm_status_lookup_failed", currentError, { orderId });
    return;
  }
  if (!current || (current as { status: string }).status !== "expected") {
    // Already advanced (by this same call on an earlier attempt, or by the
    // real warehouse flow since) — nothing to do.
    return;
  }

  const receivedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: "stored",
      received_at: receivedAt,
      stored_at: receivedAt,
      normalized_document_number: processed.normalizedDocumentNumber,
      tracking_number: extracted.document.trackingNumber,
      giro: extracted.document.giro,
      agent: extracted.document.agent,
      carrier: extracted.document.carrier,
      cash_required: processed.payment.cashRequired,
      cheque_required: processed.payment.chequeRequired,
      tyre_count: processed.tyreCount,
      physical_item_count: processed.physicalItemCount,
      transport_rate_snapshot: ratePerTyre,
      transport_revenue: transportRevenue,
      fingerprint: processed.fingerprint,
      extraction_confidence: extracted.confidence,
    })
    .eq("id", orderId)
    .eq("status", "expected");

  if (isMissingSchemaError(updateError)) {
    logError("ddt_import_columns_missing_on_confirm", updateError, { orderId });
    // The DDT-specific columns above may be genuinely missing, but status/
    // received_at/stored_at are base columns that have always existed —
    // still worth trying to advance those on their own so the order isn't
    // stuck at "In attesa merce" just because a later migration hasn't run.
    const { error: statusOnlyError } = await supabase
      .from("orders")
      .update({ status: "stored", received_at: receivedAt, stored_at: receivedAt })
      .eq("id", orderId)
      .eq("status", "expected");
    if (statusOnlyError) logError("ddt_confirm_status_fallback_failed", statusOnlyError, { orderId });
  } else if (updateError) {
    logError("ddt_import_order_update_failed", updateError, { orderId });
  }

  const { error: unitsError } = await supabase
    .from("inventory_units")
    .update({ status: "stored", received_at: receivedAt, stored_at: receivedAt })
    .eq("order_id", orderId)
    .eq("status", "expected");
  if (unitsError) logError("ddt_confirm_units_update_failed", unitsError, { orderId });

  const { error: historyError } = await supabase.from("order_status_history").insert({
    order_id: orderId,
    old_status: "expected",
    new_status: "stored",
    changed_by_label: changedBy,
    notes: "ddt_import_received",
  });
  if (historyError) logError("ddt_confirm_history_insert_failed", historyError, { orderId });
}

/**
 * Creates ONE order from a confirmed document. Reuses createOrder() (the
 * existing atomic order+items+units RPC) for the physical items —
 * PFU/fee lines are deliberately never passed to it, so they can never
 * become order_items/inventory_units. document_charges and the DDT-import
 * columns (tyre_count, transport_revenue, …) are written afterward: real,
 * but not part of the same atomicity boundary as physical inventory.
 */
export async function confirmDdtDocument(input: ConfirmDdtDocumentInput): Promise<ConfirmDdtDocumentResult> {
  const { processed, changedBy } = input;
  const { extracted } = processed;

  const resolvedCustomer = await resolveCustomerForOrder({
    ...input.customerResolution,
    supplierId: processed.supplierId,
    address: {
      recipient_name: extracted.customer.deliveryRecipient,
      address_line1: extracted.customer.addressLine1 ?? "",
      address_line2: extracted.customer.addressLine2,
      city: extracted.customer.city ?? "",
      province: extracted.customer.province,
      postal_code: extracted.customer.postalCode,
      country_code: extracted.customer.country,
      phone: extracted.customer.phone,
    },
  });

  // A line with no readable quantity is dropped, never guessed (never
  // "?? 0", never "?? 1") — see pipeline.ts's importableItemCount, which is
  // exactly this same filter, computed ahead of time so the UI already
  // knows whether anything importable exists before the admin even clicks
  // confirm.
  const droppedLineCount = processed.physicalItems.filter((line) => line.raw.quantity === null).length;

  const items = processed.physicalItems
    .filter((line) => line.raw.quantity !== null)
    .map((line) => {
      const itemType = LINE_TYPE_TO_ITEM_TYPE[line.lineType];
      if (!itemType) return null;
      return {
        item_type: itemType,
        quantity: line.raw.quantity as number,
        supplier_sku: line.raw.supplierArticleCode,
        raw_description: line.raw.rawDescription,
        description: line.raw.rawDescription,
        brand: line.raw.brand,
        model: line.raw.model,
        width: line.raw.width,
        aspect_ratio: line.raw.aspectRatio,
        rim_diameter: line.raw.rimDiameter,
        load_index: line.raw.loadIndex,
        speed_rating: line.raw.speedRating,
        extra_load: line.raw.extraLoad,
        run_flat: line.raw.runFlat,
        unit_price: line.raw.unitPrice,
        tax_rate: line.raw.vatPercent,
        needs_review: processed.status === "NEEDS_REVIEW",
        confidence: extracted.confidence,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (items.length === 0) {
    // Mirrors pipeline.ts's `blocked` check — the UI already refuses to
    // offer a direct confirm for this case, this is the server-side
    // backstop against nothing-to-save actually reaching createOrder().
    throw new Error("NOTHING_IMPORTABLE: no physical line has a readable quantity");
  }

  const created = await createOrder(
    {
      supplier_id: processed.supplierId ?? undefined,
      supplier_document_number: extracted.document.documentNumber,
      supplier_reference: extracted.document.supplierOrderReference,
      supplier_document_date: extracted.document.documentDate,
      source_type: "pdf",
      customer_id: resolvedCustomer.customerId,
      customer_location_id: resolvedCustomer.customerLocationId,
      delivery_recipient: resolvedCustomer.addressSnapshot.recipient_name,
      delivery_address_line1: resolvedCustomer.addressSnapshot.address_line1,
      delivery_address_line2: resolvedCustomer.addressSnapshot.address_line2,
      delivery_city: resolvedCustomer.addressSnapshot.city,
      delivery_province: resolvedCustomer.addressSnapshot.province,
      delivery_postal_code: resolvedCustomer.addressSnapshot.postal_code,
      delivery_country: resolvedCustomer.addressSnapshot.country_code,
      requires_payment_on_delivery: processed.payment.cashRequired || processed.payment.chequeRequired,
      payment_method: processed.payment.paymentMethod,
      collection_method: processed.payment.cashRequired ? "cash" : processed.payment.chequeRequired ? "cheque" : null,
      source_document_id: input.sourceDocumentId,
      items,
    },
    changedBy
  );

  const ratePerTyre = await getTransportRatePerTyre();
  const transportRevenue = calculateTransportRevenue(processed.tyreCount, ratePerTyre);

  const supabase = createSupabaseAdminClient();

  if (processed.charges.length > 0) {
    const { error: chargesError } = await supabase.from("document_charges").insert(
      processed.charges.map((charge, index) => ({
        order_id: created.orderId,
        charge_type: CHARGE_TYPES.has(charge.lineType) ? charge.lineType : "OTHER_FEE",
        description: charge.raw.rawDescription,
        raw_description: charge.raw.rawDescription,
        quantity: charge.raw.quantity,
        unit_amount: charge.raw.unitPrice,
        total_amount: charge.raw.lineTotal,
        line_number: index + 1,
      }))
    );
    if (chargesError) logError("document_charges_insert_failed", chargesError, { orderId: created.orderId });
  }

  await advanceDdtOrderToStored({
    orderId: created.orderId,
    processed,
    ratePerTyre,
    transportRevenue,
    changedBy,
  });

  logEvent("ddt_order_confirmed", {
    orderId: created.orderId,
    tyreCount: processed.tyreCount,
    transportRevenue,
    droppedLineCount,
  });

  return {
    orderId: created.orderId,
    orderNumber: created.orderNumber,
    tyreCount: processed.tyreCount,
    transportRevenue,
    droppedLineCount,
  };
}

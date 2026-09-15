import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError, logEvent } from "@/lib/logger";
import { normaliseDocumentNumber } from "@/lib/logistics/ddt-dedup";
import { extractTransportDocument } from "@/lib/transport/providers/openai-extract";
import { validateExtraction, type ValidationResult } from "@/lib/transport/validate";
import {
  assessDuplicates,
  hashSourceText,
  isConcurrentDuplicateError,
  type DuplicateAssessment,
  type DuplicateCandidate,
} from "@/lib/transport/duplicates";
import {
  mappingToSave,
  matchDistributor,
  matchRecipient,
  type DistributorCandidate,
  type PartyMatch,
  type RecipientCandidate,
  type SavedCustomerRef,
} from "@/lib/transport/matching";
import {
  TRANSPORT_BUSINESS_TYPE,
  initialInboundStatusFor,
  initialOrderStatusFor,
  type InboundMethod,
} from "@/lib/transport/lifecycle";
import { requiresDriverCollection } from "@/lib/transport/payment";
import type { TransportDocumentExtraction } from "@/lib/transport/extraction-schema";

/**
 * The single transport-document ingestion service.
 *
 * Every channel enters here -- pasted text today, PDF-extracted text, email
 * attachments and manual tyre lists later. No UI screen and no route talks to
 * OpenAI directly, because the moment two callers each own a piece of this
 * pipeline they drift, and the payment rule or the duplicate rule ends up
 * enforced in one path and not the other.
 *
 * The division of responsibility is absolute:
 *
 *   analyze  produces a DRAFT. It writes an ingestion row and nothing else.
 *            No order, no customer, no supplier, no delivery.
 *   confirm  is the only thing that creates orders, and it re-derives
 *            everything from the STORED ingestion rather than trusting the
 *            browser. A client that posts an edited payload cannot make the
 *            server create something the document did not support.
 */

export const TRANSPORT_INTAKE_FLAG = "USE_OPENAI_PASTED_TRANSPORT_EXTRACTION";

export function isTransportIntakeEnabled(): boolean {
  return process.env[TRANSPORT_INTAKE_FLAG]?.trim().toLowerCase() === "true";
}

export type IntakeSourceType = "PASTED_TEXT" | "PDF_UPLOAD" | "EMAIL_ATTACHMENT" | "MANUAL_LIST";

export interface DeliveryDraft {
  deliveryIndex: number;
  distributorMatch: PartyMatch;
  recipientMatch: PartyMatch;
  /** Blocking and warning issues for this delivery. */
  validation: ValidationResult["deliveries"][number];
}

export interface AnalyzeResult {
  ingestionId: string;
  status: "extracted" | "needs_review" | "ready_to_create" | "failed";
  extraction: TransportDocumentExtraction | null;
  validation: ValidationResult | null;
  distributorMatch: PartyMatch | null;
  deliveries: DeliveryDraft[];
  duplicates: DuplicateAssessment;
  inboundMethod: InboundMethod;
  /** "Questo documento creera' X ordini di trasporto per un totale di Y pneumatici." */
  summary: { orderCount: number; tyreCount: number };
  model: string | null;
  usedEscalationModel: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Candidate loading
// ---------------------------------------------------------------------------

async function loadDistributorCandidates(name: string | null, vatNumber: string | null): Promise<DistributorCandidate[]> {
  const supabase = createSupabaseAdminClient();
  // Narrow the scan rather than loading every supplier: matching only ever
  // needs rows that could plausibly match on name or VAT.
  const filters: string[] = [];
  if (name?.trim()) filters.push(`name.ilike.%${name.trim().slice(0, 40)}%`);
  const digits = (vatNumber ?? "").replace(/\D/g, "");
  if (digits.length >= 8) filters.push(`vat_number.ilike.%${digits}%`);

  let query = supabase.from("suppliers").select("id, name, vat_number").limit(50);
  if (filters.length > 0) query = query.or(filters.join(","));

  const { data, error } = await query;
  if (error) {
    logError("transport_intake_distributor_lookup_failed", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    vatNumber: (row.vat_number as string | null) ?? null,
  }));
}

async function loadRecipientCandidates(input: {
  companyName: string | null;
  vatNumber: string | null;
  taxCode: string | null;
}): Promise<RecipientCandidate[]> {
  const supabase = createSupabaseAdminClient();
  const filters: string[] = [];
  if (input.companyName?.trim()) filters.push(`name.ilike.%${input.companyName.trim().slice(0, 40)}%`);
  const digits = (input.vatNumber ?? "").replace(/\D/g, "");
  if (digits.length >= 8) filters.push(`vat_number.ilike.%${digits}%`);
  if (input.taxCode?.trim()) filters.push(`fiscal_code.ilike.%${input.taxCode.trim()}%`);

  let query = supabase.from("customers").select("id, name, vat_number, fiscal_code").limit(50);
  if (filters.length > 0) query = query.or(filters.join(","));

  const { data, error } = await query;
  if (error) {
    logError("transport_intake_recipient_lookup_failed", error);
    return [];
  }

  const customerIds = (data ?? []).map((row) => row.id as string);
  if (customerIds.length === 0) return [];

  const { data: locations } = await supabase
    .from("customer_locations")
    .select("id, customer_id, location_name, address_line1, city, postal_code, province")
    .in("customer_id", customerIds);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    vatNumber: (row.vat_number as string | null) ?? null,
    taxCode: (row.fiscal_code as string | null) ?? null,
    locations: (locations ?? [])
      .filter((location) => location.customer_id === row.id)
      .map((location) => ({
        id: location.id as string,
        locationName: (location.location_name as string | null) ?? null,
        addressLine1: (location.address_line1 as string | null) ?? null,
        city: (location.city as string | null) ?? null,
        postalCode: (location.postal_code as string | null) ?? null,
        province: (location.province as string | null) ?? null,
      })),
  }));
}

async function loadSavedRefs(distributorId: string | null): Promise<SavedCustomerRef[]> {
  if (!distributorId) return [];
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("supplier_customer_refs")
    .select("supplier_id, supplier_customer_code, customer_id, customer_location_id, supplier_customer_name")
    .eq("supplier_id", distributorId)
    .limit(500);

  if (error) {
    logError("transport_intake_saved_refs_lookup_failed", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    distributorId: row.supplier_id as string,
    customerCode: row.supplier_customer_code as string,
    customerId: row.customer_id as string,
    customerLocationId: (row.customer_location_id as string | null) ?? null,
    distributorCustomerName: (row.supplier_customer_name as string | null) ?? null,
  }));
}

/**
 * Finds records that resemble the incoming document.
 *
 * Queried on the indexed signals only: the text hash, and the distributor
 * plus normalised document number. Scanning for the weaker signals would mean
 * a table scan per analysis, and they are only useful once a stronger one has
 * already produced a candidate.
 */
async function loadDuplicateCandidates(input: {
  sourceSha256: string;
  distributorId: string | null;
  normalizedDocumentNumber: string | null;
}): Promise<DuplicateCandidate[]> {
  const supabase = createSupabaseAdminClient();
  const candidates = new Map<string, DuplicateCandidate>();

  const { data: byHash } = await supabase
    .from("transport_document_ingestions")
    .select("id, distributor_id, document_number, normalized_document_number, source_sha256, created_order_ids, document_date, created_at")
    .eq("source_sha256", input.sourceSha256)
    .limit(20);

  for (const row of byHash ?? []) {
    const orderIds = (row.created_order_ids as string[] | null) ?? [];
    candidates.set(`ing-${row.id}`, {
      orderId: orderIds[0] ?? null,
      orderNumber: null,
      ingestionId: row.id as string,
      distributorId: (row.distributor_id as string | null) ?? null,
      distributorName: null,
      documentNumber: (row.document_number as string | null) ?? null,
      normalizedDocumentNumber: (row.normalized_document_number as string | null) ?? null,
      supplierOrderReference: null,
      sourceSha256: (row.source_sha256 as string | null) ?? null,
      distributorCustomerCode: null,
      documentDate: (row.document_date as string | null) ?? null,
      createdAt: (row.created_at as string | null) ?? null,
    });
  }

  if (input.distributorId && input.normalizedDocumentNumber) {
    const { data: byOrder } = await supabase
      .from("orders")
      .select("id, order_number, supplier_id, supplier_document_number, normalized_document_number, supplier_order_reference, source_hash, document_date, created_at, transport_ingestion_id")
      .eq("supplier_id", input.distributorId)
      .eq("normalized_document_number", input.normalizedDocumentNumber)
      .limit(20);

    for (const row of byOrder ?? []) {
      candidates.set(`order-${row.id}`, {
        orderId: row.id as string,
        orderNumber: (row.order_number as string | number | null) ?? null,
        ingestionId: (row.transport_ingestion_id as string | null) ?? null,
        distributorId: (row.supplier_id as string | null) ?? null,
        distributorName: null,
        documentNumber: (row.supplier_document_number as string | null) ?? null,
        normalizedDocumentNumber: (row.normalized_document_number as string | null) ?? null,
        supplierOrderReference: (row.supplier_order_reference as string | null) ?? null,
        sourceSha256: (row.source_hash as string | null) ?? null,
        distributorCustomerCode: null,
        documentDate: (row.document_date as string | null) ?? null,
        createdAt: (row.created_at as string | null) ?? null,
      });
    }
  }

  return [...candidates.values()];
}

// ---------------------------------------------------------------------------
// Analyze
// ---------------------------------------------------------------------------

/**
 * Analyzes one transport document and stores a draft.
 *
 * The ingestion row is written BEFORE extraction runs. A provider timeout, a
 * refusal or a crash then leaves a durable record of what arrived and what
 * went wrong, instead of losing the document entirely -- the operator can
 * retry the same ingestion rather than hunting for the original email.
 */
export async function analyzeTransportDocument(input: {
  sourceType: IntakeSourceType;
  sourceReference?: string | null;
  documentText: string;
  createdBy: string;
  correlationId: string;
}): Promise<AnalyzeResult> {
  const supabase = createSupabaseAdminClient();
  const sourceSha256 = hashSourceText(input.documentText);

  // 1. Persist before extracting.
  const { data: created, error: insertError } = await supabase
    .from("transport_document_ingestions")
    .insert({
      source_type: input.sourceType,
      source_reference: input.sourceReference ?? null,
      source_text: input.documentText,
      source_sha256: sourceSha256,
      status: "extracting",
      provider: "openai",
      correlation_id: input.correlationId,
      created_by: input.createdBy,
      attempt_count: 1,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    logError("transport_intake_ingestion_insert_failed", insertError, { correlationId: input.correlationId });
    throw insertError ?? new Error("INGESTION_INSERT_FAILED");
  }

  const ingestionId = created.id as string;

  const fail = async (code: string, message: string): Promise<AnalyzeResult> => {
    await supabase
      .from("transport_document_ingestions")
      .update({ status: "failed", error_code: code, error_message: message })
      .eq("id", ingestionId);

    return {
      ingestionId,
      status: "failed",
      extraction: null,
      validation: null,
      distributorMatch: null,
      deliveries: [],
      duplicates: { verdict: "NONE", matches: [], blocksConfirmation: false },
      inboundMethod: "UNKNOWN",
      summary: { orderCount: 0, tyreCount: 0 },
      model: null,
      usedEscalationModel: false,
      errorCode: code,
      errorMessage: message,
    };
  };

  // 2. Extract.
  const outcome = await extractTransportDocument({
    documentText: input.documentText,
    correlationId: input.correlationId,
  });

  const lastAttempt = outcome.attempts.at(-1) ?? null;

  if (outcome.status === "failed") {
    await supabase
      .from("transport_document_ingestions")
      .update({
        provider_model: lastAttempt?.model ?? null,
        provider_request_id: lastAttempt?.requestId ?? null,
        used_escalation_model: outcome.usedEscalationModel,
        attempt_count: outcome.attempts.length,
      })
      .eq("id", ingestionId);
    return fail(outcome.code, outcome.message);
  }

  const extraction = outcome.extraction;

  // 3. Validate deterministically.
  const validation = validateExtraction(extraction);

  // 4. Match the distributor, then the recipients (recipient matching needs
  //    the distributor id to look up its saved customer codes).
  const distributorCandidates = await loadDistributorCandidates(
    extraction.distributor.name,
    extraction.distributor.vatNumber
  );
  const distributorMatch = matchDistributor({
    incoming: { name: extraction.distributor.name, vatNumber: extraction.distributor.vatNumber },
    candidates: distributorCandidates,
  });
  const distributorId = distributorMatch.party?.id ?? null;
  const savedRefs = await loadSavedRefs(distributorId);

  const deliveries: DeliveryDraft[] = [];
  for (const [index, delivery] of extraction.deliveries.entries()) {
    const recipientCandidates = await loadRecipientCandidates({
      companyName: delivery.recipient.companyName,
      vatNumber: delivery.recipient.vatNumber,
      taxCode: delivery.recipient.taxCode,
    });

    deliveries.push({
      deliveryIndex: index,
      distributorMatch,
      recipientMatch: matchRecipient({
        incoming: {
          companyName: delivery.recipient.companyName,
          vatNumber: delivery.recipient.vatNumber,
          taxCode: delivery.recipient.taxCode,
          customerCode: delivery.recipient.customerCode,
          addressLine: delivery.recipient.addressLine,
          city: delivery.recipient.city,
          postalCode: delivery.recipient.postalCode,
          province: delivery.recipient.province,
        },
        distributorId,
        candidates: recipientCandidates,
        savedRefs,
      }),
      validation: validation.deliveries[index],
    });
  }

  // 5. Duplicates.
  const documentNumber = extraction.documentClassification.documentNumber;
  const normalizedDocumentNumber = documentNumber?.trim() ? normaliseDocumentNumber(documentNumber.trim()) : null;

  const duplicates = assessDuplicates({
    incoming: {
      distributorId,
      documentNumber,
      supplierOrderReference: extraction.deliveries[0]?.supplierOrderReference ?? null,
      sourceSha256,
      distributorCustomerCode: extraction.deliveries[0]?.recipient.customerCode ?? null,
      documentDate: extraction.documentClassification.documentDate,
    },
    candidates: await loadDuplicateCandidates({ sourceSha256, distributorId, normalizedDocumentNumber }),
  });

  // 6. Decide the status.
  //
  // ready_to_create requires everything: no blocking validation issue, no
  // exact duplicate, a distributor and a recipient that need no confirmation.
  // Anything else is needs_review -- which is the normal outcome, not a
  // failure.
  const everyPartyResolved =
    !distributorMatch.requiresConfirmation &&
    deliveries.length > 0 &&
    deliveries.every((draft) => !draft.recipientMatch.requiresConfirmation && draft.recipientMatch.party !== null);

  const status: AnalyzeResult["status"] =
    validation.canConfirmAll && !duplicates.blocksConfirmation && everyPartyResolved
      ? "ready_to_create"
      : "needs_review";

  const inboundMethod = extraction.inboundLogistics.method;

  await supabase
    .from("transport_document_ingestions")
    .update({
      status,
      distributor_id: distributorId,
      document_number: documentNumber,
      normalized_document_number: normalizedDocumentNumber,
      document_date: extraction.documentClassification.documentDate,
      provider_model: lastAttempt?.model ?? null,
      provider_request_id: lastAttempt?.requestId ?? null,
      schema_version: outcome.schemaVersion,
      prompt_version: outcome.promptVersion,
      used_escalation_model: outcome.usedEscalationModel,
      input_tokens: lastAttempt?.inputTokens ?? null,
      output_tokens: lastAttempt?.outputTokens ?? null,
      attempt_count: outcome.attempts.length,
      raw_provider_response: extraction as unknown as Record<string, unknown>,
      extracted_data: extraction as unknown as Record<string, unknown>,
      validation_result: validation as unknown as Record<string, unknown>,
      warnings: extraction.warnings,
    })
    .eq("id", ingestionId);

  logEvent("transport_intake_analyzed", {
    ingestionId,
    correlationId: input.correlationId,
    status,
    deliveries: deliveries.length,
    duplicateVerdict: duplicates.verdict,
    escalated: outcome.usedEscalationModel,
  });

  return {
    ingestionId,
    status,
    extraction,
    validation,
    distributorMatch,
    deliveries,
    duplicates,
    inboundMethod,
    summary: { orderCount: validation.confirmableCount, tyreCount: validation.totalTyres },
    model: lastAttempt?.model ?? null,
    usedEscalationModel: outcome.usedEscalationModel,
    errorCode: null,
    errorMessage: null,
  };
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

/** One operator decision per delivery. Everything else is re-derived server-side. */
export interface DeliveryDecision {
  deliveryIndex: number;
  /** Set false to skip this delivery without creating a job. */
  include: boolean;
  customerId: string | null;
  customerLocationId: string | null;
  /** Operator's final say on the payment reading, when review was required. */
  paymentOperationalStatus?: string | null;
  amountToCollect?: number | null;
  /** Operator's final say on who brings the goods. */
  inboundMethod?: InboundMethod | null;
  /** Remember this distributor's customer code for next time. */
  saveCustomerCodeMapping?: boolean;
}

export interface ConfirmInput {
  ingestionId: string;
  distributorId: string;
  decisions: DeliveryDecision[];
  /** Required when a duplicate was flagged, so proceeding is always deliberate. */
  duplicateAcknowledged?: boolean;
  confirmedBy: string;
}

export interface ConfirmResult {
  ok: boolean;
  createdOrderIds: string[];
  skipped: number[];
  failures: { deliveryIndex: number; code: string; message: string }[];
  status: "deliveries_created" | "partially_created" | "failed";
}

export function mapPaymentStatusForDriver(operationalStatus: string): string {
  switch (operationalStatus) {
    case "COLLECT_CASH":
    case "COLLECT_OTHER":
      return "pending";
    case "NO_COLLECTION_REQUIRED":
      return "not_required";
    case "ALREADY_PAID_EXPLICIT":
      return "paid";
    default:
      return "unknown";
  }
}

/**
 * Derives the order payload for one delivery from the STORED extraction.
 *
 * Note what the operator decision may and may not change. It may resolve
 * identity (which customer, which branch), the payment reading, and who
 * collects -- the three things a document genuinely leaves open. It may not
 * change quantities, descriptions or document references, which come from the
 * stored extraction only. A browser cannot talk the server into carrying
 * goods the document never mentioned.
 */
export function buildTransportOrderPayload(input: {
  extraction: TransportDocumentExtraction;
  deliveryIndex: number;
  decision: DeliveryDecision;
  distributorId: string;
  ingestionId: string;
  resolvedPaymentStatus: string;
  amountToCollectCents: number | null;
  tyreCount: number | null;
  createdBy: string;
  model: string | null;
}): Record<string, unknown> {
  const delivery = input.extraction.deliveries[input.deliveryIndex];
  const recipient = delivery.recipient;
  const inbound = input.decision.inboundMethod ?? input.extraction.inboundLogistics.method;
  const inboundStatus = initialInboundStatusFor(inbound);

  return {
    supplier_id: input.distributorId,
    customer_id: input.decision.customerId,
    customer_location_id: input.decision.customerLocationId,

    // Provenance, straight from the document.
    source_type: "paste",
    supplier_document_number: delivery.deliveryDocumentNumber,
    normalized_document_number: delivery.deliveryDocumentNumber?.trim()
      ? normaliseDocumentNumber(delivery.deliveryDocumentNumber.trim())
      : null,
    supplier_document_date: input.extraction.documentClassification.documentDate,
    supplier_reference: delivery.supplierOrderReference,

    // Destination snapshot, so a later edit to the customer record cannot
    // silently rewrite where this consignment was supposed to go.
    delivery_recipient: recipient.companyName,
    delivery_address_line1: recipient.addressLine,
    delivery_city: recipient.city,
    delivery_province: recipient.province,
    delivery_postal_code: recipient.postalCode,
    delivery_country: recipient.country ?? "IT",
    delivery_notes: delivery.deliveryInstructions,
    planned_delivery_date: delivery.deliveryDate,

    // Operations.
    status: initialOrderStatusFor(inboundStatus),
    inbound_status: inboundStatus,
    inbound_method: inbound,
    pickup_company: input.extraction.inboundLogistics.pickupCompany,
    pickup_address: input.extraction.inboundLogistics.pickupAddress,
    requested_pickup_date: input.extraction.inboundLogistics.requestedPickupDate,
    requested_pickup_window: input.extraction.inboundLogistics.requestedPickupTimeWindow,
    tyre_count: input.tyreCount === null ? null : String(input.tyreCount),

    // Money. Null unless the driver actually collects.
    requires_payment_on_delivery: requiresDriverCollection(
      input.resolvedPaymentStatus as Parameters<typeof requiresDriverCollection>[0]
    ),
    payment_status: mapPaymentStatusForDriver(input.resolvedPaymentStatus),
    payment_operational_status: input.resolvedPaymentStatus,
    payment_printed_terms: delivery.payment.printedTerms,
    payment_evidence: delivery.payment.evidence,
    amount_to_collect:
      input.amountToCollectCents === null ? null : String(input.amountToCollectCents / 100),
    currency: delivery.payment.currency ?? "EUR",

    // Goods. Descriptions verbatim; no prices of any kind.
    items: delivery.items.map((item, index) => ({
      line_number: index + 1,
      item_type: "tyre",
      raw_description: item.originalDescription,
      description: item.originalDescription,
      supplier_sku: item.supplierProductCode,
      ean: item.ean ?? item.barcode,
      brand: item.brand,
      model: item.model,
      width: item.width === null ? null : String(item.width),
      aspect_ratio: item.aspectRatio === null ? null : String(item.aspectRatio),
      rim_diameter: item.rimDiameter === null ? null : String(item.rimDiameter),
      load_index: item.loadIndex,
      speed_rating: item.speedIndex,
      quantity: String(item.quantity ?? 0),
      is_physical: "true",
      needs_review: "false",
      review_fields: [],
    })),

    business_type: TRANSPORT_BUSINESS_TYPE,
    transport_ingestion_id: input.ingestionId,
    created_by: input.createdBy,
    extraction_model: input.model,
  };
}

/**
 * Confirms an ingestion and creates transport jobs.
 *
 * This is the only function in the codebase that creates a transport order.
 *
 * It re-reads the stored extraction and RE-RUNS validation and payment
 * classification rather than trusting anything the browser sent. The operator
 * decisions are narrow by design -- which customer, which branch, the payment
 * reading, who collects -- and everything else comes from the document.
 *
 * ON PARTIAL CREATION. Each delivery is created by one call to
 * gorush_create_transport_order, and that call is atomic: an order either
 * exists complete with its items, units, history, transport attributes and
 * first event, or not at all. The BATCH is not atomic, and that is a
 * deliberate choice rather than an oversight: a ten-recipient PDF where the
 * seventh recipient trips a duplicate should still deliver the other nine.
 * All-or-nothing would mean one bad row blocks a day of real work.
 *
 * What makes that safe is that partial creation is explicit, visible and
 * recoverable. The ingestion records exactly which orders were created, its
 * status becomes partially_created rather than deliveries_created, the
 * failures are returned per delivery, and re-confirming creates only what is
 * missing because the already-created deliveries are skipped.
 */
export async function confirmTransportDocument(input: ConfirmInput): Promise<ConfirmResult> {
  const supabase = createSupabaseAdminClient();

  const { data: ingestion, error: loadError } = await supabase
    .from("transport_document_ingestions")
    .select("id, status, extracted_data, created_order_ids, provider_model, document_number")
    .eq("id", input.ingestionId)
    .single();

  if (loadError || !ingestion) {
    logError("transport_confirm_ingestion_missing", loadError, { ingestionId: input.ingestionId });
    return { ok: false, createdOrderIds: [], skipped: [], failures: [], status: "failed" };
  }

  if (ingestion.status === "rejected") {
    return {
      ok: false,
      createdOrderIds: [],
      skipped: [],
      failures: [{ deliveryIndex: -1, code: "INGESTION_REJECTED", message: "Documento rifiutato." }],
      status: "failed",
    };
  }

  const extraction = ingestion.extracted_data as unknown as TransportDocumentExtraction | null;
  if (!extraction) {
    return {
      ok: false,
      createdOrderIds: [],
      skipped: [],
      failures: [{ deliveryIndex: -1, code: "NO_EXTRACTION", message: "Nessuna estrazione da confermare." }],
      status: "failed",
    };
  }

  // Server-authoritative revalidation. The browser's opinion of what is
  // confirmable is not consulted.
  const validation = validateExtraction(extraction);

  const createdOrderIds: string[] = [...((ingestion.created_order_ids as string[] | null) ?? [])];
  const alreadyCreated = new Set(createdOrderIds);
  const skipped: number[] = [];
  const failures: ConfirmResult["failures"] = [];

  for (const decision of input.decisions) {
    const index = decision.deliveryIndex;
    const delivery = extraction.deliveries[index];
    const deliveryValidation = validation.deliveries[index];

    if (!delivery || !deliveryValidation) {
      failures.push({ deliveryIndex: index, code: "DELIVERY_NOT_FOUND", message: "Consegna non trovata." });
      continue;
    }

    if (!decision.include) {
      skipped.push(index);
      continue;
    }

    // An operator may resolve an unresolved payment reading, but may not
    // overturn one the document settled -- that is what the classifier is for.
    const resolvedPaymentStatus =
      deliveryValidation.resolvedPaymentStatus === "UNKNOWN_REVIEW_REQUIRED" && decision.paymentOperationalStatus
        ? decision.paymentOperationalStatus
        : deliveryValidation.resolvedPaymentStatus;

    if (resolvedPaymentStatus === "UNKNOWN_REVIEW_REQUIRED") {
      failures.push({
        deliveryIndex: index,
        code: "PAYMENT_STATUS_UNRESOLVED",
        message: "Stato del pagamento non risolto: selezionare l'opzione corretta.",
      });
      continue;
    }

    const collects = requiresDriverCollection(
      resolvedPaymentStatus as Parameters<typeof requiresDriverCollection>[0]
    );
    const amountCents = collects
      ? decision.amountToCollect != null
        ? Math.round(decision.amountToCollect * 100)
        : deliveryValidation.amountToCollectCents
      : null;

    if (collects && (amountCents === null || amountCents <= 0)) {
      failures.push({
        deliveryIndex: index,
        code: "COD_AMOUNT_MISSING",
        message: "Incasso richiesto: inserire un importo positivo.",
      });
      continue;
    }

    // Blocking issues other than the payment one the operator just resolved
    // still block. Quantities and addresses are not negotiable at confirm time.
    const remainingBlockers = deliveryValidation.issues.filter(
      (issue) =>
        issue.severity === "BLOCKING" &&
        issue.code !== "PAYMENT_STATUS_UNRESOLVED" &&
        !(issue.code === "COD_AMOUNT_MISSING" && amountCents !== null) &&
        !(issue.code === "DELIVERY_ADDRESS_INCOMPLETE" && decision.customerLocationId)
    );
    if (remainingBlockers.length > 0) {
      failures.push({
        deliveryIndex: index,
        code: remainingBlockers[0].code,
        message: remainingBlockers[0].message,
      });
      continue;
    }

    if (!decision.customerId) {
      failures.push({
        deliveryIndex: index,
        code: "RECIPIENT_NOT_SELECTED",
        message: "Selezionare il cliente destinatario.",
      });
      continue;
    }

    const payload = buildTransportOrderPayload({
      extraction,
      deliveryIndex: index,
      decision,
      distributorId: input.distributorId,
      ingestionId: input.ingestionId,
      resolvedPaymentStatus,
      amountToCollectCents: amountCents,
      tyreCount: deliveryValidation.effectiveTyreCount,
      createdBy: input.confirmedBy,
      model: (ingestion.provider_model as string | null) ?? null,
    });

    const { data, error } = await supabase.rpc("gorush_create_transport_order", { payload });

    if (error) {
      const duplicate = isConcurrentDuplicateError(error);
      logError("transport_confirm_order_failed", error, {
        ingestionId: input.ingestionId,
        deliveryIndex: index,
        duplicate,
      });
      failures.push({
        deliveryIndex: index,
        code: duplicate ? "CONCURRENT_DUPLICATE" : "ORDER_CREATE_FAILED",
        message: duplicate
          ? "Questo DDT e' stato importato da un'altra richiesta nel frattempo."
          : "Creazione dell'ordine non riuscita.",
      });
      continue;
    }

    const orderId = (data as { order_id?: string } | null)?.order_id ?? null;
    if (orderId && !alreadyCreated.has(orderId)) {
      createdOrderIds.push(orderId);
      alreadyCreated.add(orderId);
    }

    // Remember the distributor's customer code, so the next document from
    // this distributor resolves automatically.
    if (decision.saveCustomerCodeMapping && delivery.recipient.customerCode?.trim()) {
      const mapping = mappingToSave({
        distributorId: input.distributorId,
        customerCode: delivery.recipient.customerCode,
        customerId: decision.customerId,
        customerLocationId: decision.customerLocationId,
        distributorCustomerName: delivery.recipient.companyName,
      });
      if (mapping) {
        const { error: mappingError } = await supabase.from("supplier_customer_refs").upsert(
          {
            supplier_id: mapping.distributorId,
            supplier_customer_code: mapping.customerCode,
            customer_id: mapping.customerId,
            customer_location_id: mapping.customerLocationId,
            supplier_customer_name: mapping.distributorCustomerName,
          },
          { onConflict: "supplier_id,supplier_customer_code", ignoreDuplicates: true }
        );
        // A failed mapping save must not fail a created delivery: the job
        // exists and is correct, the operator simply gets asked again next time.
        if (mappingError) {
          logError("transport_confirm_mapping_save_failed", mappingError, { ingestionId: input.ingestionId });
        }
      }
    }
  }

  const attempted = input.decisions.filter((decision) => decision.include).length;
  const status: ConfirmResult["status"] =
    failures.length === 0 && createdOrderIds.length > 0
      ? "deliveries_created"
      : createdOrderIds.length > 0
        ? "partially_created"
        : "failed";

  await supabase
    .from("transport_document_ingestions")
    .update({
      status,
      created_order_ids: createdOrderIds,
      created_delivery_count: createdOrderIds.length,
      confirmed_at: new Date().toISOString(),
      error_code: failures[0]?.code ?? null,
      error_message: failures[0]?.message ?? null,
    })
    .eq("id", input.ingestionId);

  logEvent("transport_intake_confirmed", {
    ingestionId: input.ingestionId,
    status,
    attempted,
    created: createdOrderIds.length,
    skipped: skipped.length,
    failed: failures.length,
  });

  return { ok: status !== "failed", createdOrderIds, skipped, failures, status };
}

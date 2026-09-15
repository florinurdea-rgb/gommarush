import { z } from "zod";

/**
 * The strict Structured Outputs schema for transport-document extraction.
 *
 * Three constraints from OpenAI's strict mode shape every decision here:
 *
 *  1. EVERY property must be required. There is no `.optional()` anywhere in
 *     this file -- absence is expressed as `.nullable()` instead. A model that
 *     cannot read a field returns null; it never omits the key.
 *
 *  2. No `.default()`. A default would silently manufacture a value, which is
 *     precisely what must not happen to a quantity or an address.
 *
 *  3. Numeric and string constraints (`.min()`, `.regex()`, `.positive()`) are
 *     NOT relied on for correctness. Strict mode does not guarantee the model
 *     honours them, so they are enforced afterwards in
 *     src/lib/transport/validate.ts. The schema's job is shape; validation's
 *     job is truth.
 *
 * A fourth rule is ours, not OpenAI's: this schema carries NO commercial
 * fields. No unit price, no discount, no VAT, no PFU, no line total. The
 * transport business does not own the tyre sale, so those numbers have no
 * place in a transport job -- and the surest way to stop a supplier's price
 * becoming a COD amount is for the extraction never to return it.
 */

export const EXTRACTION_SCHEMA_VERSION = "transport-v1";

const DocumentTypeEnum = z.enum(["DDT_VENDITA", "INVOICE", "DELIVERY_NOTE", "UNKNOWN"]);

const InboundMethodEnum = z.enum([
  "GORUSH_PICKUP",
  "SUPPLIER_DELIVERY_TO_DEPOT",
  "THIRD_PARTY_CARRIER",
  "UNKNOWN",
]);

const PaymentOperationalStatusEnum = z.enum([
  "COLLECT_CASH",
  "COLLECT_OTHER",
  "NO_COLLECTION_REQUIRED",
  "ALREADY_PAID_EXPLICIT",
  "UNKNOWN_REVIEW_REQUIRED",
]);

const PaymentMethodEnum = z.enum(["CASH", "CARD", "BANK_TRANSFER", "RIBA", "OTHER", "UNKNOWN"]);

const DocumentClassificationSchema = z.object({
  documentType: DocumentTypeEnum,
  /** False for anything that is not a transport instruction (price list, statement, letter). */
  isTransportRelevant: z.boolean(),
  documentNumber: z.string().nullable(),
  /** ISO 8601 date. Format is validated downstream, not trusted from here. */
  documentDate: z.string().nullable(),
  pageCountDetected: z.number().int().nullable(),
});

const DistributorSchema = z.object({
  name: z.string().nullable(),
  vatNumber: z.string().nullable(),
  /** The distributor's own depot/branch the goods sit at, e.g. "RIVOLI VERONESE". */
  warehouseName: z.string().nullable(),
  /** The code the DISTRIBUTOR uses for GommaRush as its customer, if printed. */
  documentCustomerCode: z.string().nullable(),
});

const InboundLogisticsSchema = z.object({
  method: InboundMethodEnum,
  pickupRequired: z.boolean().nullable(),
  pickupCompany: z.string().nullable(),
  pickupAddress: z.string().nullable(),
  requestedPickupDate: z.string().nullable(),
  requestedPickupTimeWindow: z.string().nullable(),
  /** A carrier named on the document, which may or may not be Go Rush. */
  sourceCarrier: z.string().nullable(),
});

const RecipientSchema = z.object({
  companyName: z.string().nullable(),
  /** The distributor's code for ITS customer -- the Zuin "034932" case. */
  customerCode: z.string().nullable(),
  /** Italian codice fiscale. */
  taxCode: z.string().nullable(),
  vatNumber: z.string().nullable(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  addressLine: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  country: z.string().nullable(),
  /** The address exactly as printed, unsplit. Evidence for the operator. */
  completeAddress: z.string().nullable(),
});

const ItemSchema = z.object({
  supplierProductCode: z.string().nullable(),
  ean: z.string().nullable(),
  barcode: z.string().nullable(),
  supplierOrderReference: z.string().nullable(),
  /**
   * The only non-nullable string in the schema. A line with no readable
   * description is not a line -- and keeping the original text verbatim is
   * what makes every derived field auditable.
   */
  originalDescription: z.string(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  width: z.number().int().nullable(),
  aspectRatio: z.number().int().nullable(),
  rimDiameter: z.number().int().nullable(),
  loadIndex: z.string().nullable(),
  speedIndex: z.string().nullable(),
  /** Only when unambiguous, e.g. "185/55 R16". Null rather than a guess. */
  normalizedSize: z.string().nullable(),
  /** Null when unreadable. NEVER 1, and never 0. */
  quantity: z.number().int().nullable(),
});

const PaymentSchema = z.object({
  /** The terms verbatim, e.g. "RIBA 30 gg FM". The classifier reads this, not the model's opinion. */
  printedTerms: z.string().nullable(),
  operationalStatus: PaymentOperationalStatusEnum,
  mustDriverCollect: z.boolean().nullable(),
  /**
   * Only when the document explicitly ties this figure to carrier collection.
   * An invoice total, taxable total, VAT total or PFU amount must never
   * appear here -- see the prompt, and the deterministic re-check in
   * validate.ts which recomputes the status from printedTerms.
   */
  amountToCollect: z.number().nullable(),
  currency: z.string().nullable(),
  paymentMethod: PaymentMethodEnum,
  /** The substring that justifies the status. */
  evidence: z.string().nullable(),
});

const DeliverySchema = z.object({
  deliveryDocumentNumber: z.string().nullable(),
  supplierOrderReference: z.string().nullable(),
  recipient: RecipientSchema,
  items: z.array(ItemSchema),
  totalTyres: z.number().int().nullable(),
  packages: z.number().int().nullable(),
  weightKg: z.number().nullable(),
  payment: PaymentSchema,
  deliveryDate: z.string().nullable(),
  deliveryTimeWindow: z.string().nullable(),
  /** Genuine instructions only -- not headers, legal boilerplate or payment conditions. */
  deliveryInstructions: z.string().nullable(),
  documentNotes: z.string().nullable(),
  /** 1-based page range this delivery occupied, so multi-page DDTs stay traceable. */
  sourcePageStart: z.number().int().nullable(),
  sourcePageEnd: z.number().int().nullable(),
});

/**
 * One pasted input, which may contain several DDTs for several recipients.
 *
 * `deliveries` is an array because a single paste routinely holds: one
 * delivery; several DDTs for different recipients; several pages for one
 * recipient; or the same tyre model destined for two different customers.
 * That last case is why grouping is driven by document number and recipient
 * identity, never by product similarity.
 */
export const TransportDocumentExtractionSchema = z.object({
  schemaVersion: z.string(),
  documentClassification: DocumentClassificationSchema,
  distributor: DistributorSchema,
  inboundLogistics: InboundLogisticsSchema,
  deliveries: z.array(DeliverySchema),
  transportStart: z.string().nullable(),
  /** The model's own caveats, shown to the operator verbatim. */
  warnings: z.array(z.string()),
});

export type TransportDocumentExtraction = z.infer<typeof TransportDocumentExtractionSchema>;
export type ExtractedDelivery = z.infer<typeof DeliverySchema>;
export type ExtractedItem = z.infer<typeof ItemSchema>;
export type ExtractedRecipient = z.infer<typeof RecipientSchema>;
export type ExtractedPayment = z.infer<typeof PaymentSchema>;
export type ExtractedDistributor = z.infer<typeof DistributorSchema>;
export type ExtractedInboundLogistics = z.infer<typeof InboundLogisticsSchema>;

/** The name passed to zodTextFormat; also recorded on the ingestion row. */
export const EXTRACTION_FORMAT_NAME = "transport_document_extraction";

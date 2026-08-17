// Document analysis contract.
//
// One interface, several interchangeable providers. Business logic (customer
// matching, product normalisation, order creation) depends only on this
// contract, never on a specific AI vendor.
//
// THE HONESTY RULE, which the whole design exists to enforce:
// when no AI/OCR provider is configured, an analyzer returns
// `status: "unconfigured"` with NO extracted values. It never fabricates a
// plausible supplier, customer or product list. The review screen then shows
// "Analiza automată nu este configurată" and the Admin fills the form in by hand.

export const SUPPORTED_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword",
] as const;

export const SUPPORTED_UPLOAD_EXTENSIONS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".docx",
] as const;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Per-field confidence, 0–1. Absent means "not assessed". */
export type FieldConfidence = Record<string, number>;

export interface ExtractedSupplier {
  name?: string | null;
  vatNumber?: string | null;
  fiscalCode?: string | null;
  documentNumber?: string | null;
  documentDate?: string | null;
  orderReference?: string | null;
}

export interface ExtractedFinalCustomer {
  companyName?: string | null;
  supplierCustomerCode?: string | null;
  vatNumber?: string | null;
  fiscalCode?: string | null;
  deliveryRecipient?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
}

export interface ExtractedPayment {
  paymentMethod?: string | null;
  /** cash on delivery / contrassegno */
  cashOnDelivery?: boolean | null;
  amountToCollect?: number | null;
  collectionMethod?: string | null;
  currency?: string | null;
}

export interface ExtractedProductLine {
  supplierSku?: string | null;
  /** Always the document's own text, preserved verbatim. */
  rawDescription: string;
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
  quantity?: number | null;
  unitPrice?: number | null;
  taxRate?: number | null;
  pfuFee?: number | null;
  logisticsFee?: number | null;
  /** Field names that could not be read confidently. */
  reviewFields?: string[];
  confidence?: number | null;
}

export type AnalysisStatus = "analysed" | "unconfigured" | "failed";

export interface AnalysisResult {
  status: AnalysisStatus;
  /** Which adapter produced this, for the audit trail. */
  provider: string;
  supplier: ExtractedSupplier;
  customer: ExtractedFinalCustomer;
  payment: ExtractedPayment;
  products: ExtractedProductLine[];
  fieldConfidence: FieldConfidence;
  /**
   * Human-readable notes about what could and couldn't be read. Shown on the
   * review screen so the Admin knows how much to trust each section.
   */
  notes: string[];
  /** Raw text, when a text layer was available. Useful for debugging imports. */
  extractedText?: string | null;
  error?: string | null;
}

export interface AnalyzableDocument {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}

/**
 * The adapter interface. `analyze` must never throw for an unreadable document:
 * it returns `status: "failed"` so the Admin gets the manual form instead of an
 * error page.
 */
export interface DocumentAnalyzer {
  readonly name: string;
  /** False when required configuration (an API key) is missing. */
  isConfigured(): boolean;
  analyze(document: AnalyzableDocument): Promise<AnalysisResult>;
}

/** An empty result — the shape returned when nothing could be extracted. */
export function emptyResult(
  status: AnalysisStatus,
  provider: string,
  notes: string[],
  error?: string
): AnalysisResult {
  return {
    status,
    provider,
    supplier: {},
    customer: {},
    payment: {},
    products: [],
    fieldConfidence: {},
    notes,
    error: error ?? null,
  };
}

export function isSupportedUpload(mimeType: string, fileName: string): boolean {
  if ((SUPPORTED_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType)) return true;
  // Browsers are inconsistent about HEIC and occasionally send
  // application/octet-stream, so fall back to the extension.
  const lower = fileName.toLowerCase();
  return SUPPORTED_UPLOAD_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

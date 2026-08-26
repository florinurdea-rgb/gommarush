// Types for the multi-DDT import pipeline (src/lib/ddt-import/*).
//
// Kept separate from src/lib/documents/* (the existing single-order
// analyzer): that pipeline assumes one upload = one order's worth of
// header/product data. This one assumes one upload may contain N distinct
// logistics documents and extracts each independently.

type LegacyItemType = "tyre" | "tube" | "wheel" | "accessory" | "other" | "service" | "fee";

/** What the AI extraction pass returns for one line — a proposal, not a final classification. */
export interface ExtractedLine {
  rawDescription: string;
  itemTypeHint: LegacyItemType | null;
  supplierArticleCode: string | null;
  manufacturerCode: string | null;
  ean: string | null;
  brand: string | null;
  model: string | null;
  width: number | null;
  aspectRatio: number | null;
  rimDiameter: number | null;
  loadIndex: string | null;
  speedRating: string | null;
  extraLoad: boolean | null;
  runFlat: boolean | null;
  commercial: boolean | null;
  mudSnow: boolean | null;
  threePmsf: boolean | null;
  season: string | null;
  /** null when the AI could not read a quantity — never guessed. */
  quantity: number | null;
  unitWeight: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  vatPercent: number | null;
}

export interface ExtractedDocument {
  supplier: {
    name: string | null;
    vatNumber: string | null;
  };
  document: {
    documentNumber: string | null;
    documentType: string | null;
    documentDate: string | null;
    supplierOrderReference: string | null;
    trackingNumber: string | null;
    giro: string | null;
    agent: string | null;
    carrier: string | null;
    sourcePageStart: number | null;
    sourcePageEnd: number | null;
    /** "Nr. Colli" as printed — supporting evidence for tyre-count validation only, never the source of truth. */
    colli: number | null;
  };
  customer: {
    companyName: string | null;
    vatNumber: string | null;
    fiscalCode: string | null;
    supplierCustomerCode: string | null;
    deliveryRecipient: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: string | null;
    phone: string | null;
  };
  /** Raw payment-related text, verbatim — detectPaymentSignals() runs on this deterministically, the AI never decides the flags itself. */
  paymentText: string | null;
  lines: ExtractedLine[];
  /** The model's own overall confidence for this document (0–1). One more signal, never decisive on its own. */
  confidence: number;
  warnings: string[];
}

export interface ExtractionResult {
  status: "analysed" | "unconfigured" | "failed";
  documents: ExtractedDocument[];
  pageCount: number | null;
  error: string | null;
  notes: string[];
}

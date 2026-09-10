import "server-only";
import { analyzeDocument } from "@/lib/documents";
import { isItemType } from "@/lib/types/logistics";
import type { AnalysisResult } from "@/lib/documents/analyzer";
import type { ExtractedDocument, ExtractedLine } from "@/lib/ddt-import/types";

/**
 * The honest fallback when ANTHROPIC_API_KEY isn't configured: reuse the
 * existing deterministic text-layer parser (src/lib/documents — PDF text
 * extraction, no AI, no invented values) instead of just failing. This is
 * literally what "textul va fi citit direct din fișier acolo unde este
 * posibil" means — the same parser the single-document import flow has
 * always used when AI isn't available.
 *
 * The real limitation this doesn't lift: without AI, there's no reliable
 * way to detect where one logistics document ends and the next begins in
 * a multi-page file, so a text-only pass is always treated as exactly ONE
 * document, however many pages the upload has. Multi-DDT splitting needs
 * AI configured — that's disclosed to the Admin, not silently assumed.
 */

function toItemTypeHint(value: string | null | undefined): ExtractedLine["itemTypeHint"] {
  return value && isItemType(value) ? value : null;
}

function toExtractedDocument(result: AnalysisResult): ExtractedDocument {
  const lines: ExtractedLine[] = result.products.map((product) => ({
    rawDescription: product.rawDescription,
    itemTypeHint: toItemTypeHint(product.itemType),
    supplierArticleCode: product.supplierSku ?? null,
    manufacturerCode: null,
    ean: null,
    brand: product.brand ?? null,
    model: product.model ?? null,
    width: product.width ?? null,
    aspectRatio: product.aspectRatio ?? null,
    rimDiameter: product.rimDiameter ?? null,
    loadIndex: product.loadIndex ?? null,
    speedRating: product.speedRating ?? null,
    extraLoad: product.extraLoad ?? null,
    runFlat: product.runFlat ?? null,
    commercial: null,
    mudSnow: null,
    threePmsf: null,
    season: null,
    quantity: product.quantity ?? null,
    unitWeight: null,
    unitPrice: product.unitPrice ?? null,
    lineTotal: null,
    vatPercent: product.taxRate ?? null,
  }));

  const averageConfidence =
    result.products.length > 0
      ? result.products.reduce((sum, product) => sum + (product.confidence ?? 0.3), 0) / result.products.length
      : 0.2;

  return {
    supplier: { name: result.supplier.name ?? null, vatNumber: result.supplier.vatNumber ?? null },
    document: {
      documentNumber: result.supplier.documentNumber ?? null,
      documentType: null,
      documentDate: result.supplier.documentDate ?? null,
      supplierOrderReference: result.supplier.orderReference ?? null,
      trackingNumber: null,
      giro: null,
      agent: null,
      carrier: null,
      sourcePageStart: 1,
      sourcePageEnd: null,
      colli: null,
    },
    customer: {
      companyName: result.customer.companyName ?? null,
      vatNumber: result.customer.vatNumber ?? null,
      fiscalCode: result.customer.fiscalCode ?? null,
      supplierCustomerCode: result.customer.supplierCustomerCode ?? null,
      deliveryRecipient: result.customer.deliveryRecipient ?? null,
      addressLine1: result.customer.addressLine1 ?? null,
      addressLine2: result.customer.addressLine2 ?? null,
      city: result.customer.city ?? null,
      province: result.customer.province ?? null,
      postalCode: result.customer.postalCode ?? null,
      country: result.customer.country ?? null,
      phone: null,
    },
    // The text parser doesn't isolate payment wording separately — nothing
    // to copy verbatim, so payment flags stay null/false rather than guessed.
    paymentText: null,
    lines,
    confidence: averageConfidence,
    warnings: result.notes,
  };
}

export interface TextFallbackResult {
  /** True when at least a supplier/customer/product was actually read from the file's own text. */
  foundData: boolean;
  document: ExtractedDocument | null;
  notes: string[];
}

export async function extractViaTextLayer(input: {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<TextFallbackResult> {
  const result = await analyzeDocument(input);

  const foundData = result.products.length > 0 || Boolean(result.supplier.name) || Boolean(result.customer.companyName);

  return {
    foundData,
    document: foundData ? toExtractedDocument(result) : null,
    notes: result.notes,
  };
}

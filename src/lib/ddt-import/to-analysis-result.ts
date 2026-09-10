import type { AnalysisResult, ExtractedProductLine } from "@/lib/documents/analyzer";
import type { ProcessedDocumentWithMatch } from "@/lib/ddt-import/client-helpers";

/**
 * Converts a DDT-import pipeline result into the shape OrderReviewForm
 * already knows how to edit — "Modifica și finalizează" reuses the exact
 * same manual-entry form as the "Nuovo ordine" modal instead of a second
 * editor, just pre-filled with whatever the pipeline DID manage to read.
 * Nothing here invents a value: a field the pipeline couldn't read stays
 * null/empty, same as an unconfigured analysis would leave it.
 */

const LINE_TYPE_TO_ITEM_TYPE: Partial<Record<string, string>> = {
  TYRE: "tyre",
  TUBE: "tube",
  RIM: "wheel",
  OTHER_PHYSICAL_ITEM: "other",
};

export function ddtDocumentToAnalysisResult(doc: ProcessedDocumentWithMatch): AnalysisResult {
  const { extracted } = doc;

  const products: ExtractedProductLine[] = doc.physicalItems.map((line) => ({
    supplierSku: line.raw.supplierArticleCode,
    rawDescription: line.raw.rawDescription,
    itemType: LINE_TYPE_TO_ITEM_TYPE[line.lineType] ?? "other",
    brand: line.raw.brand,
    model: line.raw.model,
    width: line.raw.width,
    aspectRatio: line.raw.aspectRatio,
    rimDiameter: line.raw.rimDiameter,
    loadIndex: line.raw.loadIndex,
    speedRating: line.raw.speedRating,
    extraLoad: line.raw.extraLoad,
    runFlat: line.raw.runFlat,
    quantity: line.raw.quantity,
    unitPrice: line.raw.unitPrice,
    taxRate: line.raw.vatPercent,
    reviewFields: line.raw.quantity === null ? ["quantity"] : [],
    confidence: extracted.confidence,
  }));

  return {
    status: "analysed",
    provider: "ddt-import",
    supplier: {
      name: extracted.supplier.name,
      vatNumber: extracted.supplier.vatNumber,
      documentNumber: extracted.document.documentNumber,
      documentDate: extracted.document.documentDate,
      orderReference: extracted.document.supplierOrderReference,
    },
    customer: {
      companyName: extracted.customer.companyName,
      vatNumber: extracted.customer.vatNumber,
      fiscalCode: extracted.customer.fiscalCode,
      supplierCustomerCode: extracted.customer.supplierCustomerCode,
      deliveryRecipient: extracted.customer.deliveryRecipient,
      addressLine1: extracted.customer.addressLine1,
      addressLine2: extracted.customer.addressLine2,
      postalCode: extracted.customer.postalCode,
      city: extracted.customer.city,
      province: extracted.customer.province,
      country: extracted.customer.country,
    },
    payment: {
      paymentMethod: doc.payment.paymentMethod,
      cashOnDelivery: doc.payment.cashRequired || doc.payment.chequeRequired,
      amountToCollect: null,
      collectionMethod: doc.payment.cashRequired ? "cash" : doc.payment.chequeRequired ? "cheque" : null,
      currency: "EUR",
    },
    products,
    fieldConfidence: {},
    notes: doc.reasons,
    extractedText: null,
    error: null,
  };
}

import { classifyLine, isPhysicalLine } from "@/lib/logistics/ddt-classification";
import type { ClassifiedLineType } from "@/lib/logistics/ddt-classification";
import { processLines } from "@/lib/logistics/ddt-lines";
import {
  calculatePhysicalItemCount,
  calculateTyreCount,
  validateTyreCount,
} from "@/lib/logistics/ddt-calculations";
import { detectPaymentSignals } from "@/lib/logistics/ddt-payment";
import {
  buildItemSignature,
  computeOrderFingerprint,
  findExactDuplicate,
  normaliseDocumentNumber,
} from "@/lib/logistics/ddt-dedup";
import type { OrderIdentity } from "@/lib/logistics/ddt-dedup";
import type { ExtractedDocument, ExtractedLine } from "@/lib/ddt-import/types";

/**
 * Turns one AI-extracted document into a decision, deterministically.
 *
 * This is the code the spec's §1 principle is actually about: the AI
 * proposed text and a soft type hint; everything from here on — which
 * lines are real products, the tyre count, whether this is a duplicate,
 * whether payment is required on delivery, and whether the document is
 * safe to auto-import — is decided by this function, not trusted from the
 * model's own JSON.
 *
 * supplierId is a required external input (not re-derived here) because
 * duplicate detection needs a resolved supplier identity, and resolving
 * (or creating) a supplier record is a DB operation that belongs in the
 * server orchestration layer, not in this pure function — see
 * src/lib/server/ddt-import.ts.
 */

const CHARGE_LINE_TYPES = new Set<ClassifiedLineType>([
  "PFU",
  "LOGISTICS_FEE",
  "TRANSPORT_FEE",
  "DISCOUNT",
  "VAT",
  "OTHER_FEE",
]);

export type DocumentStatus = "READY" | "READY_MISSING_OPTIONAL" | "NEEDS_REVIEW" | "POSSIBLE_DUPLICATE" | "DUPLICATE";

export interface ClassifiedLine {
  lineType: ClassifiedLineType;
  raw: ExtractedLine;
}

export interface ProcessedDocument {
  extracted: ExtractedDocument;
  physicalItems: ClassifiedLine[];
  charges: ClassifiedLine[];
  tyreCount: number;
  physicalItemCount: number;
  tyreCountValidation: "OK" | "TYRE_COUNT_REVIEW_REQUIRED";
  unreadableQuantityLines: number;
  payment: ReturnType<typeof detectPaymentSignals>;
  normalizedDocumentNumber: string | null;
  fingerprint: string;
  duplicateOfOrderId: string | null;
  possibleDuplicateOfOrderId: string | null;
  status: DocumentStatus;
  reasons: string[];
}

function formatSizeLabel(line: ExtractedLine): string | null {
  if (line.width === null || line.aspectRatio === null || line.rimDiameter === null) return null;
  return `${line.width}/${line.aspectRatio} R${line.rimDiameter}`;
}

export function processExtractedDocument(input: {
  extracted: ExtractedDocument;
  supplierId: string | null;
  existingOrders: OrderIdentity[];
  existingFingerprints: { orderId: string; fingerprint: string }[];
}): ProcessedDocument {
  const { extracted, supplierId } = input;

  const classified: ClassifiedLine[] = extracted.lines.map((line) => ({
    raw: line,
    lineType: classifyLine({ rawDescription: line.rawDescription, itemTypeHint: line.itemTypeHint }),
  }));

  const physicalItems = classified.filter((line) => isPhysicalLine(line.lineType));
  const charges = classified.filter((line) => CHARGE_LINE_TYPES.has(line.lineType));

  const { countableLines, unreadableQuantityLines } = processLines(
    extracted.lines.map((line) => ({
      rawDescription: line.rawDescription,
      itemTypeHint: line.itemTypeHint,
      quantity: line.quantity,
    }))
  );

  const tyreCount = calculateTyreCount(countableLines);
  const physicalItemCount = calculatePhysicalItemCount(countableLines);
  const tyreCountValidation = validateTyreCount({
    tyreCount,
    physicalItemCount,
    colli: extracted.document.colli,
  });

  const payment = detectPaymentSignals(extracted.paymentText ?? "");

  const normalizedDocumentNumber = extracted.document.documentNumber
    ? normaliseDocumentNumber(extracted.document.documentNumber)
    : null;

  const itemSignature = buildItemSignature(
    physicalItems.map((line) => ({
      brand: line.raw.brand,
      sizeLabel: formatSizeLabel(line.raw),
      quantity: line.raw.quantity ?? 0,
    }))
  );
  const fingerprint = computeOrderFingerprint({
    supplierName: extracted.supplier.name ?? "",
    customerName: extracted.customer.companyName ?? "",
    postalCode: extracted.customer.postalCode,
    documentDate: extracted.document.documentDate,
    itemSignature,
    totalTyres: tyreCount,
  });

  const exactDuplicate =
    supplierId && normalizedDocumentNumber
      ? findExactDuplicate(input.existingOrders, supplierId, normalizedDocumentNumber)
      : null;

  const fingerprintMatch = input.existingFingerprints.find((entry) => entry.fingerprint === fingerprint) ?? null;

  // Critical fields (spec §21): if any of these is ambiguous, this is never auto-created.
  const criticalIssues: string[] = [];
  if (!extracted.supplier.name) criticalIssues.push("Furnizor neidentificat");
  if (!extracted.document.documentNumber) criticalIssues.push("Număr DDT neidentificat");
  if (!extracted.customer.companyName) criticalIssues.push("Client neidentificat");
  if (physicalItems.length === 0) criticalIssues.push("Niciun produs fizic identificat");
  if (unreadableQuantityLines.length > 0) {
    criticalIssues.push(`${unreadableQuantityLines.length} linii cu cantitate necitibilă`);
  }
  if (tyreCountValidation === "TYRE_COUNT_REVIEW_REQUIRED") {
    criticalIssues.push("Numărul de anvelope nu poate fi confirmat față de Nr. Colli");
  }

  let status: DocumentStatus;
  const reasons: string[] = [];

  if (exactDuplicate) {
    status = "DUPLICATE";
    reasons.push(`Document deja importat — comanda existentă ${exactDuplicate.id}`);
  } else if (fingerprintMatch) {
    status = "POSSIBLE_DUPLICATE";
    reasons.push("Document foarte asemănător cu o comandă existentă — verifică înainte de import");
  } else if (criticalIssues.length > 0) {
    status = "NEEDS_REVIEW";
    reasons.push(...criticalIssues);
  } else {
    const missingOptional: string[] = [];
    if (!extracted.customer.phone) missingOptional.push("telefon");
    if (!extracted.customer.postalCode) missingOptional.push("cod poștal");
    if (missingOptional.length > 0) {
      status = "READY_MISSING_OPTIONAL";
      reasons.push(`Lipsesc date opționale: ${missingOptional.join(", ")}`);
    } else {
      status = "READY";
    }
  }

  return {
    extracted,
    physicalItems,
    charges,
    tyreCount,
    physicalItemCount,
    tyreCountValidation,
    unreadableQuantityLines: unreadableQuantityLines.length,
    payment,
    normalizedDocumentNumber,
    fingerprint,
    duplicateOfOrderId: exactDuplicate?.id ?? null,
    possibleDuplicateOfOrderId: fingerprintMatch?.orderId ?? null,
    status,
    reasons,
  };
}

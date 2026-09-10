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
  /**
   * True only when the order genuinely cannot be auto-created (no
   * supplier/customer identity to resolve, or nothing importable) — the
   * one thing that still blocks confirming. Independent of `status`:
   * NEEDS_REVIEW can be true while this is false (something's merely
   * uncertain, not missing outright), in which case the document is still
   * confirmable — see canAutoConfirmDdtDocument in client-helpers.ts.
   */
  blocked: boolean;
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

function physicalLineMergeKey(line: ExtractedLine, lineType: ClassifiedLineType): string {
  const norm = (value: string | null) => (value ? value.trim().toLowerCase() : null);
  return JSON.stringify([
    lineType,
    norm(line.brand),
    norm(line.model),
    line.width,
    line.aspectRatio,
    line.rimDiameter,
    norm(line.loadIndex),
    norm(line.speedRating),
    line.extraLoad,
    line.runFlat,
    line.commercial,
    line.mudSnow,
    line.threePmsf,
    norm(line.season),
    norm(line.supplierArticleCode),
    norm(line.manufacturerCode),
    norm(line.ean),
    line.unitPrice,
    line.vatPercent,
  ]);
}

/**
 * Combines physical lines that are identical in every structured field
 * except quantity and free text into one, quantities summed — the same
 * tyre listed twice on the source document (once per row) should read as
 * "2×" of one kind, not two separate "1×" rows. A line with no readable
 * quantity is left alone: never guessed, never merged away (spec's "don't
 * guess 1" rule — see ddt-lines.ts). This runs before tyreCount/
 * physicalItemCount are computed, but those are already derived from
 * quantities summed across ALL matching lines regardless of how the
 * source document split them, so merging here changes what the review
 * screen and order_items show, not the aggregate totals.
 */
function mergeIdenticalPhysicalLines(lines: ClassifiedLine[]): ClassifiedLine[] {
  const result: ClassifiedLine[] = [];
  const indexByKey = new Map<string, number>();

  for (const line of lines) {
    if (line.raw.quantity === null) {
      result.push(line);
      continue;
    }

    const key = physicalLineMergeKey(line.raw, line.lineType);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, result.length);
      result.push(line);
    } else {
      const existing = result[existingIndex];
      result[existingIndex] = {
        lineType: existing.lineType,
        raw: {
          ...existing.raw,
          quantity: (existing.raw.quantity ?? 0) + (line.raw.quantity ?? 0),
          rawDescription:
            existing.raw.rawDescription === line.raw.rawDescription
              ? existing.raw.rawDescription
              : `${existing.raw.rawDescription} | ${line.raw.rawDescription}`,
          lineTotal:
            existing.raw.lineTotal !== null && line.raw.lineTotal !== null
              ? existing.raw.lineTotal + line.raw.lineTotal
              : (existing.raw.lineTotal ?? line.raw.lineTotal),
        },
      };
    }
  }

  return result;
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

  const physicalItems = mergeIdenticalPhysicalLines(classified.filter((line) => isPhysicalLine(line.lineType)));
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

  // How many physical lines can actually become an order_item: a line with
  // an unreadable quantity is never guessed (never "?? 1", never "?? 0" —
  // see confirmDdtDocument, which drops these rather than defaulting to
  // zero), so it can't be saved. This is what "is there anything real to
  // import here" actually means — not just "were any physical lines found".
  const importableItemCount = physicalItems.filter((item) => item.raw.quantity !== null).length;

  // Blocking: the order genuinely CANNOT be auto-created without a human
  // typing something in — no supplier means nothing to set orders.supplier_id
  // (NOT NULL) to, no customer name means nothing to match or create a
  // customer record with, and zero importable items means there would be
  // nothing to save at all. Everything else is informational only (spec:
  // "don't block the user, just tell them") — the document still imports,
  // with whatever's uncertain flagged for a look afterward.
  const blockingIssues: string[] = [];
  if (!extracted.supplier.name) blockingIssues.push("Furnizor neidentificat");
  if (!extracted.customer.companyName) blockingIssues.push("Client neidentificat");
  if (importableItemCount === 0) blockingIssues.push("Nessun prodotto con quantità leggibile");

  const reviewIssues: string[] = [];
  if (!extracted.document.documentNumber) reviewIssues.push("Numero DDT non identificato");
  if (unreadableQuantityLines.length > 0) {
    reviewIssues.push(
      `${unreadableQuantityLines.length} righe con quantità non leggibile — non verranno aggiunte, inseriscile manualmente dalla pagina dell'ordine`
    );
  }
  if (tyreCountValidation === "TYRE_COUNT_REVIEW_REQUIRED") {
    reviewIssues.push("Il numero di pneumatici non è confermabile rispetto al Nr. Colli");
  }

  let status: DocumentStatus;
  const reasons: string[] = [];
  const blocked = blockingIssues.length > 0;

  if (exactDuplicate) {
    status = "DUPLICATE";
    reasons.push(`Documento già importato — ordine esistente ${exactDuplicate.id}`);
  } else if (fingerprintMatch) {
    status = "POSSIBLE_DUPLICATE";
    reasons.push("Documento molto simile a un ordine esistente — verifica prima di importare");
  } else if (blocked) {
    status = "NEEDS_REVIEW";
    reasons.push(...blockingIssues, ...reviewIssues);
  } else if (reviewIssues.length > 0) {
    status = "NEEDS_REVIEW";
    reasons.push(...reviewIssues);
  } else {
    const missingOptional: string[] = [];
    if (!extracted.customer.phone) missingOptional.push("telefon");
    if (!extracted.customer.postalCode) missingOptional.push("CAP");
    if (missingOptional.length > 0) {
      status = "READY_MISSING_OPTIONAL";
      reasons.push(`Dati facoltativi mancanti: ${missingOptional.join(", ")}`);
    } else {
      status = "READY";
    }
  }

  return {
    extracted,
    blocked,
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

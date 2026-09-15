import { parseAmount } from "@/lib/documents/pipeline/money";
import { validateGtin } from "@/lib/catalogue/gtin";
import {
  checkAmountConsistency,
  classifyPaymentTerms,
  type PaymentOperationalStatus,
} from "@/lib/transport/payment";
import type { ExtractedDelivery, TransportDocumentExtraction } from "@/lib/transport/extraction-schema";

/**
 * Deterministic validation of a model extraction.
 *
 * The governing rule, stated in the brief and worth restating: correctness is
 * NOT derived from an average confidence score. A model that is 0.95 confident
 * about a wrong postal code is still wrong, and a model that is 0.4 confident
 * about a correctly-read VAT number is still right. So every check here is a
 * verifiable fact about the data -- a check digit, a range, an arithmetic
 * identity, a presence requirement -- and confidence is never an input.
 *
 * Severity has exactly two meanings:
 *   BLOCKING -- confirmation is impossible until an operator resolves it
 *   WARNING  -- shown, and the operator may proceed anyway
 *
 * There is no third level, because a validator that emits advice nobody has
 * to act on trains operators to ignore it.
 */

export type IssueSeverity = "BLOCKING" | "WARNING";

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** Dotted path so the review UI can highlight the offending field. */
  field: string | null;
  /** Index into `deliveries`, or null for document-level issues. */
  deliveryIndex: number | null;
}

export interface DeliveryValidation {
  deliveryIndex: number;
  issues: ValidationIssue[];
  /** Payment status recomputed in code from the printed terms. */
  resolvedPaymentStatus: PaymentOperationalStatus;
  /** Integer cents. null means "not stated", which is not zero. */
  amountToCollectCents: number | null;
  /** Sum of readable line quantities. */
  lineQuantityTotal: number | null;
  /** The tyre count this delivery will be created with. */
  effectiveTyreCount: number | null;
  canConfirm: boolean;
}

export interface ValidationResult {
  documentIssues: ValidationIssue[];
  deliveries: DeliveryValidation[];
  /** True only when every delivery is individually confirmable. */
  canConfirmAll: boolean;
  confirmableCount: number;
  totalTyres: number;
}

// ---------------------------------------------------------------------------
// Italian identifier validation
// ---------------------------------------------------------------------------

/**
 * Partita IVA: 11 digits with a Luhn-style check digit.
 *
 * Verified against both identifiers on the Zuin sample -- the distributor's
 * 02627710284 and the recipient's 03824320240 both validate under this
 * implementation.
 */
export function isValidItalianVat(value: string | null | undefined): boolean {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length !== 11) return false;

  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const digit = Number(digits[index]);
    if (index % 2 === 0) {
      sum += digit;
    } else {
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    }
  }

  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(digits[10]);
}

const CF_ODD_VALUES: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

function cfEvenValue(char: string): number {
  if (char >= "0" && char <= "9") return Number(char);
  return char.charCodeAt(0) - 65;
}

/**
 * Codice fiscale: 16 characters, final character is a mod-26 check letter.
 *
 * An 11-digit numeric codice fiscale (used by companies, where it equals the
 * VAT number) is validated as a VAT number instead.
 *
 * Verified against the Zuin sample's NCTFRC90C06L840X.
 */
export function isValidItalianTaxCode(value: string | null | undefined): boolean {
  const code = (value ?? "").replace(/\s/g, "").toUpperCase();

  if (/^\d{11}$/.test(code)) return isValidItalianVat(code);
  if (!/^[0-9A-Z]{16}$/.test(code)) return false;

  let sum = 0;
  for (let index = 0; index < 15; index += 1) {
    const char = code[index];
    // 1-based position parity: index 0 is position 1, which is odd.
    sum += index % 2 === 0 ? (CF_ODD_VALUES[char] ?? 0) : cfEvenValue(char);
  }

  return String.fromCharCode(65 + (sum % 26)) === code[15];
}

/** Italian CAP: exactly five digits. */
export function isValidPostalCode(value: string | null | undefined): boolean {
  return /^\d{5}$/.test((value ?? "").trim());
}

/** Italian province: a two-letter code. */
export function isValidProvince(value: string | null | undefined): boolean {
  return /^[A-Za-z]{2}$/.test((value ?? "").trim());
}

/** ISO date that is also a real calendar date. Rejects 2026-02-30. */
export function isValidIsoDate(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// ---------------------------------------------------------------------------
// Tyre dimension ranges
// ---------------------------------------------------------------------------

/**
 * Plausible ranges for road tyres. Deliberately wide -- the purpose is to
 * catch a misread (a width of 18 or 1855, a rim of 165) rather than to
 * police the catalogue. A value outside these is a warning, not a block:
 * the tyre still has to be transported either way, and the original
 * description is preserved regardless.
 */
export const TYRE_RANGES = {
  width: { min: 125, max: 445 },
  aspectRatio: { min: 25, max: 105 },
  rimDiameter: { min: 10, max: 30 },
} as const;

function inRange(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max;
}

// ---------------------------------------------------------------------------
// Address completeness
// ---------------------------------------------------------------------------

/**
 * A delivery address is complete enough to drive to when it has a street, a
 * town and a postal code. Province is checked separately -- it is useful for
 * routing but a missing one does not stop a driver finding the address.
 */
export function addressCompleteness(recipient: ExtractedDelivery["recipient"]): {
  complete: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!recipient.addressLine?.trim()) missing.push("addressLine");
  if (!recipient.city?.trim()) missing.push("city");
  if (!recipient.postalCode?.trim()) missing.push("postalCode");
  return { complete: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Delivery validation
// ---------------------------------------------------------------------------

function issue(
  severity: IssueSeverity,
  code: string,
  message: string,
  field: string | null,
  deliveryIndex: number | null
): ValidationIssue {
  return { severity, code, message, field, deliveryIndex };
}

function validateDelivery(delivery: ExtractedDelivery, index: number): DeliveryValidation {
  const issues: ValidationIssue[] = [];
  const path = (suffix: string) => `deliveries.${index}.${suffix}`;

  // --- Document reference -------------------------------------------------
  // No universal format is imposed: "1A - 050472/VR" is as valid as "12345".
  // The requirement is that SOME reference exists, because it is how a
  // duplicate is detected and how the distributor identifies the consignment.
  if (!delivery.deliveryDocumentNumber?.trim()) {
    issues.push(
      issue(
        "BLOCKING",
        "DOCUMENT_REFERENCE_MISSING",
        "Manca il numero del documento/DDT: impossibile tracciare o rilevare duplicati.",
        path("deliveryDocumentNumber"),
        index
      )
    );
  }

  // --- Recipient ----------------------------------------------------------
  const recipient = delivery.recipient;
  if (!recipient.companyName?.trim()) {
    issues.push(
      issue("BLOCKING", "RECIPIENT_NAME_MISSING", "Manca la ragione sociale del destinatario.", path("recipient.companyName"), index)
    );
  }

  const address = addressCompleteness(recipient);
  if (!address.complete) {
    issues.push(
      issue(
        "BLOCKING",
        "DELIVERY_ADDRESS_INCOMPLETE",
        `Indirizzo di consegna incompleto: manca ${address.missing.join(", ")}.`,
        path("recipient.addressLine"),
        index
      )
    );
  }

  if (recipient.postalCode?.trim() && !isValidPostalCode(recipient.postalCode)) {
    issues.push(
      issue("WARNING", "POSTAL_CODE_INVALID", `CAP non valido: "${recipient.postalCode}".`, path("recipient.postalCode"), index)
    );
  }

  if (recipient.province?.trim() && !isValidProvince(recipient.province)) {
    issues.push(
      issue("WARNING", "PROVINCE_INVALID", `Provincia non valida: "${recipient.province}".`, path("recipient.province"), index)
    );
  }

  if (recipient.vatNumber?.trim() && !isValidItalianVat(recipient.vatNumber)) {
    // A warning, not a block: a foreign or mis-keyed VAT does not stop a
    // delivery, but the operator should see it before it is saved as a
    // matching key for every future document.
    issues.push(
      issue("WARNING", "RECIPIENT_VAT_INVALID", `Partita IVA del destinatario non valida: "${recipient.vatNumber}".`, path("recipient.vatNumber"), index)
    );
  }

  if (recipient.taxCode?.trim() && !isValidItalianTaxCode(recipient.taxCode)) {
    issues.push(
      issue("WARNING", "RECIPIENT_TAX_CODE_INVALID", `Codice fiscale non valido: "${recipient.taxCode}".`, path("recipient.taxCode"), index)
    );
  }

  // --- Dates --------------------------------------------------------------
  for (const [key, value] of [
    ["deliveryDate", delivery.deliveryDate],
  ] as const) {
    if (value?.trim() && !isValidIsoDate(value)) {
      issues.push(issue("WARNING", "DATE_INVALID", `Data non valida: "${value}".`, path(key), index));
    }
  }

  // --- Items and quantities -----------------------------------------------
  let lineQuantityTotal: number | null = null;
  let anyQuantityUnreadable = false;

  delivery.items.forEach((item, itemIndex) => {
    const itemPath = (suffix: string) => path(`items.${itemIndex}.${suffix}`);

    if (item.quantity === null) {
      anyQuantityUnreadable = true;
      issues.push(
        issue(
          "BLOCKING",
          "QUANTITY_UNREADABLE",
          `Riga ${itemIndex + 1}: quantita' non leggibile. Inserire il valore corretto -- il sistema non lo inventa.`,
          itemPath("quantity"),
          index
        )
      );
    } else if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      issues.push(
        issue("BLOCKING", "QUANTITY_NOT_POSITIVE_INTEGER", `Riga ${itemIndex + 1}: quantita' non valida (${item.quantity}).`, itemPath("quantity"), index)
      );
    } else {
      lineQuantityTotal = (lineQuantityTotal ?? 0) + item.quantity;
    }

    if (item.ean?.trim()) {
      const gtin = validateGtin(item.ean);
      if (gtin.status === "invalid_check_digit") {
        issues.push(
          issue("WARNING", "EAN_CHECK_DIGIT_INVALID", `Riga ${itemIndex + 1}: EAN "${item.ean}" ha una cifra di controllo errata.`, itemPath("ean"), index)
        );
      }
    }

    for (const [key, range] of [
      ["width", TYRE_RANGES.width],
      ["aspectRatio", TYRE_RANGES.aspectRatio],
      ["rimDiameter", TYRE_RANGES.rimDiameter],
    ] as const) {
      const value = item[key];
      if (value !== null && !inRange(value, range)) {
        issues.push(
          issue("WARNING", "TYRE_DIMENSION_OUT_OF_RANGE", `Riga ${itemIndex + 1}: ${key} ${value} fuori dall'intervallo plausibile (${range.min}-${range.max}).`, itemPath(key), index)
        );
      }
    }
  });

  // At least one operational item, or a confirmed quantity to move.
  const hasItems = delivery.items.length > 0;
  const hasDeclaredQuantity =
    (delivery.totalTyres !== null && delivery.totalTyres > 0) ||
    (delivery.packages !== null && delivery.packages > 0);

  if (!hasItems && !hasDeclaredQuantity) {
    issues.push(
      issue("BLOCKING", "NO_OPERATIONAL_QUANTITY", "Nessun articolo e nessuna quantita' dichiarata: non c'e' nulla da trasportare.", path("items"), index)
    );
  }

  // totalTyres vs the sum of the lines. A mismatch is blocking because the
  // depot counts against this number on arrival -- a wrong expectation
  // manufactures a phantom shortage.
  if (delivery.totalTyres !== null && lineQuantityTotal !== null && !anyQuantityUnreadable) {
    if (delivery.totalTyres !== lineQuantityTotal) {
      issues.push(
        issue(
          "BLOCKING",
          "TOTAL_QUANTITY_MISMATCH",
          `Totale dichiarato (${delivery.totalTyres}) diverso dalla somma delle righe (${lineQuantityTotal}).`,
          path("totalTyres"),
          index
        )
      );
    }
  }

  if (delivery.packages !== null && delivery.packages < 0) {
    issues.push(issue("WARNING", "PACKAGES_NEGATIVE", "Numero di colli negativo.", path("packages"), index));
  }
  if (delivery.weightKg !== null && delivery.weightKg < 0) {
    issues.push(issue("WARNING", "WEIGHT_NEGATIVE", "Peso negativo.", path("weightKg"), index));
  }

  // --- Payment ------------------------------------------------------------
  // The status is RECOMPUTED from the printed terms rather than taken from
  // the model. If the model's opinion differs, the document text wins and the
  // disagreement is surfaced -- that is the whole point of having a
  // deterministic classifier.
  const classification = classifyPaymentTerms(delivery.payment.printedTerms);
  const resolvedPaymentStatus = classification.status;

  if (
    delivery.payment.operationalStatus !== resolvedPaymentStatus &&
    delivery.payment.operationalStatus !== "UNKNOWN_REVIEW_REQUIRED"
  ) {
    issues.push(
      issue(
        "WARNING",
        "PAYMENT_STATUS_DISAGREEMENT",
        `Il modello ha proposto ${delivery.payment.operationalStatus}, le condizioni stampate indicano ${resolvedPaymentStatus}. Vale il documento.`,
        path("payment.operationalStatus"),
        index
      )
    );
  }

  const parsedAmount = parseAmount(delivery.payment.amountToCollect);
  // Only a collecting status may carry an amount at all. On a non-collecting
  // document any figure the model returned is discarded here, which is what
  // stops a taxable total (the Zuin 63,74) reaching a driver as a COD.
  const amountToCollectCents =
    classification.mustDriverCollect === true ? parsedAmount.cents : classification.status === "UNKNOWN_REVIEW_REQUIRED" ? null : 0;

  for (const consistency of checkAmountConsistency({
    status: resolvedPaymentStatus,
    amountToCollectCents,
  })) {
    issues.push(issue("BLOCKING", consistency.code, consistency.message, path("payment.amountToCollect"), index));
  }

  // --- Contradictory references -------------------------------------------
  const lineRefs = new Set(
    delivery.items.map((item) => item.supplierOrderReference?.trim()).filter((ref): ref is string => Boolean(ref))
  );
  if (delivery.supplierOrderReference?.trim() && lineRefs.size > 0) {
    const headerRef = delivery.supplierOrderReference.trim();
    if (!lineRefs.has(headerRef) && lineRefs.size === 1) {
      issues.push(
        issue(
          "WARNING",
          "ORDER_REFERENCE_CONTRADICTION",
          `Riferimento ordine in testata "${headerRef}" diverso da quello delle righe "${[...lineRefs][0]}".`,
          path("supplierOrderReference"),
          index
        )
      );
    }
  }

  const effectiveTyreCount = lineQuantityTotal ?? delivery.totalTyres ?? delivery.packages ?? null;

  return {
    deliveryIndex: index,
    issues,
    resolvedPaymentStatus,
    amountToCollectCents,
    lineQuantityTotal,
    effectiveTyreCount,
    canConfirm: !issues.some((entry) => entry.severity === "BLOCKING"),
  };
}

// ---------------------------------------------------------------------------
// Document validation
// ---------------------------------------------------------------------------

export function validateExtraction(extraction: TransportDocumentExtraction): ValidationResult {
  const documentIssues: ValidationIssue[] = [];

  if (!extraction.documentClassification.isTransportRelevant) {
    documentIssues.push(
      issue(
        "BLOCKING",
        "NOT_TRANSPORT_RELEVANT",
        "Il documento non sembra un documento di trasporto.",
        "documentClassification.isTransportRelevant",
        null
      )
    );
  }

  if (!extraction.distributor.name?.trim()) {
    documentIssues.push(
      issue("BLOCKING", "DISTRIBUTOR_MISSING", "Distributore non identificato: selezionarlo manualmente.", "distributor.name", null)
    );
  }

  if (extraction.distributor.vatNumber?.trim() && !isValidItalianVat(extraction.distributor.vatNumber)) {
    documentIssues.push(
      issue("WARNING", "DISTRIBUTOR_VAT_INVALID", `Partita IVA del distributore non valida: "${extraction.distributor.vatNumber}".`, "distributor.vatNumber", null)
    );
  }

  if (
    extraction.documentClassification.documentDate?.trim() &&
    !isValidIsoDate(extraction.documentClassification.documentDate)
  ) {
    documentIssues.push(
      issue("WARNING", "DOCUMENT_DATE_INVALID", `Data documento non valida: "${extraction.documentClassification.documentDate}".`, "documentClassification.documentDate", null)
    );
  }

  if (extraction.deliveries.length === 0) {
    documentIssues.push(
      issue("BLOCKING", "NO_DELIVERIES_FOUND", "Nessuna consegna individuata nel testo incollato.", "deliveries", null)
    );
  }

  // Unknown inbound method is a WARNING, not a block: the goods still have to
  // move, and the operator is asked to settle it on the review screen. The
  // job is created in awaiting_pickup so it cannot be silently forgotten.
  if (extraction.inboundLogistics.method === "UNKNOWN") {
    documentIssues.push(
      issue(
        "WARNING",
        "INBOUND_METHOD_UNKNOWN",
        "Da verificare: ritiro Go Rush o consegna del fornitore?",
        "inboundLogistics.method",
        null
      )
    );
  }

  const deliveries = extraction.deliveries.map(validateDelivery);
  const documentBlocked = documentIssues.some((entry) => entry.severity === "BLOCKING");

  const confirmable = deliveries.filter((entry) => entry.canConfirm && !documentBlocked);

  return {
    documentIssues,
    deliveries,
    canConfirmAll: !documentBlocked && deliveries.every((entry) => entry.canConfirm),
    confirmableCount: confirmable.length,
    totalTyres: confirmable.reduce((sum, entry) => sum + (entry.effectiveTyreCount ?? 0), 0),
  };
}

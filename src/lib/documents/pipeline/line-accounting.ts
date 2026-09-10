// Source-line accounting.
//
// The invariant this module exists to enforce:
//
//   sourceLineCount === orderItems + charges + textNotes + excluded + unresolved
//
// Every line a document produced must end up in exactly one bucket. Before
// this, a line the classifier could not place was neither physical nor a
// charge, so it appeared in no collection at all and vanished between
// extraction and order with no counter, no warning and no audit record.
//
// UNRESOLVED is a real, first-class outcome — the point is that it exists and
// blocks confirmation, rather than being represented by absence.
//
// Pure and dependency-free.

import type { ClassifiedLineType } from "@/lib/logistics/ddt-classification";

export type LineOutcome =
  | "ORDER_ITEM"
  | "DOCUMENT_CHARGE"
  | "TEXT_NOTE"
  | "EXPLICITLY_EXCLUDED"
  | "UNRESOLVED";

export const LINE_OUTCOMES: readonly LineOutcome[] = [
  "ORDER_ITEM",
  "DOCUMENT_CHARGE",
  "TEXT_NOTE",
  "EXPLICITLY_EXCLUDED",
  "UNRESOLVED",
];

export type ValidationSeverity = "INFO" | "WARNING" | "BLOCKING";

export interface LineIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
}

export interface AccountedLine {
  sourceDocumentIndex: number;
  sourceLineIndex: number;
  outcome: LineOutcome;
  classification: ClassifiedLineType;
  issues: LineIssue[];
  /** Set only for EXPLICITLY_EXCLUDED, and required there. */
  exclusion: { by: string; reason: string } | null;
}

export interface AccountingTally {
  sourceLineCount: number;
  orderItemCount: number;
  chargeCount: number;
  textNoteCount: number;
  excludedCount: number;
  unresolvedCount: number;
}

export interface AccountingResult {
  tally: AccountingTally;
  /** True when every line is in exactly one bucket and the sum matches. */
  balanced: boolean;
  /** Blocking issues that must be cleared before an order may be created. */
  blocking: LineIssue[];
  warnings: LineIssue[];
}

/** Physical types that can legitimately become an order_item. */
const ORDER_ITEM_TYPES = new Set<ClassifiedLineType>([
  "TYRE",
  "TUBE",
  "RIM",
  "OTHER_PHYSICAL_ITEM",
]);

const CHARGE_TYPES = new Set<ClassifiedLineType>([
  "PFU",
  "LOGISTICS_FEE",
  "TRANSPORT_FEE",
  "DISCOUNT",
  "VAT",
  "OTHER_FEE",
]);

export interface LineForAccounting {
  sourceDocumentIndex: number;
  sourceLineIndex: number;
  classification: ClassifiedLineType;
  /** Null means the source was unreadable — never defaulted to 0 or 1. */
  quantity: number | null;
  /** Any monetary value the line carries. Used to spot unresolved financials. */
  hasMonetaryValue: boolean;
  /** Whether the line carried any text at all. */
  hasText: boolean;
  /** An explicit operator exclusion, with its mandatory reason. */
  exclusion?: { by: string; reason: string } | null;
}

/**
 * Assigns exactly one outcome to each line and reports what blocks import.
 *
 * The ordering matters: an explicit operator exclusion wins over everything,
 * because a human has already looked at the line and decided. Nothing else
 * may override that.
 */
export function accountForLines(lines: readonly LineForAccounting[]): {
  accounted: AccountedLine[];
  result: AccountingResult;
} {
  const accounted: AccountedLine[] = [];
  const blocking: LineIssue[] = [];
  const warnings: LineIssue[] = [];

  for (const line of lines) {
    const issues: LineIssue[] = [];
    const at = `doc ${line.sourceDocumentIndex}, riga ${line.sourceLineIndex}`;

    // 1. An operator already decided. Nothing overrides that.
    if (line.exclusion) {
      accounted.push({
        sourceDocumentIndex: line.sourceDocumentIndex,
        sourceLineIndex: line.sourceLineIndex,
        outcome: "EXPLICITLY_EXCLUDED",
        classification: line.classification,
        issues,
        exclusion: line.exclusion,
      });
      continue;
    }

    // 2. A physical line with no readable quantity cannot become an item and
    //    must never be guessed. It blocks rather than being dropped.
    if (ORDER_ITEM_TYPES.has(line.classification)) {
      if (line.quantity === null) {
        const issue: LineIssue = {
          code: "PHYSICAL_LINE_QUANTITY_UNREADABLE",
          severity: "BLOCKING",
          message: `Quantità non leggibile (${at}) — correggila o escludi la riga con una motivazione.`,
        };
        issues.push(issue);
        blocking.push(issue);
        accounted.push({
          sourceDocumentIndex: line.sourceDocumentIndex,
          sourceLineIndex: line.sourceLineIndex,
          outcome: "UNRESOLVED",
          classification: line.classification,
          issues,
          exclusion: null,
        });
        continue;
      }

      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        const issue: LineIssue = {
          code: "PHYSICAL_LINE_QUANTITY_INVALID",
          severity: "BLOCKING",
          message: `Quantità non valida (${at}): ${line.quantity}. Gli articoli fisici richiedono un intero positivo.`,
        };
        issues.push(issue);
        blocking.push(issue);
        accounted.push({
          sourceDocumentIndex: line.sourceDocumentIndex,
          sourceLineIndex: line.sourceLineIndex,
          outcome: "UNRESOLVED",
          classification: line.classification,
          issues,
          exclusion: null,
        });
        continue;
      }

      accounted.push({
        sourceDocumentIndex: line.sourceDocumentIndex,
        sourceLineIndex: line.sourceLineIndex,
        outcome: "ORDER_ITEM",
        classification: line.classification,
        issues,
        exclusion: null,
      });
      continue;
    }

    // 3. A recognised charge.
    if (CHARGE_TYPES.has(line.classification)) {
      accounted.push({
        sourceDocumentIndex: line.sourceDocumentIndex,
        sourceLineIndex: line.sourceLineIndex,
        outcome: "DOCUMENT_CHARGE",
        classification: line.classification,
        issues,
        exclusion: null,
      });
      continue;
    }

    // 4. Unclassified. This is where lines used to disappear.
    //
    //    A line carrying money is a financial fact we failed to place, and
    //    leaving it out would change the document's totals — it blocks. A
    //    line with text but no money and no quantity is plausibly a note, so
    //    it is recorded as one and merely warned about. Either way it has a
    //    row and a count.
    if (line.hasMonetaryValue || line.quantity !== null) {
      const issue: LineIssue = {
        code: "UNCLASSIFIED_LINE_WITH_VALUE",
        severity: "BLOCKING",
        message: `Riga non classificata con un valore (${at}) — assegnale una classificazione o escludila con una motivazione.`,
      };
      issues.push(issue);
      blocking.push(issue);
      accounted.push({
        sourceDocumentIndex: line.sourceDocumentIndex,
        sourceLineIndex: line.sourceLineIndex,
        outcome: "UNRESOLVED",
        classification: line.classification,
        issues,
        exclusion: null,
      });
      continue;
    }

    const noteIssue: LineIssue = {
      code: "UNCLASSIFIED_TEXT_LINE",
      severity: "WARNING",
      message: `Riga di testo senza valore (${at}) — registrata come nota.`,
    };
    issues.push(noteIssue);
    warnings.push(noteIssue);
    accounted.push({
      sourceDocumentIndex: line.sourceDocumentIndex,
      sourceLineIndex: line.sourceLineIndex,
      outcome: line.hasText ? "TEXT_NOTE" : "UNRESOLVED",
      classification: line.classification,
      issues,
      exclusion: null,
    });
  }

  const tally = tallyOutcomes(lines.length, accounted);

  if (!isBalanced(tally)) {
    blocking.push({
      code: "LINE_ACCOUNTING_UNBALANCED",
      severity: "BLOCKING",
      message: `Conteggio righe non quadra: ${tally.sourceLineCount} righe di origine, ${tally.orderItemCount + tally.chargeCount + tally.textNoteCount + tally.excludedCount + tally.unresolvedCount} assegnate.`,
    });
  }

  if (tally.unresolvedCount > 0) {
    blocking.push({
      code: "UNRESOLVED_LINES",
      severity: "BLOCKING",
      message: `${tally.unresolvedCount} righe non risolte — ogni riga deve diventare un articolo, un addebito, una nota o un'esclusione motivata.`,
    });
  }

  return {
    accounted,
    result: {
      tally,
      balanced: isBalanced(tally),
      blocking,
      warnings,
    },
  };
}

export function tallyOutcomes(
  sourceLineCount: number,
  accounted: readonly AccountedLine[]
): AccountingTally {
  const count = (outcome: LineOutcome) => accounted.filter((line) => line.outcome === outcome).length;
  return {
    sourceLineCount,
    orderItemCount: count("ORDER_ITEM"),
    chargeCount: count("DOCUMENT_CHARGE"),
    textNoteCount: count("TEXT_NOTE"),
    excludedCount: count("EXPLICITLY_EXCLUDED"),
    unresolvedCount: count("UNRESOLVED"),
  };
}

/** The invariant, expressed exactly as the specification states it. */
export function isBalanced(tally: AccountingTally): boolean {
  return (
    tally.sourceLineCount ===
    tally.orderItemCount +
      tally.chargeCount +
      tally.textNoteCount +
      tally.excludedCount +
      tally.unresolvedCount
  );
}

/** Auto-confirmation requires that nothing is unresolved. */
export function canAutoConfirm(tally: AccountingTally): boolean {
  return isBalanced(tally) && tally.unresolvedCount === 0;
}

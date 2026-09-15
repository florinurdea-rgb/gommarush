import { createHash } from "node:crypto";
import { normaliseDocumentNumber } from "@/lib/logistics/ddt-dedup";

/**
 * Duplicate detection for transport documents.
 *
 * The rule that shapes everything here: a possible duplicate is NEVER silently
 * discarded. The same consignment genuinely does get sent twice -- a
 * distributor re-emails a corrected DDT, an operator pastes the same text
 * after a browser reload, two people process the same inbox. Dropping the
 * second copy loses a real delivery; importing it blindly creates a phantom
 * one. So this module's job is to explain what it found and hand the decision
 * to an operator, with one exception: a document whose order already exists is
 * blocked, because creating it twice is never the right answer.
 *
 * Hashing alone is insufficient and that is the point of having five signals.
 * The same commercial document copied out of a PDF twice can differ by a
 * single space and hash differently, while two genuinely different DDTs from
 * the same distributor on the same day look similar on every field except the
 * document number.
 */

export const DUPLICATE_SIGNAL_KINDS = [
  "SOURCE_HASH",
  "DISTRIBUTOR_DOCUMENT_NUMBER",
  "DISTRIBUTOR_ORDER_REFERENCE",
  "DISTRIBUTOR_CUSTOMER_DATE",
  "INGESTION_LINK",
] as const;

export type DuplicateSignalKind = (typeof DUPLICATE_SIGNAL_KINDS)[number];

export type DuplicateVerdict = "NONE" | "PROBABLE" | "EXACT";

export interface DuplicateSignal {
  kind: DuplicateSignalKind;
  /** What matched, in operator-readable terms. */
  evidence: string;
  /** Whether this signal alone proves the same commercial document. */
  conclusive: boolean;
}

/** An existing record that resembles the incoming document. */
export interface DuplicateCandidate {
  /** The order this candidate is, or produced. Null when only an ingestion exists. */
  orderId: string | null;
  orderNumber: string | number | null;
  ingestionId: string | null;
  distributorId: string | null;
  distributorName: string | null;
  documentNumber: string | null;
  normalizedDocumentNumber: string | null;
  supplierOrderReference: string | null;
  sourceSha256: string | null;
  distributorCustomerCode: string | null;
  documentDate: string | null;
  createdAt: string | null;
}

export interface IncomingDocument {
  distributorId: string | null;
  documentNumber: string | null;
  supplierOrderReference: string | null;
  sourceSha256: string | null;
  distributorCustomerCode: string | null;
  documentDate: string | null;
}

export type DuplicateChoice = "OPEN_EXISTING" | "CONTINUE_AS_NEW" | "CANCEL";

export interface DuplicateMatch {
  candidate: DuplicateCandidate;
  signals: DuplicateSignal[];
  verdict: DuplicateVerdict;
  /** Why, in Italian, for the review screen. */
  reason: string;
  /** What the operator may do about it. */
  choices: DuplicateChoice[];
}

export interface DuplicateAssessment {
  verdict: DuplicateVerdict;
  matches: DuplicateMatch[];
  /** True when confirmation must not proceed without an explicit operator decision. */
  blocksConfirmation: boolean;
}

/**
 * Normalises pasted text before hashing.
 *
 * Collapsing whitespace and folding case means the same document pasted twice
 * hashes identically even when one copy picked up different line breaks or
 * trailing spaces from the PDF viewer. Punctuation is deliberately preserved:
 * "1A - 050472/VR" and "1A-050472/VR" are the same document number, but that
 * equivalence belongs to normaliseDocumentNumber, not to the text hash --
 * flattening punctuation here would make genuinely different documents
 * collide.
 */
export function normalizeSourceText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function hashSourceText(text: string): string {
  return createHash("sha256").update(normalizeSourceText(text), "utf8").digest("hex");
}

/** Reuses the project's own normalisation, so a match here means a match in the database's unique index. */
export function normalizeDocumentNumberForMatch(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? normaliseDocumentNumber(trimmed) : null;
}

function describeCandidate(candidate: DuplicateCandidate): string {
  const parts: string[] = [];
  if (candidate.orderNumber !== null) parts.push(`ordine #${candidate.orderNumber}`);
  if (candidate.documentNumber) parts.push(`DDT ${candidate.documentNumber}`);
  if (candidate.distributorName) parts.push(candidate.distributorName);
  if (candidate.documentDate) parts.push(candidate.documentDate);
  return parts.length > 0 ? parts.join(" - ") : "documento esistente";
}

function collectSignals(incoming: IncomingDocument, candidate: DuplicateCandidate): DuplicateSignal[] {
  const signals: DuplicateSignal[] = [];

  if (incoming.sourceSha256 && candidate.sourceSha256 && incoming.sourceSha256 === candidate.sourceSha256) {
    signals.push({
      kind: "SOURCE_HASH",
      evidence: "Il testo del documento e' identico a uno gia' elaborato.",
      // Identical text is strong, but not conclusive on its own: an operator
      // may legitimately re-paste after an extraction failed, and no order
      // exists in that case.
      conclusive: false,
    });
  }

  const incomingNumber = normalizeDocumentNumberForMatch(incoming.documentNumber);
  if (
    incomingNumber &&
    candidate.normalizedDocumentNumber &&
    incoming.distributorId &&
    candidate.distributorId === incoming.distributorId &&
    candidate.normalizedDocumentNumber === incomingNumber
  ) {
    signals.push({
      kind: "DISTRIBUTOR_DOCUMENT_NUMBER",
      evidence: `Stesso distributore e stesso numero documento (${candidate.documentNumber ?? incomingNumber}).`,
      // The same distributor cannot issue the same DDT number twice for
      // different goods. This is the one signal that settles it.
      conclusive: true,
    });
  }

  if (
    incoming.supplierOrderReference?.trim() &&
    candidate.supplierOrderReference?.trim() &&
    incoming.distributorId &&
    candidate.distributorId === incoming.distributorId &&
    candidate.supplierOrderReference.trim().toUpperCase() === incoming.supplierOrderReference.trim().toUpperCase()
  ) {
    signals.push({
      kind: "DISTRIBUTOR_ORDER_REFERENCE",
      evidence: `Stesso riferimento ordine (${candidate.supplierOrderReference}).`,
      // One supplier order can legitimately be split across several DDTs.
      conclusive: false,
    });
  }

  if (
    incoming.distributorCustomerCode?.trim() &&
    candidate.distributorCustomerCode?.trim() &&
    incoming.documentDate &&
    candidate.documentDate === incoming.documentDate &&
    candidate.distributorCustomerCode.trim() === incoming.distributorCustomerCode.trim()
  ) {
    signals.push({
      kind: "DISTRIBUTOR_CUSTOMER_DATE",
      evidence: `Stesso codice cliente (${candidate.distributorCustomerCode}) nella stessa data (${candidate.documentDate}).`,
      // A distributor can send the same customer two consignments in a day.
      conclusive: false,
    });
  }

  return signals;
}

/**
 * Assesses an incoming document against candidates already in the system.
 *
 * Verdicts:
 *   EXACT     a conclusive signal AND an order already exists -> blocked.
 *             Creating it again would double a real delivery, and the
 *             database's own unique index would reject it anyway.
 *   PROBABLE  something matched, or a conclusive signal matched an ingestion
 *             that never produced an order -> shown with choices.
 *   NONE      nothing matched.
 */
export function assessDuplicates(input: {
  incoming: IncomingDocument;
  candidates: readonly DuplicateCandidate[];
}): DuplicateAssessment {
  const matches: DuplicateMatch[] = [];

  for (const candidate of input.candidates) {
    const signals = collectSignals(input.incoming, candidate);
    if (signals.length === 0) continue;

    const hasConclusive = signals.some((signal) => signal.conclusive);
    const orderExists = candidate.orderId !== null;

    let verdict: DuplicateVerdict;
    let reason: string;
    let choices: DuplicateChoice[];

    if (hasConclusive && orderExists) {
      verdict = "EXACT";
      reason = `Questo documento e' gia' stato importato come ${describeCandidate(candidate)}.`;
      // No CONTINUE_AS_NEW: the unique index on (supplier_id,
      // normalized_document_number) would reject the insert, so offering it
      // would be offering a guaranteed failure.
      choices = ["OPEN_EXISTING", "CANCEL"];
    } else if (hasConclusive) {
      verdict = "PROBABLE";
      reason = `Un tentativo precedente con lo stesso numero documento non ha creato ordini (${describeCandidate(candidate)}). Si puo' procedere.`;
      choices = ["CONTINUE_AS_NEW", "CANCEL"];
    } else {
      verdict = "PROBABLE";
      reason = `Possibile duplicato di ${describeCandidate(candidate)}.`;
      choices = orderExists
        ? ["OPEN_EXISTING", "CONTINUE_AS_NEW", "CANCEL"]
        : ["CONTINUE_AS_NEW", "CANCEL"];
    }

    matches.push({ candidate, signals, verdict, reason, choices });
  }

  // Strongest verdict wins, and EXACT matches sort first so the review screen
  // leads with the blocking one.
  matches.sort((a, b) => {
    const rank = (verdict: DuplicateVerdict) => (verdict === "EXACT" ? 0 : verdict === "PROBABLE" ? 1 : 2);
    return rank(a.verdict) - rank(b.verdict);
  });

  const verdict: DuplicateVerdict = matches.some((match) => match.verdict === "EXACT")
    ? "EXACT"
    : matches.length > 0
      ? "PROBABLE"
      : "NONE";

  return {
    verdict,
    matches,
    // A PROBABLE duplicate does not block: it requires an acknowledged choice,
    // which the confirm route enforces by demanding the operator echo back
    // the decision. Only EXACT is a hard stop.
    blocksConfirmation: verdict === "EXACT",
  };
}

/**
 * The final check, run inside the confirmation transaction.
 *
 * Two concurrent confirmations of the same document both pass the pre-check
 * and then race. This maps the database's own unique-violation into an
 * operator-readable outcome rather than a 500 -- the protection itself comes
 * from the pre-existing unique indexes on orders, which is the only place it
 * can be enforced correctly under concurrency.
 */
export const CONCURRENT_DUPLICATE_CONSTRAINTS = [
  "orders_supplier_doc_number_key",
  "orders_supplier_document_unique",
] as const;

export function isConcurrentDuplicateError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code !== "23505") return false;

  const haystack = [
    (error as { message?: unknown }).message,
    (error as { details?: unknown }).details,
    (error as { constraint?: unknown }).constraint,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ");

  return CONCURRENT_DUPLICATE_CONSTRAINTS.some((constraint) => haystack.includes(constraint));
}

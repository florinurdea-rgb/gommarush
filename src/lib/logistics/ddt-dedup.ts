import { createHash } from "node:crypto";
import { companyKey } from "@/lib/logistics/customer-matching";

/**
 * Duplicate detection for the DDT/invoice import system (spec §15–17).
 *
 * Two layers, matching the spec exactly:
 *   1. Exact identity — supplier_id + normalized_document_number. Enforced
 *      both here (for the pre-insert check) and by a DB unique index
 *      (orders_supplier_doc_number_key in the migration) as the real
 *      guarantee — the application check alone can't prevent a race.
 *   2. Near-duplicate fingerprint — for documents whose DDT number can't be
 *      read reliably. A fingerprint match is a human decision
 *      (POSSIBLE_DUPLICATE), never an automatic skip or an automatic
 *      import: "NU importa automat."
 */

/** Trimmed, uppercased, whitespace-collapsed — dedup-safe form of a DDT/document number. */
export function normaliseDocumentNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export interface OrderIdentity {
  id: string;
  supplierId: string;
  normalizedDocumentNumber: string | null;
  /**
   * The raw, un-normalized document number as stored on the order —
   * needed as a fallback because `normalized_document_number` is a
   * column added after orders already existed (20260819000000), so any
   * order created before that migration ran (or before its backfill,
   * if the update step failed on a given confirm) has it NULL. Without
   * this fallback, a duplicate detection check that only compares
   * normalized values silently misses those older rows — the pipeline
   * marks the document READY again, and the *database's own* unique
   * constraint on (supplier_id, supplier_document_number) is what
   * actually stops the re-import, as a confusing SAVE_FAILED instead of
   * an honest "DEJA IMPORTAT".
   */
  supplierDocumentNumber: string | null;
}

/** supplier_id + normalized_document_number must be unique — the spec's "primary identity". */
export function findExactDuplicate(
  candidates: OrderIdentity[],
  supplierId: string,
  normalizedDocumentNumber: string
): OrderIdentity | null {
  return (
    candidates.find((candidate) => {
      if (candidate.supplierId !== supplierId) return false;
      const candidateNormalized =
        candidate.normalizedDocumentNumber ??
        (candidate.supplierDocumentNumber ? normaliseDocumentNumber(candidate.supplierDocumentNumber) : null);
      return candidateNormalized === normalizedDocumentNumber;
    }) ?? null
  );
}

export interface FingerprintInput {
  supplierName: string;
  customerName: string;
  postalCode: string | null;
  documentDate: string | null;
  /** A stable, order-independent summary of the line items — see buildItemSignature(). */
  itemSignature: string;
  totalTyres: number;
}

/** A stable summary of "what was ordered", independent of line order, for fingerprinting. */
export function buildItemSignature(items: { brand: string | null; sizeLabel: string | null; quantity: number }[]): string {
  return items
    .map((item) => `${(item.brand ?? "").trim().toUpperCase()}|${(item.sizeLabel ?? "").trim().toUpperCase()}|${item.quantity}`)
    .sort()
    .join(";");
}

/**
 * A near-duplicate fingerprint for when the DDT number itself can't be
 * trusted. Built from normalized supplier/customer identity (companyKey,
 * shared with customer matching — the same "S.r.l." vs "SRL" noise applies
 * to suppliers) plus postcode/date/items/tyre total, so two genuinely
 * different orders (e.g. two customers buying the same tyres the same day)
 * do not collide — see spec §17.
 */
export function computeOrderFingerprint(input: FingerprintInput): string {
  const raw = [
    companyKey(input.supplierName),
    companyKey(input.customerName),
    (input.postalCode ?? "").trim().toUpperCase(),
    input.documentDate ?? "",
    input.itemSignature,
    String(input.totalTyres),
  ].join("|");

  return createHash("sha256").update(raw).digest("hex");
}

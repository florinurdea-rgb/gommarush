import type { DocumentStatus, ProcessedDocument } from "@/lib/ddt-import/pipeline";
import type { CustomerMatchResult } from "@/lib/logistics/customer-matching";

/**
 * Client-safe helpers shared by every UI that confirms DDT-import documents
 * (the standalone /admin/orders/import page and the "Comandă nouă" modal's
 * upload step). No "server-only" import here on purpose — this is imported
 * from client components, and pipeline.ts / customer-matching.ts are both
 * already plain, framework-free logic.
 */

export interface ProcessedDocumentWithMatch extends ProcessedDocument {
  supplierId: string | null;
  customerMatch: CustomerMatchResult | null;
}

export const DDT_STATUS_LABEL: Record<DocumentStatus, string> = {
  READY: "PREGĂTIT",
  READY_MISSING_OPTIONAL: "PREGĂTIT — date opționale lipsă",
  NEEDS_REVIEW: "NECESITĂ VERIFICARE",
  POSSIBLE_DUPLICATE: "POSIBIL DUPLICAT",
  DUPLICATE: "DEJA IMPORTAT",
};

export const DDT_STATUS_TONE: Record<DocumentStatus, string> = {
  READY: "bg-state-success-soft text-state-success",
  READY_MISSING_OPTIONAL: "bg-state-progress-soft text-state-progress",
  NEEDS_REVIEW: "bg-state-warning-soft text-state-warning",
  POSSIBLE_DUPLICATE: "bg-state-warning-soft text-state-warning",
  DUPLICATE: "bg-state-neutral-soft text-state-neutral",
};

export interface CustomerResolutionPayload {
  customerId: string | null;
  customerLocationId: string | null;
  newCustomer: { name: string; vat_number: string | null } | null;
  resolution: "use_existing" | "add_as_new_location";
  supplierCustomerCode: string | null;
}

/**
 * Builds the confirm payload's customer decision — only for the two
 * unambiguous match kinds. `possible_match` / `new_location` are
 * deliberately left unresolved: those need a human decision this
 * quick-confirm flow doesn't offer, so the document just isn't
 * auto-confirmable until resolved elsewhere.
 */
export function buildCustomerResolution(doc: ProcessedDocumentWithMatch): CustomerResolutionPayload | null {
  const match = doc.customerMatch;
  if (!match) return null;

  if (match.kind === "match_confirmed" && match.customer) {
    return {
      customerId: match.customer.id,
      customerLocationId: match.location?.id ?? null,
      newCustomer: null,
      resolution: match.location ? "use_existing" : "add_as_new_location",
      supplierCustomerCode: doc.extracted.customer.supplierCustomerCode,
    };
  }

  if (match.kind === "new_customer" && doc.extracted.customer.companyName) {
    return {
      customerId: null,
      customerLocationId: null,
      newCustomer: { name: doc.extracted.customer.companyName, vat_number: doc.extracted.customer.vatNumber },
      resolution: "add_as_new_location",
      supplierCustomerCode: doc.extracted.customer.supplierCustomerCode,
    };
  }

  return null;
}

/**
 * A missing/uncertain field is informational, never a reason to refuse the
 * import outright — the admin sees exactly what's uncertain (doc.reasons)
 * and can fix it afterward from the order itself. The only thing that
 * actually blocks a direct confirm is `doc.blocked` (no supplier/customer
 * identity to resolve, or nothing importable — see pipeline.ts) plus, for
 * DUPLICATE/POSSIBLE_DUPLICATE, an explicit "Adaugă din nou" choice via
 * canForceConfirmDdtDocument instead of a silent auto-import.
 */
export function canAutoConfirmDdtDocument(doc: ProcessedDocumentWithMatch): boolean {
  return (
    doc.status !== "DUPLICATE" &&
    doc.status !== "POSSIBLE_DUPLICATE" &&
    !doc.blocked &&
    buildCustomerResolution(doc) !== null
  );
}

/**
 * A DUPLICATE/POSSIBLE_DUPLICATE flag is a signal for a human to double
 * check, never an automatic block: the server-side confirm route doesn't
 * gate on document status at all (only the database's own unique constraint
 * on supplier+document-number can actually stop a genuine duplicate insert)
 * — the checked/disabled state on these documents is a UI-only safety rail.
 * This says whether that rail can be deliberately lifted, via the "Adaugă
 * din nou" confirmation dialog, for a document that's otherwise resolvable.
 */
export function canForceConfirmDdtDocument(doc: ProcessedDocumentWithMatch): boolean {
  return (
    (doc.status === "DUPLICATE" || doc.status === "POSSIBLE_DUPLICATE") &&
    !doc.blocked &&
    buildCustomerResolution(doc) !== null
  );
}

// The commercial lifecycle of a GommaRush sales order.
//
//   requested ──► confirmed ──► pending_payment ──► (fulfilment, later)
//       │             │               │
//       ├──► rejected └──► cancelled ◄┘
//       └──► cancelled
//
// This is the COMMERCIAL lifecycle only. Confirming an order is GommaRush
// accepting it; it is NOT a supplier purchase, NOT a sourcing allocation and
// NOT a transport job (CLAUDE.md §2 — four concepts, four lifecycles).
// Supplier ordering stays disabled and nothing here can reach a supplier.
//
// The same table is enforced in the database by transition_sales_order
// (supabase/pending-approval/0008_sales_order_workflow.sql), with a
// compare-and-set on the current status, so two operators cannot both move
// one order. This module exists so the UI offers only legal moves and the
// route refuses illegal ones before any I/O.
//
// No deletion: a numbered GR order is a commercial record. Cancelling keeps it
// and says why; deleting would leave a gap in the numbering nobody can explain.
// Whether a delete is ever allowed is an owner decision, not built here.
//
// Pure: no database, no I/O. Client-safe.

export const SALES_ORDER_STATUSES = [
  "requested",
  "confirmed",
  "pending_payment",
  "rejected",
  "cancelled",
] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export function isSalesOrderStatus(value: unknown): value is SalesOrderStatus {
  return typeof value === "string" && (SALES_ORDER_STATUSES as readonly string[]).includes(value);
}

/** Every legal move. Anything absent is refused. */
export const SALES_ORDER_TRANSITIONS: Readonly<Record<SalesOrderStatus, readonly SalesOrderStatus[]>> = {
  requested: ["confirmed", "rejected", "cancelled"],
  confirmed: ["pending_payment", "cancelled"],
  pending_payment: ["cancelled"],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: unknown, to: unknown): boolean {
  return isSalesOrderStatus(from) && isSalesOrderStatus(to) && SALES_ORDER_TRANSITIONS[from].includes(to);
}

/** Refusing or withdrawing an order must say why — for the record and for the customer call. */
export function transitionRequiresNote(to: SalesOrderStatus): boolean {
  return to === "rejected" || to === "cancelled";
}

export const NOTE_MAX_LENGTH = 1000;

/** Operator-facing status names (Italian source; passed through `tr()`). */
export const ADMIN_STATUS_LABELS: Readonly<Record<SalesOrderStatus, string>> = {
  requested: "Da rivedere",
  confirmed: "Confermato",
  pending_payment: "In attesa di pagamento",
  rejected: "Rifiutato",
  cancelled: "Annullato",
};

/** The button that performs each move. */
export const TRANSITION_ACTION_LABELS: Readonly<Record<SalesOrderStatus, string>> = {
  requested: "",
  confirmed: "Conferma ordine",
  pending_payment: "Segna in attesa di pagamento",
  rejected: "Rifiuta ordine",
  cancelled: "Annulla ordine",
};

/** The V1 payment methods, as the checkout names them. */
export const PAYMENT_METHOD_LABELS: Readonly<Record<string, string>> = {
  bank_transfer: "Bonifico bancario",
  cash_on_delivery: "Contanti alla consegna",
};

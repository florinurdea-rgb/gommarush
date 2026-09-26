import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logEvent } from "@/lib/logger";
import {
  canTransition,
  isSalesOrderStatus,
  NOTE_MAX_LENGTH,
  transitionRequiresNote,
  type SalesOrderStatus,
} from "@/lib/commerce/sales-order-status";

/**
 * Operator actions on a GommaRush sales order: the commercial lifecycle only.
 *
 * Every status change goes through `transition_sales_order` (migration 0008),
 * never a direct UPDATE: the function re-checks the move, compare-and-sets on
 * the status the operator was looking at, and writes the history row in the
 * same transaction. This module validates first so an illegal move is refused
 * before any I/O, and maps the function's errors to stable codes.
 *
 * Nothing here can place, stage or signal a supplier purchase.
 */

export type TransitionRefusal =
  | "VALIDATION_FAILED"
  | "TRANSITION_NOT_ALLOWED"
  | "NOTE_REQUIRED"
  | "STATUS_CONFLICT"
  | "WORKFLOW_NOT_ACTIVATED";

export class TransitionError extends Error {
  constructor(readonly code: TransitionRefusal, readonly status: number) {
    super(code);
  }
}

/**
 * True when the database answered "that function/column does not exist" —
 * i.e. 0008 has not been applied. PostgREST reports a missing function as
 * PGRST202; a missing column/table with the codes isMissingSchemaError knows.
 */
export function isWorkflowMissing(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  if (error.code === "42703" || error.code === "42P01" || error.code === "PGRST204" || error.code === "PGRST205") return true;
  return /transition_sales_order|sales_order_status_history|schema cache/i.test(error.message ?? "");
}

export async function transitionSalesOrder(input: {
  orderId: string;
  from: unknown;
  to: unknown;
  note: unknown;
  actorUserId: string;
  actorLabel: string;
}): Promise<{ orderId: string; status: SalesOrderStatus }> {
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (!isSalesOrderStatus(input.from) || !isSalesOrderStatus(input.to) || note.length > NOTE_MAX_LENGTH) {
    throw new TransitionError("VALIDATION_FAILED", 400);
  }
  if (!canTransition(input.from, input.to)) throw new TransitionError("TRANSITION_NOT_ALLOWED", 409);
  if (transitionRequiresNote(input.to) && note === "") throw new TransitionError("NOTE_REQUIRED", 400);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("transition_sales_order", {
    p_order_id: input.orderId,
    p_from: input.from,
    p_to: input.to,
    p_note: note || null,
    p_actor_user_id: input.actorUserId,
    p_actor_label: input.actorLabel,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("SALES_ORDER_STATUS_CONFLICT")) throw new TransitionError("STATUS_CONFLICT", 409);
    if (message.includes("SALES_ORDER_TRANSITION_NOT_ALLOWED")) throw new TransitionError("TRANSITION_NOT_ALLOWED", 409);
    if (message.includes("SALES_ORDER_NOTE_REQUIRED")) throw new TransitionError("NOTE_REQUIRED", 400);
    if (isWorkflowMissing(error)) throw new TransitionError("WORKFLOW_NOT_ACTIVATED", 503);
    throw error;
  }

  const row = (Array.isArray(data) ? data[0] : data) as { order_id?: string; new_status?: string } | null;
  logEvent("sales_order_status_changed", { orderId: input.orderId, from: input.from, to: input.to });
  return { orderId: row?.order_id ?? input.orderId, status: (row?.new_status as SalesOrderStatus) ?? input.to };
}

export interface SalesOrderHistoryEntry {
  id: string;
  from_status: string;
  to_status: string;
  note: string | null;
  actor_label: string | null;
  created_at: string;
}

/** Null when 0008 is not applied: "no history yet" and "cannot look" differ. */
export async function getSalesOrderHistory(orderId: string): Promise<SalesOrderHistoryEntry[] | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_order_status_history")
    .select("id,from_status,to_status,note,actor_label,created_at")
    .eq("sales_order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isWorkflowMissing(error)) return null;
    throw error;
  }
  return (data ?? []) as SalesOrderHistoryEntry[];
}

export type SalesOrderListFilter = SalesOrderStatus | "all";

/**
 * The operator's order list: one status (or all), optionally one GR number.
 * "Da rivedere" is oldest first — it is a queue; everything else newest first.
 */
export async function listSalesOrders(filter: { status: SalesOrderListFilter; orderNumber?: number | null }) {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("sales_orders")
    .select(
      "id,order_number,status,customer_id,customer_snapshot,grand_total_cents,currency,fulfilment_class,payment_method,requested_at"
    )
    .order("requested_at", { ascending: filter.status === "requested" })
    .limit(200);
  if (filter.status !== "all") query = query.eq("status", filter.status);
  if (filter.orderNumber) query = query.eq("order_number", filter.orderNumber);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

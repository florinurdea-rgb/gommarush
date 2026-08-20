import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError, logEvent } from "@/lib/logger";
import type { OrderStatus } from "@/lib/types/logistics";

/**
 * Driver-facing order operations — Phase 1 (order-level, no tyre scanning).
 *
 * GommaRush Phase 1 stabilisation deliberately removed individual-tyre
 * scanning from the active workflow: a driver loads and delivers a
 * customer's whole ORDER in one tap, not one tyre at a time. The driver
 * identity always comes from the server-side session, never the request
 * body — that is what makes "Driver A cannot touch Driver B's route"
 * real rather than dependent on the phone being honest.
 */

export interface DriverOrderSummary {
  id: string;
  order_number: number;
  status: OrderStatus;
  stand_code: string | null;
  customer_name: string | null;
  customer_city: string | null;
  customer_address: string | null;
  customer_phone: string | null;
  planned_delivery_date: string | null;
  delivery_sequence: number | null;
  vehicle_id: string | null;
  vehicle_name: string | null;
  tyre_count: number;
  delivery_notes: string | null;
  cash_on_delivery: boolean;
  amount_to_collect: number | null;
  payment_method: string | null;
  payment_status: string | null;
  amount_collected: number | null;
  delivery_failure_reason: string | null;
  items: { id: string; description: string; quantity: number }[];
}

const DRIVER_ORDER_SELECT = `
  id, order_number, status, stand_code, planned_delivery_date, delivery_sequence,
  vehicle_id, delivery_notes, cash_on_delivery, amount_to_collect, payment_method,
  payment_status, amount_collected, delivery_failure_reason,
  customers ( name ),
  customer_locations ( city, address_line1, phone ),
  vehicles ( name ),
  order_items ( id, description, raw_description, quantity, is_physical, line_number )
`;

interface RawDriverOrder {
  id: string;
  order_number: number;
  status: OrderStatus;
  stand_code: string | null;
  planned_delivery_date: string | null;
  delivery_sequence: number | null;
  vehicle_id: string | null;
  delivery_notes: string | null;
  cash_on_delivery: boolean;
  amount_to_collect: number | null;
  payment_method: string | null;
  payment_status: string | null;
  amount_collected: number | null;
  delivery_failure_reason: string | null;
  customers: { name: string } | null;
  customer_locations: { city: string | null; address_line1: string | null; phone: string | null } | null;
  vehicles: { name: string } | null;
  order_items: {
    id: string;
    description: string | null;
    raw_description: string | null;
    quantity: number;
    is_physical: boolean;
    line_number: number | null;
  }[];
}

/** Statuses a driver can still act on today — anything not yet closed out. */
const DRIVER_ACTIVE_STATUSES: OrderStatus[] = [
  "stored",
  "ready_for_loading",
  "loaded",
  "out_for_delivery",
];

/**
 * Orders assigned to this driver — and only this driver. The filter is
 * applied in SQL, so a driver's phone never receives another driver's
 * deliveries in the first place. Ordered the same way the Livrări board
 * orders a van's column: manual delivery_sequence first, then planned date.
 */
export async function listDriverOrders(driverId: string): Promise<DriverOrderSummary[]> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("orders")
    .select(DRIVER_ORDER_SELECT)
    .eq("driver_id", driverId)
    .in("status", DRIVER_ACTIVE_STATUSES)
    .order("delivery_sequence", { ascending: true, nullsFirst: false })
    .order("planned_delivery_date", { ascending: true, nullsFirst: false });

  if (error) throw error;

  return ((data ?? []) as unknown as RawDriverOrder[]).map((raw) => ({
    id: raw.id,
    order_number: raw.order_number,
    status: raw.status,
    stand_code: raw.stand_code,
    customer_name: raw.customers?.name ?? null,
    customer_city: raw.customer_locations?.city ?? null,
    customer_address: raw.customer_locations?.address_line1 ?? null,
    customer_phone: raw.customer_locations?.phone ?? null,
    planned_delivery_date: raw.planned_delivery_date,
    delivery_sequence: raw.delivery_sequence,
    vehicle_id: raw.vehicle_id,
    vehicle_name: raw.vehicles?.name ?? null,
    delivery_notes: raw.delivery_notes,
    cash_on_delivery: raw.cash_on_delivery,
    amount_to_collect: raw.amount_to_collect,
    payment_method: raw.payment_method,
    payment_status: raw.payment_status,
    amount_collected: raw.amount_collected,
    delivery_failure_reason: raw.delivery_failure_reason,
    // SUM(order line quantities) for physical lines — never a per-unit
    // scan count. See the Phase 1 stabilisation brief §23.
    tyre_count: raw.order_items
      .filter((item) => item.is_physical)
      .reduce((sum, item) => sum + item.quantity, 0),
    items: [...raw.order_items]
      .filter((item) => item.is_physical)
      .sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0))
      .map((item) => ({
        id: item.id,
        description: item.description ?? item.raw_description ?? "—",
        quantity: item.quantity,
      })),
  }));
}

/** "TODAY": aggregate summary across a driver's whole run. */
export function summariseDriverDay(orders: readonly DriverOrderSummary[]): {
  orderCount: number;
  tyreCount: number;
  codTotal: number;
  deliveredCount: number;
  remainingCount: number;
} {
  const orderCount = orders.length;
  const tyreCount = orders.reduce((sum, order) => sum + order.tyre_count, 0);
  const codTotal = orders.reduce(
    (sum, order) => sum + (order.cash_on_delivery ? (order.amount_to_collect ?? 0) : 0),
    0
  );
  const deliveredCount = orders.filter((order) => order.status === "delivered").length;
  return { orderCount, tyreCount, codTotal, deliveredCount, remainingCount: orderCount - deliveredCount };
}

export interface DispatchActionResult {
  ok: boolean;
  code: string;
  status?: string;
}

/**
 * "MARK AS LOADED" — one tap per order. Idempotent (a double tap or a
 * retried request returns the existing successful state rather than
 * erroring or double-recording), transactional (gorush_mark_order_loaded
 * is a single Postgres function call), and never touches inventory_units.
 */
export async function markOrderLoaded(input: {
  orderId: string;
  vehicleId?: string | null;
  operator?: string | null;
}): Promise<DispatchActionResult> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc("gorush_mark_order_loaded", {
    p_order_id: input.orderId,
    p_vehicle_id: input.vehicleId ?? null,
    p_operator: input.operator ?? null,
  });

  if (error) {
    logError("mark_order_loaded_failed", error, { orderId: input.orderId });
    throw error;
  }

  const result = data as { ok: boolean; code: string; status?: string };
  logEvent("order_marked_loaded", { orderId: input.orderId, code: result.code, ok: result.ok });
  return result;
}

export interface DeliverOrderResult extends DispatchActionResult {
  deliveredAt?: string;
}

/**
 * "MARK DELIVERED" — one tap per order, with optional COD collection
 * recorded in the same call. `driverId: null` means an admin/warehouse
 * initiated delivery from the Livrări board, exempt from the
 * wrong-driver check by design (see the RPC comment); a real driver id
 * (from the driver app) is always enforced server-side.
 */
export async function deliverOrder(input: {
  orderId: string;
  driverId: string | null;
  operator?: string | null;
  amountCollected?: number | null;
  paymentMethod?: string | null;
}): Promise<DeliverOrderResult> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc("gorush_deliver_order", {
    p_order_id: input.orderId,
    p_driver_id: input.driverId,
    p_operator: input.operator ?? null,
    p_amount_collected: input.amountCollected ?? null,
    p_payment_method: input.paymentMethod ?? null,
  });

  if (error) {
    logError("deliver_order_failed", error, { orderId: input.orderId });
    throw error;
  }

  const result = data as { ok: boolean; code: string; status?: string; delivered_at?: string };
  logEvent("order_delivered", { orderId: input.orderId, code: result.code, ok: result.ok });
  return { ok: result.ok, code: result.code, status: result.status, deliveredAt: result.delivered_at };
}

/**
 * "DELIVERY FAILED" — the delivery exception path. A reason is mandatory;
 * the order returns to an explicit attention state (on_hold) rather than
 * inventing a new status, and can be reactivated like any other hold.
 */
export async function markDeliveryFailed(input: {
  orderId: string;
  driverId: string | null;
  operator?: string | null;
  reason: string;
}): Promise<DispatchActionResult> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc("gorush_mark_delivery_failed", {
    p_order_id: input.orderId,
    p_driver_id: input.driverId,
    p_operator: input.operator ?? null,
    p_reason: input.reason,
  });

  if (error) {
    logError("mark_delivery_failed_failed", error, { orderId: input.orderId });
    throw error;
  }

  const result = data as { ok: boolean; code: string; status?: string };
  logEvent("order_delivery_failed", { orderId: input.orderId, code: result.code, ok: result.ok });
  return result;
}

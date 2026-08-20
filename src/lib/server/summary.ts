import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { PROFIT_PER_DELIVERED_TYRE_EUR } from "@/lib/logistics/summary-constants";
import { listActiveOrders } from "@/lib/server/orders";
import { operationalStatus } from "@/lib/logistics/operational-status";
import { isMissingSchemaError } from "@/lib/server/schema-errors";
import { logError } from "@/lib/logger";

/**
 * "Sumar" — the period-scoped operational summary. Everything here is
 * grounded in a real, already-tracked timestamp rather than an order's
 * "current" state, so changing the period recomputes cleanly and nothing
 * gets counted twice or missed:
 *
 *   - "Comenzi"   -> orders CREATED in the period (excludes cancelled)
 *   - "Ridicări"  -> orders RECEIVED at the warehouse in the period
 *                    (orders.received_at) — one row per actual pickup
 *                    event, not per tyre or per line item
 *   - "Livrări"   -> orders DELIVERED in the period (orders.delivered_at,
 *                    the order-level Phase 1 delivery confirmation — see
 *                    gorush_deliver_order), with tyre count as
 *                    SUM(order_items.quantity) for physical lines. Phase 1
 *                    stabilisation §23: this is deliberately ORDER-level,
 *                    not unit-level — inventory_units is no longer written
 *                    by the active delivery flow, so a query grounded in
 *                    it would silently show zero deliveries.
 *
 * One shared query set per period, reused by every KPI/breakdown/insight
 * on the page — never a separate fetch per card (see the brief's
 * performance section).
 */

export interface SupplierPickupRow {
  supplierId: string;
  supplierName: string;
  pickups: number;
  tyres: number;
}

export interface DeliveryRow {
  orderId: string;
  orderNumber: number;
  deliveredAt: string;
  customerName: string | null;
  supplierName: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
  tyreCount: number;
  status: string;
}

export interface VehicleSummaryRow {
  vehicleId: string;
  vehicleName: string;
  colorKey: string | null;
  orders: number;
  tyres: number;
  profit: number;
}

export interface OperationalSummary {
  period: { start: string; end: string };
  orderCount: number;
  pickupCount: number;
  deliveredTyreCount: number;
  profit: number;
  supplierPickups: SupplierPickupRow[];
  deliveries: DeliveryRow[];
  vehicles: VehicleSummaryRow[];
  /** Live snapshot, independent of the period: orders currently waiting for goods to arrive. */
  waitingGoodsCount: number;
  /** Live snapshot: orders flagged on_hold with a delivery_failure_reason ("needs attention"). */
  deliveryFailedCount: number;
  /** Live snapshot: active orders with no vehicle assigned yet. */
  unassignedCount: number;
  codExpected: number;
  codCollected: number;
}

function endOfDayIso(dateIso: string): string {
  return `${dateIso}T23:59:59.999`;
}

const ORDERS_DELIVERED_SELECT =
  "id, order_number, status, delivered_at, customer_id, supplier_id, vehicle_id, amount_to_collect, amount_collected, cash_on_delivery, customers ( name ), suppliers ( name ), vehicles ( name, color_key ), order_items ( quantity, is_physical )";
const ORDERS_DELIVERED_SELECT_LEGACY =
  "id, order_number, status, delivered_at, customer_id, supplier_id, vehicle_id, amount_to_collect, amount_collected, cash_on_delivery, customers ( name ), suppliers ( name ), vehicles ( name ), order_items ( quantity, is_physical )";

/** Falls back to a select without vehicles.color_key if the fleet-management migration hasn't run yet — Sumar just can't tint its vehicle tabs until it does. */
async function queryDeliveredOrders(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rangeStart: string,
  rangeEnd: string
) {
  const primary = await supabase
    .from("orders")
    .select(ORDERS_DELIVERED_SELECT)
    .not("delivered_at", "is", null)
    .gte("delivered_at", rangeStart)
    .lte("delivered_at", rangeEnd);

  if (isMissingSchemaError(primary.error)) {
    logError("vehicles_color_key_column_missing_summary", primary.error);
    return supabase
      .from("orders")
      .select(ORDERS_DELIVERED_SELECT_LEGACY)
      .not("delivered_at", "is", null)
      .gte("delivered_at", rangeStart)
      .lte("delivered_at", rangeEnd);
  }

  return primary;
}

export async function getOperationalSummary(startDate: string, endDate: string): Promise<OperationalSummary> {
  const supabase = createSupabaseAdminClient();
  const rangeStart = `${startDate}T00:00:00`;
  const rangeEnd = endOfDayIso(endDate);

  const [ordersCreatedResult, ordersReceivedResult, deliveredOrdersResult, activeOrders] = await Promise.all([
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .neq("status", "cancelled")
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd),
    supabase
      .from("orders")
      .select("id, supplier_id, suppliers ( name )")
      .neq("status", "cancelled")
      .not("received_at", "is", null)
      .gte("received_at", rangeStart)
      .lte("received_at", rangeEnd),
    queryDeliveredOrders(supabase, rangeStart, rangeEnd),
    listActiveOrders(),
  ]);

  if (ordersCreatedResult.error) throw ordersCreatedResult.error;
  if (ordersReceivedResult.error) throw ordersReceivedResult.error;
  if (deliveredOrdersResult.error) throw deliveredOrdersResult.error;

  // Pickups: one row per received order, tyre quantity from a second pass
  // over inventory_units (unit_type='tyre', any status — a pickup counts
  // what physically arrived, not what's since been delivered).
  const receivedOrders = (ordersReceivedResult.data ?? []) as unknown as {
    id: string;
    supplier_id: string | null;
    suppliers: { name: string } | null;
  }[];

  let pickupTyresByOrder = new Map<string, number>();
  if (receivedOrders.length > 0) {
    const { data: pickupUnits, error: pickupUnitsError } = await supabase
      .from("inventory_units")
      .select("order_id")
      .eq("unit_type", "tyre")
      .in(
        "order_id",
        receivedOrders.map((o) => o.id)
      );
    if (pickupUnitsError) throw pickupUnitsError;
    pickupTyresByOrder = new Map();
    for (const row of (pickupUnits ?? []) as { order_id: string }[]) {
      pickupTyresByOrder.set(row.order_id, (pickupTyresByOrder.get(row.order_id) ?? 0) + 1);
    }
  }

  const supplierAgg = new Map<string, SupplierPickupRow>();
  for (const order of receivedOrders) {
    const supplierId = order.supplier_id ?? "unknown";
    const supplierName = order.suppliers?.name ?? "Furnizor necunoscut";
    const existing = supplierAgg.get(supplierId) ?? { supplierId, supplierName, pickups: 0, tyres: 0 };
    existing.pickups += 1;
    existing.tyres += pickupTyresByOrder.get(order.id) ?? 0;
    supplierAgg.set(supplierId, existing);
  }
  const supplierPickups = [...supplierAgg.values()].sort((a, b) => b.pickups - a.pickups);

  // Deliveries: one row per DELIVERED ORDER (orders.delivered_at — the
  // order-level Phase 1 confirmation), tyre count as SUM(order_items.
  // quantity) for physical lines. See gorush_deliver_order: Phase 1 never
  // does a "partial" delivery — either the whole order is confirmed
  // delivered, or it isn't — so there is exactly one qualifying quantity
  // per order, not a unit-by-unit accumulation.
  type RawDeliveredOrder = {
    id: string;
    order_number: number;
    status: string;
    delivered_at: string;
    customer_id: string | null;
    supplier_id: string | null;
    vehicle_id: string | null;
    amount_to_collect: number | null;
    amount_collected: number | null;
    cash_on_delivery: boolean | null;
    customers: { name: string } | null;
    suppliers: { name: string } | null;
    vehicles: { name: string; color_key?: string | null } | null;
    order_items: { quantity: number; is_physical: boolean }[];
  };
  const deliveredOrders = (deliveredOrdersResult.data ?? []) as unknown as RawDeliveredOrder[];

  const vehicleColorById = new Map<string, string | null>();
  const deliveries: DeliveryRow[] = deliveredOrders
    .map((order) => {
      if (order.vehicle_id) vehicleColorById.set(order.vehicle_id, order.vehicles?.color_key ?? null);
      const tyreCount = order.order_items
        .filter((item) => item.is_physical)
        .reduce((sum, item) => sum + item.quantity, 0);
      return {
        orderId: order.id,
        orderNumber: order.order_number,
        deliveredAt: order.delivered_at,
        customerName: order.customers?.name ?? null,
        supplierName: order.suppliers?.name ?? null,
        vehicleId: order.vehicle_id,
        vehicleName: order.vehicles?.name ?? null,
        tyreCount,
        status: order.status,
      };
    })
    .sort((a, b) => (a.deliveredAt < b.deliveredAt ? 1 : -1));

  const deliveredTyreCount = deliveries.reduce((sum, delivery) => sum + delivery.tyreCount, 0);
  const profit = deliveredTyreCount * PROFIT_PER_DELIVERED_TYRE_EUR;

  const vehicleAgg = new Map<string, VehicleSummaryRow>();
  for (const delivery of deliveries) {
    if (!delivery.vehicleId) continue;
    const existing = vehicleAgg.get(delivery.vehicleId) ?? {
      vehicleId: delivery.vehicleId,
      vehicleName: delivery.vehicleName ?? "—",
      colorKey: vehicleColorById.get(delivery.vehicleId) ?? null,
      orders: 0,
      tyres: 0,
      profit: 0,
    };
    existing.orders += 1;
    existing.tyres += delivery.tyreCount;
    existing.profit = existing.tyres * PROFIT_PER_DELIVERED_TYRE_EUR;
    vehicleAgg.set(delivery.vehicleId, existing);
  }
  const vehicles = [...vehicleAgg.values()].sort((a, b) => b.tyres - a.tyres);

  // COD (§20): expected vs. collected across orders delivered in this
  // period — the same "Mario / Expected €1,860 / Collected €1,860 /
  // Difference €0" reconciliation the brief asks for, at the whole-period
  // level (per-driver breakdown is a UI concern, not a query one).
  const codOrders = deliveredOrders.filter((order) => order.cash_on_delivery);
  const codExpected = codOrders.reduce((sum, order) => sum + (order.amount_to_collect ?? 0), 0);
  const codCollected = codOrders.reduce((sum, order) => sum + (order.amount_collected ?? 0), 0);

  const waitingGoodsCount = activeOrders.filter(
    (order) => operationalStatus(order.status, order.progress.problem > 0).bucket === "waiting_goods"
  ).length;
  const unassignedCount = activeOrders.filter(
    (order) => !order.vehicle_id && operationalStatus(order.status, false).bucket !== "waiting_goods"
  ).length;

  // "Needs attention": orders currently on_hold specifically because of a
  // failed delivery attempt (gorush_mark_delivery_failed), not every
  // on_hold reason — a live snapshot, independent of the selected period.
  const { count: deliveryFailedCountRaw, error: deliveryFailedError } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "on_hold")
    .not("delivery_failure_reason", "is", null);
  if (deliveryFailedError && !isMissingSchemaError(deliveryFailedError)) throw deliveryFailedError;
  const deliveryFailedCount = deliveryFailedCountRaw ?? 0;

  return {
    period: { start: startDate, end: endDate },
    orderCount: ordersCreatedResult.count ?? 0,
    pickupCount: receivedOrders.length,
    deliveredTyreCount,
    profit,
    supplierPickups,
    deliveries,
    vehicles,
    waitingGoodsCount,
    deliveryFailedCount,
    unassignedCount,
    codExpected,
    codCollected,
  };
}

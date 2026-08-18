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
 *   - "Livrări"   -> individual tyre UNITS marked delivered in the period
 *                    (inventory_units.delivered_at) — unit-granular so a
 *                    partially-delivered order only counts what actually
 *                    went out, never the order's full tyre count
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
}

function endOfDayIso(dateIso: string): string {
  return `${dateIso}T23:59:59.999`;
}

const UNITS_DELIVERED_SELECT =
  "id, order_id, delivered_at, orders!inner ( order_number, status, customer_id, supplier_id, vehicle_id, customers ( name ), suppliers ( name ), vehicles ( name, color_key ) )";
const UNITS_DELIVERED_SELECT_LEGACY =
  "id, order_id, delivered_at, orders!inner ( order_number, status, customer_id, supplier_id, vehicle_id, customers ( name ), suppliers ( name ), vehicles ( name ) )";

/** Falls back to a select without vehicles.color_key if the fleet-management migration hasn't run yet — Sumar just can't tint its vehicle tabs until it does. */
async function queryDeliveredUnits(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rangeStart: string,
  rangeEnd: string
) {
  const primary = await supabase
    .from("inventory_units")
    .select(UNITS_DELIVERED_SELECT)
    .eq("unit_type", "tyre")
    .eq("status", "delivered")
    .not("delivered_at", "is", null)
    .gte("delivered_at", rangeStart)
    .lte("delivered_at", rangeEnd);

  if (isMissingSchemaError(primary.error)) {
    logError("vehicles_color_key_column_missing_summary", primary.error);
    return supabase
      .from("inventory_units")
      .select(UNITS_DELIVERED_SELECT_LEGACY)
      .eq("unit_type", "tyre")
      .eq("status", "delivered")
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

  const [ordersCreatedResult, ordersReceivedResult, unitsDeliveredResult, activeOrders] = await Promise.all([
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
    queryDeliveredUnits(supabase, rangeStart, rangeEnd),
    listActiveOrders(),
  ]);

  if (ordersCreatedResult.error) throw ordersCreatedResult.error;
  if (ordersReceivedResult.error) throw ordersReceivedResult.error;
  if (unitsDeliveredResult.error) throw unitsDeliveredResult.error;

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

  // Deliveries: one row per DELIVERED UNIT collapsed into one row per order
  // (the unit-level granularity already correctly excluded undelivered
  // tyres from the query — grouping by order here is just for display).
  type RawDeliveredUnit = {
    id: string;
    order_id: string;
    delivered_at: string;
    orders: {
      order_number: number;
      status: string;
      customer_id: string | null;
      supplier_id: string | null;
      vehicle_id: string | null;
      customers: { name: string } | null;
      suppliers: { name: string } | null;
      vehicles: { name: string; color_key?: string | null } | null;
    } | null;
  };
  const deliveredUnits = ((unitsDeliveredResult.data ?? []) as unknown as RawDeliveredUnit[]).filter(
    (unit) => unit.orders !== null
  );

  const deliveryByOrder = new Map<string, DeliveryRow>();
  const vehicleColorById = new Map<string, string | null>();
  for (const unit of deliveredUnits) {
    const order = unit.orders!;
    if (order.vehicle_id) vehicleColorById.set(order.vehicle_id, order.vehicles?.color_key ?? null);
    const existing = deliveryByOrder.get(unit.order_id);
    if (existing) {
      existing.tyreCount += 1;
      if (unit.delivered_at > existing.deliveredAt) existing.deliveredAt = unit.delivered_at;
    } else {
      deliveryByOrder.set(unit.order_id, {
        orderId: unit.order_id,
        orderNumber: order.order_number,
        deliveredAt: unit.delivered_at,
        customerName: order.customers?.name ?? null,
        supplierName: order.suppliers?.name ?? null,
        vehicleId: order.vehicle_id,
        vehicleName: order.vehicles?.name ?? null,
        tyreCount: 1,
        status: order.status,
      });
    }
  }
  const deliveries = [...deliveryByOrder.values()].sort((a, b) => (a.deliveredAt < b.deliveredAt ? 1 : -1));

  const deliveredTyreCount = deliveredUnits.length;
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

  const waitingGoodsCount = activeOrders.filter(
    (order) => operationalStatus(order.status, order.progress.problem > 0).bucket === "waiting_goods"
  ).length;

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
  };
}

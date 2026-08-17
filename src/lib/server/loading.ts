import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError, logEvent } from "@/lib/logger";
import { calculateOrderProgress } from "@/lib/logistics/order-progress";
import type { OrderProgress } from "@/lib/logistics/order-progress";
import type {
  InventoryUnitStatus,
  ItemType,
  OrderStatus,
  StandCode,
} from "@/lib/types/logistics";

/**
 * Van loading operations for the driver interface.
 *
 * The driver identity always comes from the server-side session, never from the
 * request body — that is what makes the wrong-item protection real rather than
 * dependent on the phone being honest.
 */

export interface DriverOrderSummary {
  id: string;
  order_number: number;
  status: OrderStatus;
  stand_code: StandCode | null;
  customer_name: string | null;
  customer_city: string | null;
  planned_delivery_date: string | null;
  vehicle_name: string | null;
  progress: OrderProgress;
  items: {
    id: string;
    description: string;
    item_type: ItemType;
    quantity: number;
    units: { id: string; unit_sequence: number; status: InventoryUnitStatus }[];
  }[];
}

const DRIVER_ORDER_SELECT = `
  id, order_number, status, stand_code, planned_delivery_date,
  customers ( name ),
  customer_locations ( city ),
  vehicles ( name ),
  order_items ( id, description, raw_description, item_type, quantity, is_physical, line_number ),
  inventory_units ( id, order_item_id, unit_sequence, status )
`;

interface RawDriverOrder {
  id: string;
  order_number: number;
  status: OrderStatus;
  stand_code: StandCode | null;
  planned_delivery_date: string | null;
  customers: { name: string } | null;
  customer_locations: { city: string | null } | null;
  vehicles: { name: string } | null;
  order_items: {
    id: string;
    description: string | null;
    raw_description: string | null;
    item_type: ItemType;
    quantity: number;
    is_physical: boolean;
    line_number: number | null;
  }[];
  inventory_units: {
    id: string;
    order_item_id: string;
    unit_sequence: number;
    status: InventoryUnitStatus;
  }[];
}

/**
 * Orders assigned to this driver — and only this driver. The filter is applied
 * in SQL, so a driver's phone never receives another driver's deliveries in the
 * first place.
 */
export async function listDriverOrders(driverId: string): Promise<DriverOrderSummary[]> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("orders")
    .select(DRIVER_ORDER_SELECT)
    .eq("driver_id", driverId)
    .in("status", [
      "confirmed",
      "expected",
      "partially_received",
      "received",
      "sorting",
      "stored",
      "ready_for_loading",
      "partially_loaded",
      "loaded",
    ])
    .order("planned_delivery_date", { ascending: true, nullsFirst: false })
    .order("stand_code", { ascending: true, nullsFirst: false });

  if (error) throw error;

  return ((data ?? []) as unknown as RawDriverOrder[]).map((raw) => {
    const unitsByItem = new Map<string, RawDriverOrder["inventory_units"]>();
    for (const unit of raw.inventory_units) {
      const list = unitsByItem.get(unit.order_item_id) ?? [];
      list.push(unit);
      unitsByItem.set(unit.order_item_id, list);
    }

    return {
      id: raw.id,
      order_number: raw.order_number,
      status: raw.status,
      stand_code: raw.stand_code,
      customer_name: raw.customers?.name ?? null,
      customer_city: raw.customer_locations?.city ?? null,
      planned_delivery_date: raw.planned_delivery_date,
      vehicle_name: raw.vehicles?.name ?? null,
      progress: calculateOrderProgress(raw.inventory_units),
      items: [...raw.order_items]
        .filter((item) => item.is_physical)
        .sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0))
        .map((item) => ({
          id: item.id,
          description: item.description ?? item.raw_description ?? "—",
          item_type: item.item_type,
          quantity: item.quantity,
          units: (unitsByItem.get(item.id) ?? []).sort((a, b) => a.unit_sequence - b.unit_sequence),
        })),
    };
  });
}

/** Aggregate loading progress across a driver's whole run, e.g. "12 / 18". */
export function summariseDriverProgress(orders: readonly DriverOrderSummary[]): {
  loaded: number;
  total: number;
  label: string;
} {
  const loaded = orders.reduce((sum, order) => sum + order.progress.loaded, 0);
  const total = orders.reduce((sum, order) => sum + order.progress.total, 0);
  return { loaded, total, label: `${loaded} / ${total}` };
}

export interface LoadScanResult {
  ok: boolean;
  code: string;
  inventoryUnitId?: string;
  unitToken?: string;
  status?: string;
  orderId?: string;
  orderNumber?: number | string;
  customer?: string;
  description?: string | null;
  standCode?: StandCode | null;
}

/**
 * Loading scan. Verifies the unit exists, is currently `stored`, and belongs to
 * an order assigned to THIS driver/van before marking it loaded. A wrong-driver
 * scan is rejected and recorded, never loaded.
 */
export async function loadUnitByToken(input: {
  unitToken: string;
  driverId: string;
  vehicleId?: string | null;
  operator?: string | null;
  idempotencyKey?: string | null;
}): Promise<LoadScanResult> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc("gorush_load_unit", {
    p_unit_token: input.unitToken,
    p_driver_id: input.driverId,
    p_vehicle_id: input.vehicleId ?? null,
    p_operator: input.operator ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  if (error) {
    logError("load_unit_failed", error, { driverId: input.driverId });
    throw error;
  }

  const result = data as {
    ok: boolean;
    code: string;
    inventory_unit_id?: string;
    unit_token?: string;
    status?: string;
    order_id?: string;
    order_number?: number | string;
    customer?: string;
    description?: string | null;
    stand_code?: StandCode | null;
  };

  logEvent("unit_loading_scan", {
    code: result.code,
    ok: result.ok,
    driverId: input.driverId,
  });

  return {
    ok: result.ok,
    code: result.code,
    inventoryUnitId: result.inventory_unit_id,
    unitToken: result.unit_token,
    status: result.status,
    orderId: result.order_id,
    orderNumber: result.order_number,
    customer: result.customer,
    description: result.description,
    standCode: result.stand_code ?? null,
  };
}

/**
 * Manual loading override — for a damaged label or a dead scanner only.
 *
 * A reason is mandatory, and the resulting scan is recorded as
 * `manual_loading` with `manual = true`, so it can never be mistaken
 * for a real barcode scan in the audit trail.
 */
export async function manualLoadUnit(input: {
  inventoryUnitId: string;
  driverId: string;
  vehicleId?: string | null;
  reason: string;
  operator?: string | null;
}): Promise<LoadScanResult> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc("gorush_manual_load_unit", {
    p_inventory_unit_id: input.inventoryUnitId,
    p_driver_id: input.driverId,
    p_vehicle_id: input.vehicleId ?? null,
    p_reason: input.reason,
    p_operator: input.operator ?? null,
  });

  if (error) {
    logError("manual_load_failed", error, { driverId: input.driverId });
    throw error;
  }

  const result = data as {
    ok: boolean;
    code: string;
    inventory_unit_id?: string;
    status?: string;
    order_number?: number | string;
  };

  logEvent("unit_manual_load_override", {
    code: result.code,
    ok: result.ok,
    driverId: input.driverId,
    inventoryUnitId: input.inventoryUnitId,
  });

  return {
    ok: result.ok,
    code: result.code,
    inventoryUnitId: result.inventory_unit_id,
    status: result.status,
    orderNumber: result.order_number,
  };
}

/**
 * Last known location/event for a unit, from the scan history. Powers the
 * "LAST KNOWN: Van 3 / 14:11 / Loading scan" display.
 */
export async function getLastKnownEvent(inventoryUnitId: string): Promise<{
  scan_type: string;
  result: string;
  scanned_at: string;
  stand_code: StandCode | null;
  driver_name: string | null;
  vehicle_name: string | null;
  manual: boolean;
} | null> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("inventory_scans")
    .select("scan_type, result, scanned_at, stand_code, manual, drivers ( name ), vehicles ( name )")
    .eq("inventory_unit_id", inventoryUnitId)
    .order("scanned_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as {
    scan_type: string;
    result: string;
    scanned_at: string;
    stand_code: StandCode | null;
    manual: boolean;
    drivers: { name: string } | null;
    vehicles: { name: string } | null;
  };

  return {
    scan_type: row.scan_type,
    result: row.result,
    scanned_at: row.scanned_at,
    stand_code: row.stand_code,
    driver_name: row.drivers?.name ?? null,
    vehicle_name: row.vehicles?.name ?? null,
    manual: row.manual,
  };
}

/** Units on a driver's orders that are not yet loaded — the manual-override picker. */
export async function listLoadableUnits(driverId: string): Promise<
  {
    id: string;
    unit_sequence: number;
    status: InventoryUnitStatus;
    description: string | null;
    order_number: number;
    customer_name: string | null;
  }[]
> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("inventory_units")
    .select(
      "id, unit_sequence, status, description, orders!inner ( order_number, driver_id, status, customers ( name ) )"
    )
    .eq("orders.driver_id", driverId)
    .in("status", ["expected", "received", "stored"])
    .order("unit_sequence");

  if (error) throw error;

  return ((data ?? []) as unknown as {
    id: string;
    unit_sequence: number;
    status: InventoryUnitStatus;
    description: string | null;
    orders: { order_number: number; customers: { name: string } | null } | null;
  }[])
    .filter((row) => row.orders !== null)
    .map((row) => ({
      id: row.id,
      unit_sequence: row.unit_sequence,
      status: row.status,
      description: row.description,
      order_number: row.orders!.order_number,
      customer_name: row.orders!.customers?.name ?? null,
    }));
}

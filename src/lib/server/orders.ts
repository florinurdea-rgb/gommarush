import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { calculateOrderProgress, resolveReactivationStatus } from "@/lib/logistics/order-progress";
import { logError, logEvent } from "@/lib/logger";
import { isMissingSchemaError } from "@/lib/server/schema-errors";
import { ACTIVE_ORDER_STATUSES } from "@/lib/types/logistics";
import type {
  InventoryUnitRow,
  ItemType,
  OrderItemRow,
  OrderRow,
  OrderStatus,
  StandCode,
} from "@/lib/types/logistics";
import type { OrderProgress } from "@/lib/logistics/order-progress";

/**
 * Server-side order operations. All business rules live here or in
 * src/lib/logistics/* — never in a React component.
 *
 * Multi-write operations delegate to the Postgres RPCs so they are atomic; see
 * supabase/migrations/20260817000100_logistics_phase1_functions.sql.
 */

export interface OrderListRow {
  id: string;
  /** Numeric identity from the database; display via formatOrderNumber(). */
  order_number: number;
  stand_code: StandCode | null;
  status: OrderStatus;
  planned_delivery_date: string | null;
  customer_name: string | null;
  customer_city: string | null;
  customer_address: string | null;
  driver_id: string | null;
  driver_name: string | null;
  vehicle_id: string | null;
  vehicle_name: string | null;
  delivery_sequence: number | null;
  supplier_name: string | null;
  supplier_document_number: string | null;
  held_at: string | null;
  progress: OrderProgress;
  /** SUM of physical tyre units on this order — never trusted from AI, always counted from inventory_units. */
  tyre_count: number;
}

/**
 * One nested select for the whole dashboard. Two reasons this is a single query
 * rather than a join-per-column: PostgREST resolves the FK relationships for us,
 * and pulling unit statuses inline lets progress be derived in one pass instead
 * of N+1 round trips per order.
 */
const ORDER_LIST_SELECT = `
  id, order_number, stand_code, status, planned_delivery_date, held_at,
  supplier_document_number, driver_id, vehicle_id, delivery_sequence,
  customers ( name ),
  customer_locations ( city, address_line1 ),
  drivers ( name ),
  vehicles ( name ),
  suppliers ( name ),
  inventory_units ( status, unit_type )
`;

/**
 * Same as ORDER_LIST_SELECT, minus delivery_sequence — used as a fallback
 * when that column doesn't exist yet (the vehicle-board migration,
 * supabase/migrations/20260818000000_vehicle_board.sql, hasn't been run
 * against this database). Without this, every dashboard load throws and the
 * whole /admin page crashes instead of just the vehicle board losing manual
 * ordering — see the isMissingSchemaError() handling in listActiveOrders/listOrdersOnHold.
 */
const ORDER_LIST_SELECT_LEGACY = `
  id, order_number, stand_code, status, planned_delivery_date, held_at,
  supplier_document_number, driver_id, vehicle_id,
  customers ( name ),
  customer_locations ( city, address_line1 ),
  drivers ( name ),
  vehicles ( name ),
  suppliers ( name ),
  inventory_units ( status, unit_type )
`;

interface RawOrderListRow {
  id: string;
  order_number: number;
  stand_code: StandCode | null;
  status: OrderStatus;
  planned_delivery_date: string | null;
  held_at: string | null;
  supplier_document_number: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  delivery_sequence: number | null;
  customers: { name: string } | null;
  customer_locations: { city: string | null; address_line1: string | null } | null;
  drivers: { name: string } | null;
  vehicles: { name: string } | null;
  suppliers: { name: string } | null;
  inventory_units: { status: InventoryUnitRow["status"]; unit_type: string | null }[] | null;
}

function toListRow(raw: RawOrderListRow): OrderListRow {
  return {
    id: raw.id,
    order_number: raw.order_number,
    stand_code: raw.stand_code,
    status: raw.status,
    planned_delivery_date: raw.planned_delivery_date,
    customer_name: raw.customers?.name ?? null,
    customer_city: raw.customer_locations?.city ?? null,
    customer_address: raw.customer_locations?.address_line1 ?? null,
    driver_id: raw.driver_id,
    driver_name: raw.drivers?.name ?? null,
    vehicle_id: raw.vehicle_id,
    vehicle_name: raw.vehicles?.name ?? null,
    // ?? null (not a plain pass-through): with ORDER_LIST_SELECT_LEGACY the
    // key is absent entirely (undefined), not present-and-null.
    delivery_sequence: raw.delivery_sequence ?? null,
    supplier_name: raw.suppliers?.name ?? null,
    supplier_document_number: raw.supplier_document_number,
    held_at: raw.held_at,
    progress: calculateOrderProgress(raw.inventory_units ?? []),
    tyre_count: (raw.inventory_units ?? []).filter((unit) => unit.unit_type === "tyre").length,
  };
}

/**
 * Active orders for the "Comenzi în curs" dashboard. Excludes hold/cancelled.
 *
 * Sort is "ordinea livrării": delivery_sequence first (the Admin's manual
 * per-vehicle ordering, once set — see reorderVehicleColumn below), then
 * planned_delivery_date, then creation order as the final tiebreaker for
 * orders that have never been manually reordered.
 */
export async function listActiveOrders(): Promise<OrderListRow[]> {
  const supabase = createSupabaseAdminClient();
  const primary = await supabase
    .from("orders")
    .select(ORDER_LIST_SELECT)
    .in("status", ACTIVE_ORDER_STATUSES as unknown as string[])
    .order("delivery_sequence", { ascending: true, nullsFirst: false })
    .order("planned_delivery_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (isMissingSchemaError(primary.error)) {
    logError("orders_delivery_sequence_column_missing", primary.error);
    const fallback = await supabase
      .from("orders")
      .select(ORDER_LIST_SELECT_LEGACY)
      .in("status", ACTIVE_ORDER_STATUSES as unknown as string[])
      .order("planned_delivery_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (fallback.error) throw fallback.error;
    return ((fallback.data ?? []) as unknown as RawOrderListRow[]).map(toListRow);
  }

  if (primary.error) throw primary.error;
  return ((primary.data ?? []) as unknown as RawOrderListRow[]).map(toListRow);
}

/** Orders parked in "În așteptare". */
export async function listOrdersOnHold(): Promise<OrderListRow[]> {
  const supabase = createSupabaseAdminClient();
  const primary = await supabase
    .from("orders")
    .select(ORDER_LIST_SELECT)
    .eq("status", "on_hold")
    .order("held_at", { ascending: false });

  if (isMissingSchemaError(primary.error)) {
    logError("orders_delivery_sequence_column_missing", primary.error);
    const fallback = await supabase
      .from("orders")
      .select(ORDER_LIST_SELECT_LEGACY)
      .eq("status", "on_hold")
      .order("held_at", { ascending: false });
    if (fallback.error) throw fallback.error;
    return ((fallback.data ?? []) as unknown as RawOrderListRow[]).map(toListRow);
  }

  if (primary.error) throw primary.error;
  return ((primary.data ?? []) as unknown as RawOrderListRow[]).map(toListRow);
}

/**
 * "De pregătit" — orders whose tyres are physically at the warehouse
 * (received) but not yet labeled/loaded: sorting, stored, or already
 * marked ready but not fully loaded. This is the repurposed former
 * "hold" tab — actual on-hold orders (status = on_hold) now surface
 * through Livrări's "Așteaptă marfa" filter instead of a dedicated page.
 */
const TO_PREPARE_STATUSES = ["sorting", "stored", "ready_for_loading", "partially_loaded"] as const;

export async function listOrdersToPrepare(): Promise<OrderListRow[]> {
  const supabase = createSupabaseAdminClient();
  const primary = await supabase
    .from("orders")
    .select(ORDER_LIST_SELECT)
    .in("status", TO_PREPARE_STATUSES as unknown as string[])
    .order("planned_delivery_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (isMissingSchemaError(primary.error)) {
    logError("orders_delivery_sequence_column_missing", primary.error);
    const fallback = await supabase
      .from("orders")
      .select(ORDER_LIST_SELECT_LEGACY)
      .in("status", TO_PREPARE_STATUSES as unknown as string[])
      .order("planned_delivery_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (fallback.error) throw fallback.error;
    return ((fallback.data ?? []) as unknown as RawOrderListRow[]).map(toListRow);
  }

  if (primary.error) throw primary.error;
  return ((primary.data ?? []) as unknown as RawOrderListRow[]).map(toListRow);
}

export interface OrderDetail {
  order: OrderRow;
  items: OrderItemRow[];
  units: InventoryUnitRow[];
  progress: OrderProgress;
  customer: { id: string; name: string; vat_number: string | null } | null;
  location: {
    id: string;
    location_name: string | null;
    address_line1: string;
    city: string;
    province: string | null;
    postal_code: string | null;
    phone: string | null;
  } | null;
  driver: { id: string; name: string } | null;
  vehicle: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const supabase = createSupabaseAdminClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  if (!order) return null;
  const orderRow = order as unknown as OrderRow;

  // Fetched in parallel: none of these depend on each other.
  const [itemsResult, unitsResult, customerResult, locationResult, driverResult, vehicleResult, supplierResult] =
    await Promise.all([
      supabase.from("order_items").select("*").eq("order_id", orderId).order("line_number"),
      supabase
        .from("inventory_units")
        .select("*")
        .eq("order_id", orderId)
        .order("order_item_id")
        .order("unit_sequence"),
      orderRow.customer_id
        ? supabase.from("customers").select("id, name, vat_number").eq("id", orderRow.customer_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      orderRow.customer_location_id
        ? supabase
            .from("customer_locations")
            .select("id, location_name, address_line1, city, province, postal_code, phone")
            .eq("id", orderRow.customer_location_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      orderRow.driver_id
        ? supabase.from("drivers").select("id, name").eq("id", orderRow.driver_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      orderRow.vehicle_id
        ? supabase.from("vehicles").select("id, name").eq("id", orderRow.vehicle_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      orderRow.supplier_id
        ? supabase.from("suppliers").select("id, name").eq("id", orderRow.supplier_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  if (itemsResult.error) throw itemsResult.error;
  if (unitsResult.error) throw unitsResult.error;

  const units = (unitsResult.data ?? []) as unknown as InventoryUnitRow[];

  return {
    order: orderRow,
    items: (itemsResult.data ?? []) as unknown as OrderItemRow[],
    units,
    progress: calculateOrderProgress(units),
    customer: (customerResult.data ?? null) as OrderDetail["customer"],
    location: (locationResult.data ?? null) as OrderDetail["location"],
    driver: (driverResult.data ?? null) as OrderDetail["driver"],
    vehicle: (vehicleResult.data ?? null) as OrderDetail["vehicle"],
    supplier: (supplierResult.data ?? null) as OrderDetail["supplier"],
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateOrderItemInput {
  item_type: ItemType;
  is_physical?: boolean;
  quantity: number;
  supplier_sku?: string | null;
  raw_description?: string | null;
  description?: string | null;
  brand?: string | null;
  model?: string | null;
  width?: number | null;
  aspect_ratio?: number | null;
  rim_diameter?: number | null;
  load_index?: string | null;
  speed_rating?: string | null;
  extra_load?: boolean | null;
  run_flat?: boolean | null;
  unit_price?: number | null;
  tax_rate?: number | null;
  pfu_fee?: number | null;
  logistics_fee?: number | null;
  currency?: string | null;
  needs_review?: boolean;
  review_fields?: string[];
  confidence?: number | null;
}

export interface CreateOrderInput {
  supplier_id?: string | null;
  supplier_document_number?: string | null;
  supplier_document_date?: string | null;
  supplier_reference?: string | null;
  /** pdf | image | manual | email — matches orders.source_type. */
  source_type?: string | null;
  customer_id?: string | null;
  customer_location_id?: string | null;
  delivery_recipient?: string | null;
  delivery_address_line1?: string | null;
  delivery_address_line2?: string | null;
  delivery_city?: string | null;
  delivery_province?: string | null;
  delivery_postal_code?: string | null;
  delivery_country?: string | null;
  delivery_notes?: string | null;
  planned_delivery_date?: string | null;
  stand_code?: StandCode | null;
  /** When no stand is requested, take the first free one. */
  auto_allocate_stand?: boolean;
  driver_id?: string | null;
  vehicle_id?: string | null;
  requires_payment_on_delivery?: boolean;
  payment_method?: string | null;
  amount_to_collect?: number | null;
  currency?: string | null;
  collection_method?: string | null;
  notes?: string | null;
  source_document_id?: string | null;
  items: CreateOrderItemInput[];
}

export interface CreateOrderResult {
  orderId: string;
  orderNumber: string;
  standCode: StandCode | null;
  /** 'STAND_OCCUPIED' | 'NO_STAND_AVAILABLE' — surfaced to the Admin. */
  standWarning: string | null;
  inventoryUnitCount: number;
}

/**
 * Creates the confirmed order. One RPC call, one transaction: order + items +
 * inventory units + status history + document link + stand claim all succeed or
 * all fail. There is no window where an order exists without its units.
 */
export async function createOrder(
  input: CreateOrderInput,
  createdBy: string
): Promise<CreateOrderResult> {
  const supabase = createSupabaseAdminClient();

  // Numbers/dates go over the wire as strings because the RPC reads them with
  // `->>` and casts explicitly; this keeps null vs "" unambiguous.
  const payload = {
    ...input,
    amount_to_collect: input.amount_to_collect == null ? null : String(input.amount_to_collect),
    created_by: createdBy,
    items: input.items.map((item, index) => ({
      ...item,
      line_number: index + 1,
      quantity: String(item.quantity),
      width: item.width == null ? null : String(item.width),
      aspect_ratio: item.aspect_ratio == null ? null : String(item.aspect_ratio),
      rim_diameter: item.rim_diameter == null ? null : String(item.rim_diameter),
      unit_price: item.unit_price == null ? null : String(item.unit_price),
      tax_rate: item.tax_rate == null ? null : String(item.tax_rate),
      pfu_fee: item.pfu_fee == null ? null : String(item.pfu_fee),
      logistics_fee: item.logistics_fee == null ? null : String(item.logistics_fee),
      confidence: item.confidence == null ? null : String(item.confidence),
      extra_load: item.extra_load == null ? null : String(item.extra_load),
      run_flat: item.run_flat == null ? null : String(item.run_flat),
      is_physical: item.is_physical == null ? null : String(item.is_physical),
      needs_review: String(Boolean(item.needs_review)),
      review_fields: item.review_fields ?? [],
    })),
  };

  const { data, error } = await supabase.rpc("gorush_create_order", { payload });
  if (error) {
    logError("order_create_failed", error, { createdBy });
    throw error;
  }

  const result = data as {
    order_id: string;
    order_number: string;
    stand_code: StandCode | null;
    stand_warning: string | null;
    inventory_unit_count: number;
  };

  logEvent("order_created", {
    orderId: result.order_id,
    orderNumber: result.order_number,
    standCode: result.stand_code ?? "none",
    unitCount: result.inventory_unit_count,
    standWarning: result.stand_warning ?? "none",
  });

  return {
    orderId: result.order_id,
    orderNumber: result.order_number,
    standCode: result.stand_code,
    standWarning: result.stand_warning,
    inventoryUnitCount: result.inventory_unit_count,
  };
}

// ---------------------------------------------------------------------------
// Update / lifecycle
// ---------------------------------------------------------------------------

/**
 * Fields the Admin may edit directly. These are REAL column names, because this
 * goes straight into an `update()` — unlike CreateOrderInput, whose keys form
 * the RPC payload contract. Status and stand have their own paths.
 */
export interface UpdateOrderInput {
  supplier_document_number?: string | null;
  document_date?: string | null;
  supplier_order_reference?: string | null;
  planned_delivery_date?: string | null;
  driver_id?: string | null;
  vehicle_id?: string | null;
  delivery_name?: string | null;
  delivery_address_line1?: string | null;
  delivery_address_line2?: string | null;
  delivery_city?: string | null;
  delivery_province?: string | null;
  delivery_postal_code?: string | null;
  delivery_country_code?: string | null;
  delivery_notes?: string | null;
  cash_on_delivery?: boolean;
  payment_method?: string | null;
  amount_to_collect?: number | null;
  collection_method?: string | null;
  notes?: string | null;
  customer_location_id?: string | null;
}

export async function updateOrder(orderId: string, input: UpdateOrderInput): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("orders").update(input).eq("id", orderId);
  if (error) throw error;
  logEvent("order_updated", { orderId });
}

export interface StatusChangeResult {
  ok: boolean;
  code?: string;
  standWarning?: string | null;
}

async function setStatus(
  orderId: string,
  status: OrderStatus,
  options: { reason?: string | null; changedBy: string; plannedDeliveryDate?: string | null }
): Promise<StatusChangeResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("gorush_set_order_status", {
    p_order_id: orderId,
    p_status: status,
    p_reason: options.reason ?? null,
    p_changed_by: options.changedBy,
    p_planned_delivery_date: options.plannedDeliveryDate ?? null,
  });

  if (error) {
    logError("order_status_change_failed", error, { orderId, status });
    throw error;
  }

  const result = data as { ok: boolean; code?: string; stand_warning?: string | null };
  logEvent("order_status_changed", {
    orderId,
    status,
    ok: result.ok,
    code: result.code ?? "",
  });

  return { ok: result.ok, code: result.code, standWarning: result.stand_warning ?? null };
}

/**
 * "Delete Order" in the Admin UI. Phase 1 makes this a safe cancellation:
 * the order leaves the active dashboard, but items, inventory units, scan
 * history and status history are all preserved. No SQL DELETE happens here —
 * see the migration comment; a true delete needs an explicit future decision.
 */
export async function cancelOrder(
  orderId: string,
  reason: string | null,
  changedBy: string
): Promise<StatusChangeResult> {
  return setStatus(orderId, "cancelled", { reason, changedBy });
}

export async function holdOrder(
  orderId: string,
  reason: string | null,
  changedBy: string
): Promise<StatusChangeResult> {
  return setStatus(orderId, "on_hold", { reason, changedBy });
}

/** "Pregătește comanda" — the order's tyres are labeled (or the admin chose to skip printing) and ready to load. */
export async function markOrderPrepared(orderId: string, changedBy: string): Promise<StatusChangeResult> {
  return setStatus(orderId, "ready_for_loading", { reason: "prepared", changedBy });
}

/**
 * Brings an order back out of hold. The stand it used to hold may have been
 * taken meanwhile, so the RPC re-checks and reports a warning rather than
 * double-booking it.
 */
export async function reactivateOrder(
  orderId: string,
  options: { plannedDeliveryDate?: string | null; changedBy: string }
): Promise<StatusChangeResult> {
  const supabase = createSupabaseAdminClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("status_before_hold")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;

  const previous = (order as { status_before_hold: OrderStatus | null } | null)?.status_before_hold;
  const target = resolveReactivationStatus(previous);

  return setStatus(orderId, target, {
    reason: "reactivated",
    changedBy: options.changedBy,
    plannedDeliveryDate: options.plannedDeliveryDate ?? null,
  });
}

export async function assignStand(
  orderId: string,
  standCode: StandCode | null,
  changedBy: string
): Promise<{ ok: boolean; code?: string }> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("gorush_assign_stand", {
    p_order_id: orderId,
    p_stand_code: standCode,
    p_changed_by: changedBy,
  });
  if (error) throw error;

  const result = data as { ok: boolean; code?: string };
  logEvent("stand_assigned", { orderId, standCode: standCode ?? "none", ok: result.ok });
  return result;
}

/**
 * The vehicle board's single write path: sets vehicle_id and a fresh
 * 1..N delivery_sequence for every order in `orderedOrderIds`, in the
 * position given.
 *
 * Handles both interactions the board supports with one call:
 *   - Reordering within a column: vehicleId is that column's own vehicle,
 *     orderedOrderIds is the column's new full order.
 *   - Moving an order to a different column: vehicleId is the TARGET
 *     column's vehicle, orderedOrderIds is the target column's new full
 *     order (including the moved order). The source column's remaining
 *     orders keep their old sequence numbers — that leaves gaps, but gaps
 *     are harmless for an ORDER BY, and re-numbering a column no one
 *     touched isn't needed for correctness.
 *
 * No RPC/locking needed here (unlike stand allocation): there is no
 * collision to prevent — two orders can validly share a vehicle and even,
 * transiently, a sequence number — so plain concurrent updates are enough.
 */
export async function reorderVehicleColumn(vehicleId: string | null, orderedOrderIds: string[]): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const results = await Promise.all(
    orderedOrderIds.map((orderId, index) =>
      supabase
        .from("orders")
        .update({ vehicle_id: vehicleId, delivery_sequence: index + 1 })
        .eq("id", orderId)
    )
  );

  const failed = results.find((result) => result.error);

  // Same defensive fallback as the read paths above: the vehicle-board
  // migration (delivery_sequence column) may not have been run yet against
  // this database. Without this, every drag-and-drop move on the board
  // fails outright ("Mutarea nu a putut fi salvată") instead of at least
  // saving the vehicle assignment.
  if (isMissingSchemaError(failed?.error)) {
    logError("orders_delivery_sequence_column_missing_on_write", failed?.error);
    const fallbackResults = await Promise.all(
      orderedOrderIds.map((orderId) =>
        supabase.from("orders").update({ vehicle_id: vehicleId }).eq("id", orderId)
      )
    );
    const fallbackFailed = fallbackResults.find((result) => result.error);
    if (fallbackFailed?.error) throw fallbackFailed.error;

    logEvent("orders_reordered", {
      vehicleId: vehicleId ?? "unassigned",
      count: orderedOrderIds.length,
      deliverySequenceSkipped: true,
    });
    return;
  }

  if (failed?.error) throw failed.error;

  logEvent("orders_reordered", { vehicleId: vehicleId ?? "unassigned", count: orderedOrderIds.length });
}

// ---------------------------------------------------------------------------
// Item editing (order detail screen)
// ---------------------------------------------------------------------------

/**
 * Updates an existing order item. Deliberately does NOT change quantity:
 * inventory units are already generated and may have been scanned, so quantity
 * changes need their own reconciliation path (a Phase 2 concern). `raw_description`
 * is likewise never overwritten — the source text stays as extracted.
 */
export async function updateOrderItem(
  itemId: string,
  input: {
    description?: string | null;
    item_type?: ItemType;
    brand?: string | null;
    model?: string | null;
    width?: number | null;
    aspect_ratio?: number | null;
    rim_diameter?: number | null;
    load_index?: string | null;
    speed_rating?: string | null;
    unit_price?: number | null;
    needs_review?: boolean;
  }
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("order_items").update(input).eq("id", itemId);
  if (error) throw error;
  logEvent("order_item_updated", { itemId });
}

/** Recent scan history for an order, newest first (last-known-location view). */
export async function getOrderScanHistory(orderId: string, limit = 50) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("inventory_scans")
    .select(
      "id, inventory_unit_id, scan_type, result, manual, reason, stand_code, scanned_at, drivers ( name ), vehicles ( name )"
    )
    .eq("order_id", orderId)
    .order("scanned_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as {
    id: string;
    inventory_unit_id: string | null;
    scan_type: string;
    result: string;
    manual: boolean;
    reason: string | null;
    stand_code: StandCode | null;
    scanned_at: string;
    drivers: { name: string } | null;
    vehicles: { name: string } | null;
  }[];
}

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError, logEvent } from "@/lib/logger";
import { matchSupplierLabel, searchExpectedLines } from "@/lib/logistics/supplier-label-match";
import type { ExpectedLine, LabelMatchOutcome, ScannedLabel } from "@/lib/logistics/supplier-label-match";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import type { ItemType, LabelData, StandCode } from "@/lib/types/logistics";

/**
 * Orders that can still absorb incoming goods. Uses the live vocabulary's
 * partially_* values, so a half-received order stays in the candidate pool.
 */
const ACTIVE_RECEIVING_STATUSES = [
  "confirmed",
  "expected",
  "partially_received",
  "received",
  "sorting",
  "stored",
  "ready_for_loading",
];

/**
 * Warehouse receiving: supplier-label matching and the GoRush barcode storage
 * scan.
 *
 * Both write paths go through RPCs so the unit update, the scan event and the
 * print job are one transaction.
 */

// ---------------------------------------------------------------------------
// Expected lines (the candidate pool for label matching)
// ---------------------------------------------------------------------------

interface RawExpectedRow {
  id: string;
  order_id: string;
  item_type: ItemType;
  brand: string | null;
  supplier_sku: string | null;
  width: number | null;
  aspect_ratio: number | null;
  rim_diameter: number | string | null;
  load_index: string | null;
  speed_rating: string | null;
  raw_description: string | null;
  description: string | null;
  orders: {
    id: string;
    order_number: number;
    stand_code: StandCode | null;
    planned_delivery_date: string | null;
    status: string;
    supplier_id: string | null;
    customers: { name: string } | null;
    suppliers: { name: string } | null;
  } | null;
  inventory_units: { status: string }[] | null;
}

const EXPECTED_SELECT = `
  id, order_id, item_type, brand, supplier_sku, width, aspect_ratio, rim_diameter,
  load_index, speed_rating, raw_description, description,
  orders!inner ( id, order_number, stand_code, planned_delivery_date, status, supplier_id,
                 customers ( name ), suppliers ( name ) ),
  inventory_units ( status )
`;

/**
 * Order lines still awaiting physical goods.
 *
 * Scoped to ACTIVE orders only — never arbitrary history. Ordering puts
 * today's and earlier planned deliveries first, because a tyre arriving now is
 * far more likely to belong to a delivery that is due than to next week's.
 */
export async function listExpectedLines(options: { limit?: number } = {}): Promise<ExpectedLine[]> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("order_items")
    .select(EXPECTED_SELECT)
    .eq("is_physical", true)
    .in("orders.status", ACTIVE_RECEIVING_STATUSES)
    .order("id")
    .limit(options.limit ?? 500);

  if (error) throw error;

  const lines = ((data ?? []) as unknown as RawExpectedRow[])
    .map((row): ExpectedLine | null => {
      if (!row.orders) return null;
      const unitsExpected = (row.inventory_units ?? []).filter(
        (unit) => unit.status === "expected"
      ).length;

      return {
        orderItemId: row.id,
        orderId: row.order_id,
        // Display form ("GR-001"), which is also what manual search matches on.
        orderNumber: formatOrderNumber(row.orders.order_number),
        standCode: row.orders.stand_code,
        customerName: row.orders.customers?.name ?? null,
        supplierId: row.orders.supplier_id,
        supplierName: row.orders.suppliers?.name ?? null,
        plannedDeliveryDate: row.orders.planned_delivery_date,
        itemType: row.item_type,
        unitsExpected,
        item: {
          brand: row.brand,
          supplier_sku: row.supplier_sku,
          width: row.width,
          aspect_ratio: row.aspect_ratio,
          rim_diameter: row.rim_diameter,
          load_index: row.load_index,
          speed_rating: row.speed_rating,
          raw_description: row.raw_description,
          description: row.description,
        },
      };
    })
    .filter((line): line is ExpectedLine => line !== null && line.unitsExpected > 0);

  // Soonest planned delivery first; undated last.
  return lines.sort((a, b) => {
    const dateA = a.plannedDeliveryDate ?? "9999-12-31";
    const dateB = b.plannedDeliveryDate ?? "9999-12-31";
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    return a.orderNumber.localeCompare(b.orderNumber);
  });
}

/** Matches a scanned supplier label against the expected pool. */
export async function matchScannedLabel(
  scanned: ScannedLabel,
  options: { supplierId?: string | null } = {}
): Promise<LabelMatchOutcome> {
  const lines = await listExpectedLines();
  return matchSupplierLabel(scanned, lines, options);
}

/** Manual search fallback when no confident match exists. */
export async function searchExpected(query: string): Promise<ExpectedLine[]> {
  const lines = await listExpectedLines();
  return searchExpectedLines(query, lines).slice(0, 25);
}

// ---------------------------------------------------------------------------
// Receiving a physical unit
// ---------------------------------------------------------------------------

export interface ReceiveUnitResult {
  ok: boolean;
  code: string;
  inventoryUnitId?: string;
  unitToken?: string;
  orderId?: string;
  orderNumber?: number | string;
  standCode?: StandCode | null;
  customer?: string;
  product?: string;
  printJobId?: string | null;
  labelData?: LabelData;
}

/**
 * Associates a supplier label with the next expected physical unit on a line.
 *
 * Atomic: claims the unit, marks it `received`, records the scan, and queues the
 * print job in one transaction. The unit is NOT marked `stored` — physical
 * storage is only confirmed later by scanning the printed GoRush barcode.
 *
 * `idempotencyKey` must be supplied by the client per capture attempt. Without
 * it, a double-submitted scan would consume two physical units.
 */
export async function receiveUnitForOrderItem(input: {
  orderItemId: string;
  rawValue?: string | null;
  operator?: string | null;
  manual?: boolean;
  reason?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<ReceiveUnitResult> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc("gorush_receive_unit", {
    p_order_item_id: input.orderItemId,
    p_raw_value: input.rawValue ?? null,
    p_operator: input.operator ?? null,
    p_manual: input.manual ?? false,
    p_reason: input.reason ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_metadata: input.metadata ?? null,
  });

  if (error) {
    logError("receive_unit_failed", error, { orderItemId: input.orderItemId });
    throw error;
  }

  const result = data as {
    ok: boolean;
    code: string;
    inventory_unit_id?: string;
    unit_token?: string;
    order_id?: string;
    order_number?: number | string;
    stand_code?: StandCode | null;
    customer?: string;
    product?: string;
    print_job_id?: string | null;
    label_data?: LabelData;
  };

  logEvent("unit_received", {
    orderItemId: input.orderItemId,
    code: result.code,
    manual: Boolean(input.manual),
    printJobId: result.print_job_id ?? "none",
  });

  return {
    ok: result.ok,
    code: result.code,
    inventoryUnitId: result.inventory_unit_id,
    unitToken: result.unit_token,
    orderId: result.order_id,
    orderNumber: result.order_number,
    standCode: result.stand_code ?? null,
    customer: result.customer,
    product: result.product,
    printJobId: result.print_job_id ?? null,
    labelData: result.label_data,
  };
}

// ---------------------------------------------------------------------------
// Storage scan (printed GoRush barcode)
// ---------------------------------------------------------------------------

export interface StoreUnitResult {
  ok: boolean;
  code: string;
  inventoryUnitId?: string;
  unitToken?: string;
  status?: string;
  orderId?: string;
  orderNumber?: number | string;
  standCode?: StandCode | null;
  customer?: string;
  description?: string | null;
}

/**
 * Confirms physical storage from a handheld barcode scan.
 *
 * Rescanning an already-stored item returns `ALREADY_STORED` with `ok: false`
 * and writes a harmless audit scan — it never duplicates a unit or corrupts
 * state.
 */
export async function storeUnitByToken(input: {
  unitToken: string;
  operator?: string | null;
  zoneId?: string | null;
  idempotencyKey?: string | null;
}): Promise<StoreUnitResult> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc("gorush_store_unit", {
    p_unit_token: input.unitToken,
    p_operator: input.operator ?? null,
    p_zone_id: input.zoneId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  if (error) {
    logError("store_unit_failed", error, {});
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
    stand_code?: StandCode | null;
    customer?: string;
    description?: string | null;
  };

  logEvent("unit_storage_scan", { code: result.code, ok: result.ok });

  return {
    ok: result.ok,
    code: result.code,
    inventoryUnitId: result.inventory_unit_id,
    unitToken: result.unit_token,
    status: result.status,
    orderId: result.order_id,
    orderNumber: result.order_number,
    standCode: result.stand_code ?? null,
    customer: result.customer,
    description: result.description,
  };
}

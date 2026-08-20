import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { calculateOrderProgress } from "@/lib/logistics/order-progress";
import type { InventoryUnitStatus, ItemType, OrderStatus } from "@/lib/types/logistics";
import type { OrderProgress } from "@/lib/logistics/order-progress";

/**
 * The read-only order view reachable from a public QR code: `/orders/[id]`
 * and the per-unit fallback `/u/[token]`. (The old `/stand/[code]` public
 * view was removed along with the stand/stativ concept — see the Phase 1
 * stand-removal change set.)
 */

/** Read-only projection safe to show anyone. */
export interface PublicOrderViewData {
  order: {
    id: string;
    order_number: number;
    status: OrderStatus;
    customer_name: string | null;
    planned_delivery_date: string | null;
    driver_name: string | null;
    vehicle_name: string | null;
  } | null;
  items: {
    id: string;
    description: string;
    item_type: ItemType;
    quantity: number;
    units: { id: string; unit_sequence: number; status: InventoryUnitStatus }[];
  }[];
  progress: OrderProgress;
}

/**
 * Note the deliberate omissions from this select: no payment amounts, no
 * collection method, no addresses, no unit tokens. A unit token is effectively a
 * bearer credential for marking that object stored/loaded, so it must never
 * appear in a page anyone can open from a public QR code.
 */
const PUBLIC_ORDER_SELECT = `
  id, order_number, status, planned_delivery_date,
  customers ( name ),
  drivers ( name ),
  vehicles ( name ),
  order_items ( id, description, raw_description, item_type, quantity, is_physical, line_number ),
  inventory_units ( id, order_item_id, unit_sequence, status )
`;

interface RawPublicOrder {
  id: string;
  order_number: number;
  status: OrderStatus;
  planned_delivery_date: string | null;
  customers: { name: string } | null;
  drivers: { name: string } | null;
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

function toPublicView(raw: RawPublicOrder | null): PublicOrderViewData {
  if (!raw) {
    return { order: null, items: [], progress: calculateOrderProgress([]) };
  }

  const unitsByItem = new Map<string, RawPublicOrder["inventory_units"]>();
  for (const unit of raw.inventory_units) {
    const list = unitsByItem.get(unit.order_item_id) ?? [];
    list.push(unit);
    unitsByItem.set(unit.order_item_id, list);
  }

  const items = [...raw.order_items]
    .sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0))
    .map((item) => ({
      id: item.id,
      description: item.description ?? item.raw_description ?? "—",
      item_type: item.item_type,
      quantity: item.quantity,
      units: (unitsByItem.get(item.id) ?? [])
        .sort((a, b) => a.unit_sequence - b.unit_sequence)
        .map((unit) => ({ id: unit.id, unit_sequence: unit.unit_sequence, status: unit.status })),
    }));

  return {
    order: {
      id: raw.id,
      order_number: raw.order_number,
      status: raw.status,
      customer_name: raw.customers?.name ?? null,
      planned_delivery_date: raw.planned_delivery_date,
      driver_name: raw.drivers?.name ?? null,
      vehicle_name: raw.vehicles?.name ?? null,
    },
    items,
    progress: calculateOrderProgress(raw.inventory_units),
  };
}

/** Read-only view of one order by id, for `/orders/[id]` and the unit QR. */
export async function getPublicOrderView(orderId: string): Promise<PublicOrderViewData | null> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("orders")
    .select(PUBLIC_ORDER_SELECT)
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return toPublicView(data as unknown as RawPublicOrder);
}

/** Resolves a scanned unit token to its order, for the QR phone fallback. */
export async function getPublicOrderViewByUnitToken(
  unitToken: string
): Promise<{ view: PublicOrderViewData; unitId: string } | null> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("inventory_units")
    .select("id, order_id")
    .eq("qr_token", unitToken.trim())
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const unit = data as { id: string; order_id: string };
  const view = await getPublicOrderView(unit.order_id);
  if (!view) return null;
  return { view, unitId: unit.id };
}

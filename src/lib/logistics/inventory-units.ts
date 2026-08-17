// Quantity -> physical inventory unit planning.
//
// One physical object = one inventory_unit. An order item with quantity 4
// produces 4 units, each with its own token and barcode.
//
// This module is the pure planner used for previews, validation and tests. The
// authoritative generation happens inside `gorush_create_order` so the units,
// the order and its items are created in one transaction.

import { isPhysicalItemType, isItemType } from "@/lib/types/logistics";
import type { ItemType } from "@/lib/types/logistics";

export interface PlannableOrderItem {
  item_type: ItemType | string;
  quantity: number;
  /** Explicit override. When absent, derived from the item type. */
  is_physical?: boolean | null;
  description?: string | null;
  raw_description?: string | null;
}

export interface PlannedUnit {
  itemIndex: number;
  unitIndex: number;
  itemType: ItemType;
  description: string | null;
}

/**
 * Whether a line produces physical units. Services and fees (PFU, transport,
 * mounting) are legitimate order lines but not physical objects, so they get no
 * units. An explicit `is_physical` always wins — that is the hook for a future
 * "fee that ships as an object".
 */
export function lineIsPhysical(item: PlannableOrderItem): boolean {
  if (item.is_physical === true || item.is_physical === false) return item.is_physical;
  const type: ItemType = isItemType(item.item_type) ? item.item_type : "other";
  return isPhysicalItemType(type);
}

/** Normalises a quantity into a whole, non-negative, sane unit count. */
export function unitCountForLine(item: PlannableOrderItem): number {
  if (!lineIsPhysical(item)) return 0;
  const qty = Number(item.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.floor(qty);
}

export function totalUnitCount(items: readonly PlannableOrderItem[]): number {
  return items.reduce((sum, item) => sum + unitCountForLine(item), 0);
}

/**
 * Expands order items into the individual physical units they imply.
 * `unitIndex` is 1-based per item, matching the `unit_index` column.
 */
export function planInventoryUnits(items: readonly PlannableOrderItem[]): PlannedUnit[] {
  const planned: PlannedUnit[] = [];

  items.forEach((item, itemIndex) => {
    const count = unitCountForLine(item);
    const type: ItemType = isItemType(item.item_type) ? item.item_type : "other";
    const description = item.description?.trim() || item.raw_description?.trim() || null;

    for (let unitIndex = 1; unitIndex <= count; unitIndex += 1) {
      planned.push({ itemIndex, unitIndex, itemType: type, description });
    }
  });

  return planned;
}

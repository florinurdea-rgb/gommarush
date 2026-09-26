/**
 * Pure logic for the admin dashboard's vehicle board: how a drag-and-drop
 * move rearranges the in-memory columns, and how a column's occupancy/
 * "returns to depot" figures are derived. Kept free of React so both are
 * unit-testable without mounting anything.
 */

export interface VehicleLoadStats {
  orderCount: number;
  unitCount: number;
  capacityUnits: number | null;
  /** Null when the vehicle has no capacity set — nothing to measure against. */
  occupancyPercent: number | null;
  /**
   * How many extra trips back to the depot the current load needs, beyond
   * the first one. 0 when capacity is unknown OR the load fits in one run —
   * both cases where there is nothing to warn about.
   */
  returnTrips: number;
}

export function computeVehicleLoad(
  orderCount: number,
  unitCount: number,
  capacityUnits: number | null
): VehicleLoadStats {
  const occupancyPercent =
    capacityUnits && capacityUnits > 0 ? Math.round((unitCount / capacityUnits) * 100) : null;
  const returnTrips =
    capacityUnits && capacityUnits > 0 && unitCount > capacityUnits
      ? Math.ceil(unitCount / capacityUnits) - 1
      : 0;

  return { orderCount, unitCount, capacityUnits, occupancyPercent, returnTrips };
}

/**
 * Moves `orderId` from `fromKey`'s list to `toKey`'s list at `toIndex`
 * (same key = reorder within one column). Returns a new columns map;
 * unrelated keys are untouched. A no-op (same map back) if the order isn't
 * found in `fromKey` — defensive against a stale drag event.
 */
export function moveOrderBetweenColumns<T extends { id: string }>(
  columnsByKey: Record<string, T[]>,
  orderId: string,
  fromKey: string,
  toKey: string,
  toIndex: number
): Record<string, T[]> {
  const fromList = columnsByKey[fromKey] ?? [];
  const item = fromList.find((order) => order.id === orderId);
  if (!item) return columnsByKey;

  const newFromList = fromList.filter((order) => order.id !== orderId);
  const baseToList = fromKey === toKey ? newFromList : (columnsByKey[toKey] ?? []);
  const clampedIndex = Math.max(0, Math.min(toIndex, baseToList.length));
  const newToList = [...baseToList.slice(0, clampedIndex), item, ...baseToList.slice(clampedIndex)];

  return {
    ...columnsByKey,
    [fromKey]: newFromList,
    [toKey]: newToList,
  };
}

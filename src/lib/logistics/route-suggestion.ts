/**
 * "Asignează în ruta recomandată" — a deliberately simple, honest heuristic,
 * not real route optimization. There is no geocoding/routing service wired
 * up yet (see the map feature discussion), so this groups unassigned orders
 * by delivery city — orders in the same city are likely to be on a
 * sensible route together — and balances those groups across vehicles by
 * remaining capacity. It is explicitly labelled "grupare simplă după
 * localitate" in the UI so nobody mistakes it for a real routing engine.
 */

export interface RoutableOrder {
  id: string;
  city: string | null;
  /** Physical units this order contributes to whichever vehicle it lands on. */
  unitCount: number;
}

export interface RoutableVehicle {
  id: string;
  /** Units already assigned to this vehicle (from orders not being re-routed). */
  currentLoad: number;
  capacityUnits: number | null;
}

export interface RouteAssignment {
  orderId: string;
  vehicleId: string;
}

function cityKey(city: string | null): string {
  return (city ?? "").trim().toLowerCase() || "__unknown__";
}

/**
 * Groups orders by city, then assigns each city-group whole to the vehicle
 * with the most remaining capacity at that point (so a city's orders stay
 * together on one route rather than being split arbitrarily) — falling
 * back to whichever vehicle has the lowest current load when capacity is
 * unknown for every vehicle. Never assigns to a vehicle whose capacity
 * would be knowingly exceeded if a vehicle with room is available.
 */
export function suggestRouteAssignments(
  orders: RoutableOrder[],
  vehicles: RoutableVehicle[]
): RouteAssignment[] {
  if (vehicles.length === 0) return [];

  const load = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.currentLoad]));

  /** Whether a group fits without exceeding a KNOWN capacity — unknown capacity always fits. */
  const fits = (vehicleId: string, groupUnits: number): boolean => {
    const vehicle = vehicles.find((v) => v.id === vehicleId)!;
    if (vehicle.capacityUnits === null) return true;
    return vehicle.capacityUnits - (load.get(vehicleId) ?? 0) >= groupUnits;
  };

  /** Higher = more preferred: remaining capacity when known, otherwise the inverse of current
   *  load so vehicles still get balanced even with no capacity data at all. */
  const preference = (vehicleId: string): number => {
    const vehicle = vehicles.find((v) => v.id === vehicleId)!;
    const currentLoad = load.get(vehicleId) ?? 0;
    return vehicle.capacityUnits === null ? -currentLoad : vehicle.capacityUnits - currentLoad;
  };

  const groups = new Map<string, RoutableOrder[]>();
  for (const order of orders) {
    const key = cityKey(order.city);
    const group = groups.get(key) ?? [];
    group.push(order);
    groups.set(key, group);
  }

  // Larger groups first: keeping a big city's orders together matters more
  // than a single stray order's placement.
  const sortedGroups = [...groups.values()].sort((a, b) => b.length - a.length);

  const assignments: RouteAssignment[] = [];

  for (const group of sortedGroups) {
    const groupUnits = group.reduce((sum, order) => sum + order.unitCount, 0);

    const best = vehicles.reduce((chosen, candidate) => {
      const candidateFits = fits(candidate.id, groupUnits);
      const chosenFits = fits(chosen.id, groupUnits);
      // Prefer whichever vehicle fits the whole group; among those (or if
      // none technically "fits" a known capacity), the most preferred by
      // remaining capacity / current load.
      if (candidateFits && !chosenFits) return candidate;
      if (!candidateFits && chosenFits) return chosen;
      return preference(candidate.id) > preference(chosen.id) ? candidate : chosen;
    }, vehicles[0]);

    for (const order of group) {
      assignments.push({ orderId: order.id, vehicleId: best.id });
    }
    load.set(best.id, (load.get(best.id) ?? 0) + groupUnits);
  }

  return assignments;
}

/** The single-order version of the same heuristic — for the per-card "Asignează în ruta recomandată" action. */
export function suggestRouteForOrder(order: RoutableOrder, vehicles: RoutableVehicle[]): string | null {
  const assignments = suggestRouteAssignments([order], vehicles);
  return assignments[0]?.vehicleId ?? null;
}

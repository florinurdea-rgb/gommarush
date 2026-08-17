// Pure decision rules for the two barcode-scanning stages.
//
// These mirror the branches inside `gorush_store_unit` / `gorush_load_unit`.
// The database remains authoritative (it holds the locks), but keeping the rules
// here as pure functions means they are directly testable and the UI can
// predict feedback without a round-trip.

import type { InventoryUnitStatus } from "@/lib/types/logistics";

// ---------------------------------------------------------------------------
// Storage scan (the printed GoRush barcode, after the label is attached)
// ---------------------------------------------------------------------------

export type StorageDecision =
  | { outcome: "store"; code: "STORED" }
  | { outcome: "duplicate"; code: "ALREADY_STORED" }
  | { outcome: "duplicate"; code: "ALREADY_MOVED_ON" }
  | { outcome: "reject"; code: "UNIT_NOT_FOUND" };

/**
 * A unit that is already stored must not be stored twice — but rescanning it is
 * a normal warehouse accident, so it produces a clear message and a harmless
 * audit entry rather than an error or corrupt state.
 */
export function decideStorageScan(
  unit: { status: InventoryUnitStatus } | null
): StorageDecision {
  if (!unit) return { outcome: "reject", code: "UNIT_NOT_FOUND" };
  if (unit.status === "stored") return { outcome: "duplicate", code: "ALREADY_STORED" };
  if (unit.status === "loaded" || unit.status === "out_for_delivery" || unit.status === "delivered") {
    return { outcome: "duplicate", code: "ALREADY_MOVED_ON" };
  }
  // 'expected' is allowed: a unit can be scanned straight to storage even if
  // the supplier-label step was skipped, which keeps the warehouse unblocked.
  return { outcome: "store", code: "STORED" };
}

// ---------------------------------------------------------------------------
// Loading scan (into a specific driver's van)
// ---------------------------------------------------------------------------

export type LoadingDecision =
  | { outcome: "load"; code: "LOADED" }
  | { outcome: "duplicate"; code: "ALREADY_LOADED" }
  | { outcome: "duplicate"; code: "ALREADY_MOVED_ON" }
  | { outcome: "reject"; code: "UNIT_NOT_FOUND" }
  | { outcome: "reject"; code: "ORDER_CANCELLED" }
  | { outcome: "reject"; code: "WRONG_DRIVER" }
  | { outcome: "reject"; code: "WRONG_VEHICLE" }
  | { outcome: "reject"; code: "NOT_STORED" };

export interface LoadingScanContext {
  unit: { status: InventoryUnitStatus } | null;
  order: { status: string; driver_id: string | null; vehicle_id: string | null } | null;
  session: { driverId: string; vehicleId: string | null };
}

/**
 * Wrong-item protection, in order of severity.
 *
 * Driver identity is checked BEFORE the unit's own status, because "this belongs
 * to another delivery" is the more important thing to tell someone holding the
 * wrong tyre — even if that tyre also happens to be already loaded.
 */
export function decideLoadingScan(context: LoadingScanContext): LoadingDecision {
  const { unit, order, session } = context;

  if (!unit || !order) return { outcome: "reject", code: "UNIT_NOT_FOUND" };
  if (order.status === "cancelled") return { outcome: "reject", code: "ORDER_CANCELLED" };

  if (order.driver_id !== session.driverId) {
    return { outcome: "reject", code: "WRONG_DRIVER" };
  }

  if (session.vehicleId && order.vehicle_id && order.vehicle_id !== session.vehicleId) {
    return { outcome: "reject", code: "WRONG_VEHICLE" };
  }

  if (unit.status === "loaded") return { outcome: "duplicate", code: "ALREADY_LOADED" };
  if (unit.status === "out_for_delivery" || unit.status === "delivered") {
    return { outcome: "duplicate", code: "ALREADY_MOVED_ON" };
  }

  // Nothing gets on a van that the warehouse never checked in.
  if (unit.status !== "stored") return { outcome: "reject", code: "NOT_STORED" };

  return { outcome: "load", code: "LOADED" };
}

/** Which audio cue the driver UI should play for a decision. */
export function feedbackForDecision(
  decision: StorageDecision | LoadingDecision
): "success" | "warning" | "error" {
  if (decision.outcome === "store" || decision.outcome === "load") return "success";
  if (decision.outcome === "duplicate") return "warning";
  return "error";
}

/**
 * The success beep is reserved for a genuine, confident success. An uncertain
 * or duplicate scan must never sound like a good one — that is how operators
 * learn to trust the beep.
 */
export function shouldPlaySuccessSound(decision: StorageDecision | LoadingDecision): boolean {
  return feedbackForDecision(decision) === "success";
}

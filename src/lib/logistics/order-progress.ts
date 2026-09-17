// Order progress derived from physical unit statuses.
//
// Order-level state is computed from the units rather than duplicated, so there
// is one source of truth. `orders.status` exists as a fast, indexable cache of
// this derivation (written by the RPCs); anything the UI displays as progress
// comes from here.

import type { InventoryUnitStatus, OrderStatus } from "@/lib/types/logistics";

export interface ProgressUnit {
  status: InventoryUnitStatus;
}

export interface OrderProgress {
  total: number;
  /** Units that have been identified against a supplier label (or beyond). */
  received: number;
  /** Units with a confirmed GoRush barcode storage scan (or beyond). */
  stored: number;
  /** Units confirmed onto a van (or beyond). */
  loaded: number;
  delivered: number;
  /** Units in an incident state (damaged/missing/lost/…). */
  problem: number;
  /** Still waiting for a supplier label match. */
  outstanding: number;
  /** 0–100, based on storage confirmation — the Phase 1 warehouse milestone. */
  storedPercent: number;
  loadedPercent: number;
  /** e.g. "3/4" */
  receivedLabel: string;
  storedLabel: string;
  loadedLabel: string;
}

/**
 * Statuses are cumulative milestones: a 'loaded' unit has necessarily been
 * received and stored, so it counts toward all three. Without this, a fully
 * loaded order would read "0/4 stored" and look like nothing had happened.
 */
const RECEIVED_OR_BEYOND: readonly InventoryUnitStatus[] = [
  "received",
  "stored",
  "loaded",
  "out_for_delivery",
  "delivered",
];

const STORED_OR_BEYOND: readonly InventoryUnitStatus[] = [
  "stored",
  "loaded",
  "out_for_delivery",
  "delivered",
];

const LOADED_OR_BEYOND: readonly InventoryUnitStatus[] = [
  "loaded",
  "out_for_delivery",
  "delivered",
];

const PROBLEM_STATUSES: readonly InventoryUnitStatus[] = [
  "returned",
  "defective",
  "damaged",
  "missing",
  "lost",
  "quarantine",
  "disposed",
];

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export function calculateOrderProgress(units: readonly ProgressUnit[]): OrderProgress {
  const total = units.length;
  const count = (statuses: readonly InventoryUnitStatus[]) =>
    units.filter((unit) => statuses.includes(unit.status)).length;

  const received = count(RECEIVED_OR_BEYOND);
  const stored = count(STORED_OR_BEYOND);
  const loaded = count(LOADED_OR_BEYOND);
  const delivered = count(["delivered"]);
  const problem = count(PROBLEM_STATUSES);

  return {
    total,
    received,
    stored,
    loaded,
    delivered,
    problem,
    outstanding: units.filter((unit) => unit.status === "expected").length,
    storedPercent: percent(stored, total),
    loadedPercent: percent(loaded, total),
    receivedLabel: `${received}/${total}`,
    storedLabel: `${stored}/${total}`,
    loadedLabel: `${loaded}/${total}`,
  };
}

/**
 * The order status the unit statuses imply. Used to keep `orders.status`
 * honest and to decide what the dashboard should show.
 *
 * `on_hold` and `cancelled` are administrative decisions, not physical facts,
 * so they always win over anything derived from units.
 */
export function deriveOrderStatus(
  units: readonly ProgressUnit[],
  currentStatus: OrderStatus
): OrderStatus {
  if (currentStatus === "cancelled" || currentStatus === "on_hold") return currentStatus;

  // Never walk an order backwards out of a later delivery stage.
  if (currentStatus === "out_for_delivery" || currentStatus === "delivered") return currentStatus;

  const progress = calculateOrderProgress(units);
  if (progress.total === 0) return currentStatus;

  if (progress.loaded === progress.total) return "loaded";
  if (progress.stored === progress.total) {
    // All physically checked in: ready for a driver to load.
    return currentStatus === "ready_for_loading" ? "ready_for_loading" : "stored";
  }
  if (progress.received > 0 || progress.stored > 0) return "received";
  return "expected";
}

/**
 * Short Romanian-agnostic progress descriptor for compact table cells, e.g.
 * `{ primary: "3/4", secondary: "depozitate" }`. The caller supplies the
 * translated noun so this stays language-free.
 */
export function progressSummary(progress: OrderProgress): {
  key: "loaded" | "stored" | "received";
  value: string;
} {
  if (progress.loaded > 0) return { key: "loaded", value: progress.loadedLabel };
  if (progress.stored > 0) return { key: "stored", value: progress.storedLabel };
  return { key: "received", value: progress.receivedLabel };
}

/**
 * Where an order should land when it comes back off hold.
 *
 * An order that had already progressed physically returns to where it was;
 * anything else goes back to awaiting delivery. Kept pure and separate from the
 * database call so the rule is directly testable.
 */
export function resolveReactivationStatus(
  statusBeforeHold: OrderStatus | null | undefined
): OrderStatus {
  if (!statusBeforeHold) return "expected";
  // Never restore an order into hold or cancellation.
  if (statusBeforeHold === "on_hold" || statusBeforeHold === "cancelled") return "expected";
  return statusBeforeHold;
}

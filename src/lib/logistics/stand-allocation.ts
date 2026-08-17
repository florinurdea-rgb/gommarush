// Temporary sorting stand allocation (A–E).
//
// Deliberately isolated and pure so it can evolve — Phase 2 may weight stands
// by proximity, van, or delivery window without touching anything else. Phase 1
// rule: take the first free stand, never reuse an occupied one.
//
// IMPORTANT: stands are NOT warehouse zones. There is no mapping from A–E onto
// physical zones 1–5, by design.
//
// This module decides; the database enforces. `orders_active_stand_key` (a
// partial unique index) plus an advisory lock inside `gorush_create_order` are
// what actually prevent two concurrent saves taking the same stand — an
// in-process check alone would race.

import { STAND_CODES, STAND_HOLDING_STATUSES } from "@/lib/types/logistics";
import type { OrderStatus, StandCode } from "@/lib/types/logistics";

/** Minimal shape needed to decide occupancy — any order-like row will do. */
export interface StandOccupant {
  id: string;
  stand_code: StandCode | null;
  status: OrderStatus;
}

export type StandAllocationOutcome =
  | { kind: "allocated"; standCode: StandCode }
  | { kind: "requested_occupied"; standCode: null; occupiedBy: string }
  | { kind: "none_available"; standCode: null };

/**
 * A stand is occupied while its order is still in a warehouse stage. Once the
 * order is loaded / out for delivery / delivered / on hold / cancelled, the
 * stand is free again — there is no explicit release step to forget.
 */
export function standHoldingStatuses(): readonly OrderStatus[] {
  return STAND_HOLDING_STATUSES;
}

export function occupiedStands(
  orders: readonly StandOccupant[],
  excludeOrderId?: string
): Map<StandCode, string> {
  const occupied = new Map<StandCode, string>();
  for (const order of orders) {
    if (!order.stand_code) continue;
    if (excludeOrderId && order.id === excludeOrderId) continue;
    if (!STAND_HOLDING_STATUSES.includes(order.status)) continue;
    // First writer wins in this map; the DB index guarantees there is only
    // ever one active holder in practice.
    if (!occupied.has(order.stand_code)) occupied.set(order.stand_code, order.id);
  }
  return occupied;
}

export function freeStands(
  orders: readonly StandOccupant[],
  excludeOrderId?: string
): StandCode[] {
  const occupied = occupiedStands(orders, excludeOrderId);
  return STAND_CODES.filter((code) => !occupied.has(code));
}

/**
 * Decides which stand an order should get.
 *
 * - `requested` given and free      -> allocated
 * - `requested` given and occupied  -> requested_occupied (order left unassigned,
 *                                      caller must show a visible warning and
 *                                      let the Admin resolve it manually)
 * - no `requested`                  -> first free stand, else none_available
 *
 * A stand is never silently reused.
 */
export function allocateStand(
  orders: readonly StandOccupant[],
  options: { requested?: StandCode | null; excludeOrderId?: string } = {}
): StandAllocationOutcome {
  const occupied = occupiedStands(orders, options.excludeOrderId);

  if (options.requested) {
    const holder = occupied.get(options.requested);
    if (holder) {
      return { kind: "requested_occupied", standCode: null, occupiedBy: holder };
    }
    return { kind: "allocated", standCode: options.requested };
  }

  const firstFree = STAND_CODES.find((code) => !occupied.has(code));
  if (!firstFree) return { kind: "none_available", standCode: null };
  return { kind: "allocated", standCode: firstFree };
}

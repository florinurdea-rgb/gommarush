/**
 * Transport lifecycle, expressed on TWO independent axes.
 *
 * This is the important structural decision in the feature. The spec's
 * lifecycle runs from "document received" to "delivered", but those states are
 * not one sequence -- they are two concurrent concerns:
 *
 *   INBOUND  how the goods reach our depot (we collect, or they ship to us)
 *   ORDER    what has happened to them since (sorted, loaded, delivered)
 *
 * The existing `orders.status` owns the second axis, and every dashboard
 * query, the delivery board, the driver app, gorush_set_order_status and
 * gorush_refresh_order_status all read it. Widening it with pickup states
 * would force each of those to learn about a leg they have no business
 * knowing, and would put two unrelated facts in one column.
 *
 * So the inbound leg gets its own column, `orders.inbound_status`, and
 * `orders.status` is left exactly as it is -- seventeen values, unchanged.
 *
 * The two axes join naturally, because the existing vocabulary already has the
 * word for "not here yet":
 *
 *   inbound_status = awaiting_pickup .. in_transit_to_depot  ->  status = expected
 *   inbound_status = arrived_at_depot                        ->  status = received
 *
 * `expected` has always meant "awaiting arrival at the warehouse", which is
 * true for the whole inbound leg regardless of who is moving the goods. That
 * is why this feature adds no status values at all.
 */

import type { OrderStatus } from "@/lib/types/logistics";

/** How the goods reach the depot. Decides which inbound chain applies. */
export const INBOUND_METHODS = [
  "GORUSH_PICKUP",
  "SUPPLIER_DELIVERY_TO_DEPOT",
  "THIRD_PARTY_CARRIER",
  "UNKNOWN",
] as const;

export type InboundMethod = (typeof INBOUND_METHODS)[number];

/**
 * The inbound axis.
 *
 * `not_required` exists for jobs that never had an inbound leg -- goods
 * already at the depot, or a manually created job. It is the default, so
 * existing rows and non-transport orders are correct without a backfill.
 *
 * `inbound_exception` is a real state rather than a flag: goods that failed to
 * be collected, arrived at the wrong depot, or were refused at pickup are
 * stuck in a way that needs operator attention, and a job sitting in
 * `awaiting_pickup` forever hides that.
 */
export const INBOUND_STATUSES = [
  "not_required",
  "awaiting_pickup",
  "pickup_assigned",
  "picked_up",
  "in_transit_to_depot",
  "supplier_delivery_expected",
  "arrived_at_depot",
  "inbound_exception",
] as const;

export type InboundStatus = (typeof INBOUND_STATUSES)[number];

/** Inbound states where the goods are not yet physically at the depot. */
export const PRE_DEPOT_INBOUND_STATUSES: readonly InboundStatus[] = [
  "awaiting_pickup",
  "pickup_assigned",
  "picked_up",
  "in_transit_to_depot",
  "supplier_delivery_expected",
];

export function isPreDepot(status: InboundStatus): boolean {
  return PRE_DEPOT_INBOUND_STATUSES.includes(status);
}

/** Inbound states that need someone to act, for the operations board. */
export function needsInboundAction(status: InboundStatus): boolean {
  return status === "awaiting_pickup" || status === "inbound_exception";
}

/**
 * The initial inbound status for a newly confirmed transport job.
 *
 *   Go Rush collects     -> awaiting_pickup            (we owe an action)
 *   Distributor delivers -> supplier_delivery_expected  (we wait)
 *   Third-party carrier  -> supplier_delivery_expected  (we wait)
 *   Not established      -> awaiting_pickup             (surfaces as "da verificare")
 *
 * UNKNOWN deliberately lands on awaiting_pickup rather than the waiting
 * state. If we cannot tell who moves the goods, the safe default is that WE
 * do: the failure mode is a wasted trip, whereas assuming the distributor
 * ships leaves tyres sitting at their depot for a week while both parties
 * wait for the other. A wasted trip is visible and cheap; silent waiting is
 * neither.
 */
export function initialInboundStatusFor(method: InboundMethod): InboundStatus {
  switch (method) {
    case "GORUSH_PICKUP":
      return "awaiting_pickup";
    case "SUPPLIER_DELIVERY_TO_DEPOT":
    case "THIRD_PARTY_CARRIER":
      return "supplier_delivery_expected";
    case "UNKNOWN":
      return "awaiting_pickup";
  }
}

/**
 * The order status a job starts in.
 *
 * Always `expected` for a transport job with an inbound leg: the goods are not
 * at the depot, which is exactly what `expected` has always meant. The board
 * shows it, the depot knows to look out for it, and no new status value is
 * needed.
 */
export function initialOrderStatusFor(inbound: InboundStatus): OrderStatus {
  return inbound === "arrived_at_depot" ? "received" : "expected";
}

/** Does this job still need the operator to establish who brings the goods? */
export function inboundNeedsConfirmation(method: InboundMethod): boolean {
  return method === "UNKNOWN";
}

/**
 * Allowed inbound transitions.
 *
 * Both chains converge on `arrived_at_depot`, and every non-terminal state can
 * reach `inbound_exception`, because anything can go wrong on a road.
 */
export const ALLOWED_INBOUND_TRANSITIONS: Readonly<Record<InboundStatus, readonly InboundStatus[]>> = {
  not_required: ["awaiting_pickup", "supplier_delivery_expected"],

  // Go Rush collects
  awaiting_pickup: ["pickup_assigned", "supplier_delivery_expected", "arrived_at_depot", "inbound_exception"],
  pickup_assigned: ["picked_up", "awaiting_pickup", "inbound_exception"],
  picked_up: ["in_transit_to_depot", "arrived_at_depot", "inbound_exception"],
  in_transit_to_depot: ["arrived_at_depot", "inbound_exception"],

  // Distributor or third party delivers
  supplier_delivery_expected: ["arrived_at_depot", "awaiting_pickup", "inbound_exception"],

  // Terminal for this axis: from here the order status takes over.
  arrived_at_depot: [],

  inbound_exception: [
    "awaiting_pickup",
    "pickup_assigned",
    "supplier_delivery_expected",
    "arrived_at_depot",
  ],
};

export function canTransitionInbound(from: InboundStatus, to: InboundStatus): boolean {
  return (ALLOWED_INBOUND_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * The spec's lifecycle names, and which axis each one lives on.
 *
 * `axis` says where the fact is stored, which is the whole point of the table:
 *   "inbound"   -- orders.inbound_status
 *   "order"     -- orders.status, unchanged from today
 *   "attribute" -- already a column; never duplicated as a status
 *   "ingestion" -- a state of the intake record, before any order exists
 */
export interface LifecycleMapping {
  spec: string;
  axis: "inbound" | "order" | "attribute" | "ingestion";
  value: InboundStatus | OrderStatus | null;
  note: string;
}

export const LIFECYCLE_MAP: readonly LifecycleMapping[] = [
  {
    spec: "DOCUMENT_RECEIVED",
    axis: "ingestion",
    value: null,
    note: "No order exists yet in Phase 1. Held on transport_document_ingestions.status.",
  },
  { spec: "AWAITING_PICKUP", axis: "inbound", value: "awaiting_pickup", note: "Go Rush must collect." },
  {
    spec: "SUPPLIER_DELIVERY_EXPECTED",
    axis: "inbound",
    value: "supplier_delivery_expected",
    note: "Distributor or third party delivers to the depot.",
  },
  { spec: "PICKUP_ASSIGNED", axis: "inbound", value: "pickup_assigned", note: "Van/driver assigned to collect." },
  { spec: "PICKED_UP", axis: "inbound", value: "picked_up", note: "Collected from the distributor." },
  { spec: "IN_TRANSIT_TO_DEPOT", axis: "inbound", value: "in_transit_to_depot", note: "On the way back." },
  {
    spec: "ARRIVED_AT_DEPOT",
    axis: "inbound",
    value: "arrived_at_depot",
    note: "Inbound axis terminal. orders.status moves to received (or partially_received when short).",
  },
  { spec: "STORED_SORTED", axis: "order", value: "stored", note: "Existing. Passes through sorting." },
  { spec: "READY_FOR_ASSIGNMENT", axis: "order", value: "ready_for_loading", note: "Existing." },
  {
    spec: "ASSIGNED_TO_VAN",
    axis: "attribute",
    value: null,
    note: "orders.vehicle_id. Assignment is not a status -- the board reads the FK.",
  },
  { spec: "LOADED", axis: "order", value: "loaded", note: "Existing. partially_loaded when split." },
  { spec: "OUT_FOR_DELIVERY", axis: "order", value: "out_for_delivery", note: "Existing." },
  { spec: "DELIVERED", axis: "order", value: "delivered", note: "Existing." },
  {
    spec: "DELIVERY_FAILED",
    axis: "attribute",
    value: null,
    note: "orders.delivery_failed_at + delivery_failure_reason, set by gorush_mark_delivery_failed.",
  },
  {
    spec: "RETURN_TO_DEPOT",
    axis: "attribute",
    value: null,
    note: "A failed delivery keeps orders.status and sets delivery_failed_at; the goods return with the van. No new value needed.",
  },
  { spec: "RETURNED", axis: "order", value: "returned", note: "Existing. Terminal." },
  { spec: "CANCELLED", axis: "order", value: "cancelled", note: "Existing. Terminal." },
];

/**
 * The event kinds written to the immutable tracking log.
 *
 * Status changes are only part of it. History must never be inferred from the
 * current status alone, so quantity reconciliation, zone assignment and
 * payment collection each emit their own event even when neither status moves.
 */
export const TRANSPORT_EVENT_KINDS = [
  "INGESTION_CONFIRMED",
  "ORDER_STATUS_CHANGED",
  "INBOUND_STATUS_CHANGED",
  "PICKUP_ASSIGNED",
  "ARRIVAL_RECORDED",
  "QUANTITY_RECONCILED",
  "ZONE_ASSIGNED",
  "VEHICLE_ASSIGNED",
  "PAYMENT_COLLECTED",
  "DELIVERY_FAILED",
  "EXCEPTION_RAISED",
  "NOTE_ADDED",
] as const;

export type TransportEventKind = (typeof TRANSPORT_EVENT_KINDS)[number];

/** Who caused an event. Recorded explicitly so history is attributable. */
export const TRANSPORT_ACTOR_TYPES = ["OPERATOR", "DRIVER", "SYSTEM", "WAREHOUSE"] as const;

export type TransportActorType = (typeof TRANSPORT_ACTOR_TYPES)[number];

/** The business type this feature creates. Never inferred from a supplier name. */
export const TRANSPORT_BUSINESS_TYPE = "TRANSPORT_JOB" as const;

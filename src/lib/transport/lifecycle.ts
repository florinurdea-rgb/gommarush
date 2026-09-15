/**
 * Transport lifecycle: the spec's operational vocabulary mapped onto the
 * statuses this application already runs on.
 *
 * The rule followed here is "do not create a second status system". The
 * delivery board, the driver app, `gorush_set_order_status`,
 * `gorush_refresh_order_status` and every dashboard query all read
 * `orders.status`. So the spec's lifecycle is expressed as:
 *
 *   - EXISTING status values wherever the meaning already matches
 *   - FIVE new values, only for the inbound leg, which genuinely has no
 *     representation today (the system currently begins at "expected at
 *     depot" and has no concept of Go Rush collecting from a distributor)
 *   - DERIVED states for things the schema already models as attributes
 *     rather than statuses (a failed delivery is `delivery_failed_at` plus
 *     `delivery_failure_reason`, driven by the existing
 *     gorush_mark_delivery_failed RPC -- adding a parallel status value for
 *     it would put the same fact in two places)
 */

import type { OrderStatus } from "@/lib/types/logistics";

/** How the goods reach the depot. Decides which inbound status chain applies. */
export const INBOUND_METHODS = [
  "GORUSH_PICKUP",
  "SUPPLIER_DELIVERY_TO_DEPOT",
  "THIRD_PARTY_CARRIER",
  "UNKNOWN",
] as const;

export type InboundMethod = (typeof INBOUND_METHODS)[number];

/**
 * The five statuses this feature adds, all on the inbound leg.
 *
 * `return_to_depot` is included because the existing model has only the
 * terminal `returned`; the spec needs the in-between state where goods are
 * on the van heading back after a failed delivery.
 */
export const NEW_TRANSPORT_STATUSES = [
  "awaiting_pickup",
  "pickup_assigned",
  "picked_up",
  "in_transit_to_depot",
  "return_to_depot",
] as const;

export type NewTransportStatus = (typeof NEW_TRANSPORT_STATUSES)[number];

/** Every status a transport job can hold: the existing vocabulary plus the five above. */
export type TransportStatus = OrderStatus | NewTransportStatus;

/**
 * The spec's lifecycle names, and what each one actually is in this system.
 *
 * `kind` matters:
 *   "status"    -- a value stored in orders.status
 *   "attribute" -- already modelled as a column; never duplicated as a status
 *   "ingestion" -- a state of the intake record, before any order exists
 */
export interface LifecycleMapping {
  spec: string;
  kind: "status" | "attribute" | "ingestion";
  status: TransportStatus | null;
  note: string;
}

export const LIFECYCLE_MAP: readonly LifecycleMapping[] = [
  {
    spec: "DOCUMENT_RECEIVED",
    kind: "ingestion",
    status: null,
    note: "No order exists yet in Phase 1. Held on transport_document_ingestions.status.",
  },
  { spec: "AWAITING_PICKUP", kind: "status", status: "awaiting_pickup", note: "NEW. Go Rush must collect." },
  {
    spec: "SUPPLIER_DELIVERY_EXPECTED",
    kind: "status",
    status: "expected",
    note: "Existing. Distributor delivers to the depot.",
  },
  { spec: "PICKUP_ASSIGNED", kind: "status", status: "pickup_assigned", note: "NEW. Van/driver assigned to collect." },
  { spec: "PICKED_UP", kind: "status", status: "picked_up", note: "NEW. Collected from the distributor." },
  { spec: "IN_TRANSIT_TO_DEPOT", kind: "status", status: "in_transit_to_depot", note: "NEW. On the way back." },
  { spec: "ARRIVED_AT_DEPOT", kind: "status", status: "received", note: "Existing. partially_received when short." },
  { spec: "STORED_SORTED", kind: "status", status: "stored", note: "Existing. Passes through sorting." },
  { spec: "READY_FOR_ASSIGNMENT", kind: "status", status: "ready_for_loading", note: "Existing." },
  {
    spec: "ASSIGNED_TO_VAN",
    kind: "attribute",
    status: null,
    note: "orders.vehicle_id. Assignment is not a status -- the board reads the FK.",
  },
  { spec: "LOADED", kind: "status", status: "loaded", note: "Existing. partially_loaded when split." },
  { spec: "OUT_FOR_DELIVERY", kind: "status", status: "out_for_delivery", note: "Existing." },
  { spec: "DELIVERED", kind: "status", status: "delivered", note: "Existing." },
  {
    spec: "DELIVERY_FAILED",
    kind: "attribute",
    status: null,
    note: "orders.delivery_failed_at + delivery_failure_reason, set by gorush_mark_delivery_failed.",
  },
  { spec: "RETURN_TO_DEPOT", kind: "status", status: "return_to_depot", note: "NEW. Goods coming back on the van." },
  { spec: "RETURNED", kind: "status", status: "returned", note: "Existing. Terminal." },
  { spec: "CANCELLED", kind: "status", status: "cancelled", note: "Existing. Terminal." },
];

/**
 * The initial status for a newly confirmed transport job.
 *
 * This is the one decision that determines whether the depot sees the job at
 * all, so it is derived from the inbound method rather than defaulted:
 *
 *   Go Rush collects        -> awaiting_pickup       (we owe an action)
 *   Distributor delivers    -> expected              (we wait)
 *   Third-party carrier     -> expected              (we wait)
 *   Not established         -> awaiting_pickup       (surfaces as "da verificare")
 *
 * UNKNOWN deliberately lands on awaiting_pickup rather than expected: if we
 * cannot tell who moves the goods, the safe default is that WE do, because
 * the failure mode is a wasted trip rather than tyres sitting at the
 * distributor for a week while both parties wait for the other.
 */
export function initialStatusFor(method: InboundMethod): TransportStatus {
  switch (method) {
    case "GORUSH_PICKUP":
      return "awaiting_pickup";
    case "SUPPLIER_DELIVERY_TO_DEPOT":
    case "THIRD_PARTY_CARRIER":
      return "expected";
    case "UNKNOWN":
      return "awaiting_pickup";
  }
}

/** Does this job still need the operator to establish who brings the goods? */
export function inboundNeedsConfirmation(method: InboundMethod): boolean {
  return method === "UNKNOWN";
}

/**
 * Allowed forward transitions. Kept explicit rather than derived from an
 * ordering, because the two inbound chains converge and several statuses have
 * more than one legitimate successor.
 *
 * Not exhaustive of the whole app -- it governs the transport lifecycle only,
 * and existing RPCs remain the authority for the statuses they already own.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<TransportStatus, readonly TransportStatus[]>> = {
  draft: ["review_required", "awaiting_pickup", "expected", "cancelled"],
  review_required: ["awaiting_pickup", "expected", "cancelled"],
  confirmed: ["awaiting_pickup", "expected", "cancelled"],

  // Inbound leg -- Go Rush collects
  awaiting_pickup: ["pickup_assigned", "expected", "on_hold", "cancelled"],
  pickup_assigned: ["picked_up", "awaiting_pickup", "on_hold", "cancelled"],
  picked_up: ["in_transit_to_depot", "received", "partially_received", "on_hold"],
  in_transit_to_depot: ["received", "partially_received", "on_hold"],

  // Inbound leg -- distributor or third party delivers
  expected: ["received", "partially_received", "awaiting_pickup", "on_hold", "cancelled"],

  // Shared depot leg
  partially_received: ["received", "sorting", "on_hold"],
  received: ["sorting", "stored", "on_hold"],
  sorting: ["stored", "on_hold"],
  stored: ["ready_for_loading", "sorting", "on_hold"],
  ready_for_loading: ["loaded", "partially_loaded", "stored", "on_hold"],
  partially_loaded: ["loaded", "out_for_delivery", "ready_for_loading"],
  loaded: ["out_for_delivery", "ready_for_loading"],
  out_for_delivery: ["delivered", "partially_delivered", "return_to_depot"],
  partially_delivered: ["delivered", "return_to_depot"],

  // Terminal and exception
  delivered: [],
  return_to_depot: ["stored", "returned", "ready_for_loading"],
  returned: [],
  on_hold: [
    "awaiting_pickup",
    "expected",
    "received",
    "sorting",
    "stored",
    "ready_for_loading",
    "cancelled",
  ],
  cancelled: [],
};

export function canTransition(from: TransportStatus, to: TransportStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Statuses on the inbound leg, i.e. the goods are not yet at the depot. */
export const PRE_DEPOT_STATUSES: readonly TransportStatus[] = [
  "awaiting_pickup",
  "pickup_assigned",
  "picked_up",
  "in_transit_to_depot",
  "expected",
];

export function isPreDepot(status: TransportStatus): boolean {
  return PRE_DEPOT_STATUSES.includes(status);
}

/**
 * The event kinds written to the immutable tracking log.
 *
 * Status changes are only part of it: the spec requires that history is never
 * inferred from the current status alone, so quantity reconciliation, zone
 * assignment and payment collection each emit their own event even when the
 * status does not move.
 */
export const TRANSPORT_EVENT_KINDS = [
  "STATUS_CHANGED",
  "INGESTION_CONFIRMED",
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

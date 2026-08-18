import type { OrderStatus } from "@/lib/types/logistics";

/**
 * The Kanban board's 5-bucket operational status — a presentation-layer
 * simplification of the 17-value `OrderStatus` enum, not a new source of
 * truth. Nothing is written back from this; it only groups existing
 * statuses for a glance-able card badge. The full granular status still
 * shows in the order detail drawer via OrderStatusBadge.
 */

export type OperationalBucket = "waiting_goods" | "receiving" | "to_prepare" | "ready" | "problem";

export interface OperationalStatusMeta {
  bucket: OperationalBucket;
  emoji: string;
  label: string;
  tone: "waiting" | "progress" | "success" | "danger";
}

const BUCKET_BY_STATUS: Partial<Record<OrderStatus, OperationalBucket>> = {
  draft: "waiting_goods",
  review_required: "waiting_goods",
  confirmed: "waiting_goods",
  expected: "waiting_goods",
  partially_received: "receiving",
  received: "receiving",
  sorting: "to_prepare",
  stored: "to_prepare",
  ready_for_loading: "to_prepare",
  partially_loaded: "to_prepare",
  loaded: "ready",
  out_for_delivery: "ready",
  partially_delivered: "ready",
  delivered: "ready",
  on_hold: "waiting_goods",
};

const BUCKET_META: Record<OperationalBucket, Omit<OperationalStatusMeta, "bucket">> = {
  waiting_goods: { emoji: "🟠", label: "Așteaptă marfa", tone: "waiting" },
  receiving: { emoji: "🔵", label: "În recepție", tone: "progress" },
  to_prepare: { emoji: "🟣", label: "De pregătit", tone: "progress" },
  ready: { emoji: "🟢", label: "Gata de livrare", tone: "success" },
  problem: { emoji: "🔴", label: "Problemă", tone: "danger" },
};

/**
 * `hasProblem` (derived from an order's inventory units being in an
 * incident state — see OrderProgress.problem) always wins: a delivery
 * with a damaged/missing unit is a problem regardless of where it sits in
 * the normal flow.
 */
export function operationalStatus(status: OrderStatus, hasProblem: boolean): OperationalStatusMeta {
  if (hasProblem) return { bucket: "problem", ...BUCKET_META.problem };
  const bucket = BUCKET_BY_STATUS[status] ?? "to_prepare";
  return { bucket, ...BUCKET_META[bucket] };
}

export const OPERATIONAL_BUCKETS: OperationalBucket[] = ["waiting_goods", "receiving", "to_prepare", "ready", "problem"];

export function operationalBucketMeta(bucket: OperationalBucket): Omit<OperationalStatusMeta, "bucket"> {
  return BUCKET_META[bucket];
}

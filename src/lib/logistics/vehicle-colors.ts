import type { VehicleColorKey } from "@/lib/types/logistics";

/**
 * The fleet's per-van accent palette (redesign brief §27) — a subtle
 * identifying color used only for small header accents, never a saturated
 * column background. Shared across the fleet management sheet, the Consegne
 * board's lane headers, and Sumar's vehicle tabs so the same van always
 * reads as the same color everywhere.
 */
export const VAN_DOT_CLASS: Record<VehicleColorKey | "default", string> = {
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  teal: "bg-teal-500",
  indigo: "bg-indigo-500",
  slate: "bg-slate-400",
  cyan: "bg-cyan-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  default: "bg-state-neutral",
};

export const VAN_BORDER_CLASS: Record<VehicleColorKey | "default", string> = {
  blue: "border-t-blue-500",
  purple: "border-t-purple-500",
  teal: "border-t-teal-500",
  indigo: "border-t-indigo-500",
  slate: "border-t-slate-400",
  cyan: "border-t-cyan-500",
  rose: "border-t-rose-500",
  amber: "border-t-amber-500",
  default: "border-t-state-neutral",
};

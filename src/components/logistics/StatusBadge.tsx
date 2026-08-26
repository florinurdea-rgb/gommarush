"use client";

import type { StatusTone } from "@/lib/i18n/logistics";
import { useOps } from "@/lib/i18n/ops";

/**
 * Status chips. Colour comes from the semantic tone in the translation map, so
 * no component ever hardcodes a palette or a Romanian string.
 */

const toneClasses: Record<StatusTone, string> = {
  neutral: "bg-state-neutral-soft text-state-neutral",
  waiting: "bg-state-waiting-soft text-state-waiting",
  progress: "bg-state-progress-soft text-state-progress",
  success: "bg-state-success-soft text-state-success",
  warning: "bg-state-warning-soft text-state-warning",
  danger: "bg-state-danger-soft text-state-danger",
};

interface BadgeProps {
  label: string;
  tone: StatusTone;
  size?: "sm" | "md";
  className?: string;
}

export function Badge({ label, tone, size = "md", className = "" }: BadgeProps) {
  const sizeClass = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md font-semibold ${toneClasses[tone]} ${sizeClass} ${className}`}
    >
      {label}
    </span>
  );
}

export function OrderStatusBadge({ status, size }: { status: string; size?: "sm" | "md" }) {
  const meta = useOps().orderStatusMeta(status);
  return <Badge label={meta.label} tone={meta.tone} size={size} />;
}

export function UnitStatusBadge({ status, size }: { status: string; size?: "sm" | "md" }) {
  const meta = useOps().unitStatusMeta(status);
  return <Badge label={meta.label} tone={meta.tone} size={size} />;
}


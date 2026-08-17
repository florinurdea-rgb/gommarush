import { t } from "@/lib/i18n/logistics";
import type { StandCode } from "@/lib/types/logistics";

/**
 * The stand letter — the single most important thing on a warehouse screen.
 *
 * It is always rendered as a big, high-contrast letter rather than text in a
 * sentence, because an operator reads it at a glance while holding a tyre. This
 * is a temporary SORTING STAND (A–E), never a warehouse zone.
 */

interface StandBadgeProps {
  standCode: StandCode | null;
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
}

const sizeClasses = {
  sm: "h-8 w-8 text-lg rounded-md",
  md: "h-12 w-12 text-2xl rounded-lg",
  lg: "h-20 w-20 text-5xl rounded-xl",
  hero: "h-56 w-56 text-stand rounded-3xl sm:h-64 sm:w-64",
};

export function StandBadge({ standCode, size = "md", className = "" }: StandBadgeProps) {
  if (!standCode) {
    return (
      <span
        className={`inline-flex items-center justify-center border-2 border-dashed border-state-warning/50 bg-state-warning-soft font-black text-state-warning ${sizeClasses[size]} ${className}`}
        // Unassigned is a real operational state, not a blank — it must be
        // visibly wrong so someone fixes it.
        title={t("unassigned")}
        aria-label={t("unassigned")}
      >
        ?
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center bg-ink font-black tabular-nums text-white ${sizeClasses[size]} ${className}`}
      aria-label={`${t("stand")} ${standCode}`}
    >
      {standCode}
    </span>
  );
}

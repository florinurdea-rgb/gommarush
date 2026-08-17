import type { OrderProgress } from "@/lib/logistics/order-progress";

/**
 * Physical progress for an order: how many of its objects are stored, and how
 * many are loaded. Derived entirely from unit statuses (see order-progress.ts) —
 * never from a separate counter that could drift.
 */

interface ProgressBarProps {
  progress: OrderProgress;
  /** 'stored' during receiving, 'loaded' during van loading. */
  metric?: "stored" | "loaded";
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({
  progress,
  metric = "stored",
  showLabel = true,
  className = "",
}: ProgressBarProps) {
  const value = metric === "loaded" ? progress.loaded : progress.stored;
  const percent = metric === "loaded" ? progress.loadedPercent : progress.storedPercent;
  const complete = progress.total > 0 && value === progress.total;

  return (
    <div className={className}>
      <div className="flex items-baseline gap-2">
        {showLabel && (
          <span
            className={`font-mono text-sm font-bold tabular-nums ${
              complete ? "text-state-success" : "text-ink"
            }`}
          >
            {value}/{progress.total}
          </span>
        )}
        {progress.problem > 0 && (
          <span className="text-xs font-semibold text-state-danger">
            {progress.problem} cu probleme
          </span>
        )}
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-state-neutral-soft"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${
            complete ? "bg-state-success" : "bg-state-progress"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { t } from "@/lib/i18n/logistics";
import type { ScanOutcome } from "@/components/logistics/DriverConsole";

/**
 * The full-screen verdict after a scan.
 *
 * Design intent: readable across a warehouse aisle in under a second. The stand
 * letter dominates on success because that is the one thing the operator must
 * act on — which rack to walk to. Errors are red, full-bleed, and require an
 * explicit dismissal so they cannot be missed.
 *
 * Successes auto-dismiss after a moment so a receiving run doesn't need a tap
 * between every tyre; errors never do.
 */
export function ScanResultScreen({
  outcome,
  onDismiss,
}: {
  outcome: ScanOutcome;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (outcome.tone !== "success") return;
    const timer = window.setTimeout(onDismiss, 3500);
    return () => window.clearTimeout(timer);
  }, [outcome, onDismiss]);

  const background =
    outcome.tone === "success"
      ? "bg-state-success"
      : outcome.tone === "warning"
        ? "bg-state-warning"
        : "bg-state-danger";

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={outcome.title}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center text-white ${background}`}
      onClick={onDismiss}
    >
      <div className="text-3xl font-black tracking-tight sm:text-4xl">
        {outcome.tone === "success" && "✓ "}
        {outcome.title}
      </div>

      {outcome.detail && (
        <p className="mt-2 max-w-md text-lg font-semibold opacity-90">{outcome.detail}</p>
      )}

      {outcome.orderNumber && (
        <div className="mt-6 font-mono text-2xl font-bold opacity-90">{outcome.orderNumber}</div>
      )}
      {outcome.customer && (
        <div className="mt-1 text-2xl font-extrabold uppercase">{outcome.customer}</div>
      )}
      {outcome.product && (
        <div className="mt-1 max-w-md text-lg font-semibold opacity-90">{outcome.product}</div>
      )}

      {/* The stand letter: the single most important instruction on this
          screen, so it is rendered as large as the viewport allows. */}
      {outcome.standCode && (
        <div className="mt-8">
          <div className="text-sm font-bold uppercase tracking-[0.3em] opacity-80">
            {t("stand")}
          </div>
          <div className="text-stand-sm font-black leading-none sm:text-stand">
            {outcome.standCode}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onDismiss}
        className="mt-10 min-h-14 rounded-xl bg-white/20 px-10 text-lg font-bold"
      >
        OK
      </button>
    </div>
  );
}

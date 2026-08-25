"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { errorMessage, t } from "@/lib/i18n/logistics";

/**
 * Per-order actions: Edit, Move to hold / Reactivate, and Delete.
 *
 * "Delete" stays visibly accessible as the brief requires, but it always
 * requires an explicit confirmation and it performs a SAFE CANCELLATION — the
 * order is marked `cancelled` and leaves the active list, while its items,
 * inventory units and scan history are preserved. The dialog says so.
 */
export function OrderActionsMenu({
  orderId,
  orderLabel,
  variant,
}: {
  orderId: string;
  orderLabel: string;
  variant: "active" | "hold";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function act(action: "hold" | "reactivate" | "cancel", reason?: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason: reason ?? null }),
      });
      const payload = (await response.json()) as { ok: boolean; code?: string };

      if (!payload.ok) {
        setError(errorMessage(payload.code));
        return;
      }
      setOpen(false);
      setConfirmingDelete(false);
      router.refresh();
    } catch {
      setError(errorMessage("UNKNOWN"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("actions")} ${orderLabel}`}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink/15 bg-white text-ink hover:bg-surface-soft"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
          <circle cx="10" cy="4" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="10" cy="16" r="1.6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-xl border border-ink/10 bg-white py-1 shadow-modal"
        >
          <Link
            role="menuitem"
            href={`/admin/orders/${orderId}`}
            className="block px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface-soft"
          >
            {t("edit")}
          </Link>

          {variant === "active" ? (
            <button
              role="menuitem"
              type="button"
              disabled={busy}
              onClick={() => act("hold")}
              className="block w-full px-4 py-2.5 text-left text-sm font-medium text-ink hover:bg-surface-soft disabled:opacity-50"
            >
              {t("moveToHold")}
            </button>
          ) : (
            <button
              role="menuitem"
              type="button"
              disabled={busy}
              onClick={() => act("reactivate")}
              className="block w-full px-4 py-2.5 text-left text-sm font-medium text-state-success hover:bg-surface-soft disabled:opacity-50"
            >
              {t("reactivate")}
            </button>
          )}

          <div className="my-1 border-t border-ink/10" />

          {!confirmingDelete ? (
            <button
              role="menuitem"
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="block w-full px-4 py-2.5 text-left text-sm font-medium text-state-danger hover:bg-state-danger-soft"
            >
              {t("delete")}
            </button>
          ) : (
            <div className="px-4 py-3">
              <p className="text-sm font-semibold text-ink">Anulezi {orderLabel}?</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                L&apos;ordine verrà segnato <strong>Annullato</strong> e tolto dalla lista
                attiva. Prodotti, articoli fisici e storico delle scansioni vengono
                conservati.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act("cancel", "admin_delete")}
                  className="flex-1 rounded-lg bg-state-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {t("confirm")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm font-semibold text-ink"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="px-4 py-2 text-xs font-medium text-state-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

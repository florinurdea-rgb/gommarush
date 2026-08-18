"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";

/**
 * The compact per-card menu on a vehicle-board order card: Editează, Șterge,
 * and "Asignează în ruta recomandată". Deliberately lighter than
 * OrderActionsMenu (no hold/reactivate — cards on this board are always
 * active) and takes the route-suggestion action as a callback since only the
 * board knows about every vehicle's current load.
 */
export function VehicleCardActionsMenu({
  orderId,
  orderLabel,
  onAssignRecommended,
}: {
  orderId: string;
  orderLabel: string;
  onAssignRecommended: () => void;
}) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setConfirmingDelete(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setConfirmingDelete(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function deleteOrder() {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", reason: "admin_delete" }),
      });
      const payload = (await response.json()) as { ok: boolean };
      if (payload.ok) {
        showToast(`Comandă anulată — ${orderLabel}.`, "success");
        window.location.reload();
      } else {
        showToast("Ștergerea nu a putut fi salvată.", "error");
      }
    } catch {
      showToast("Eroare de rețea.", "error");
    } finally {
      setBusy(false);
      setOpen(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Acțiuni ${orderLabel}`}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-surface-soft hover:text-ink"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
          <circle cx="10" cy="4" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="10" cy="16" r="1.5" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-xl border border-ink/10 bg-white py-1 shadow-modal"
        >
          <Link
            role="menuitem"
            href={`/admin/orders/${orderId}`}
            className="block px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface-soft"
          >
            Editează
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onAssignRecommended();
            }}
            className="block w-full px-4 py-2.5 text-left text-sm font-medium text-accent hover:bg-surface-soft"
          >
            Asignează în ruta recomandată
          </button>

          <div className="my-1 border-t border-ink/10" />

          {!confirmingDelete ? (
            <button
              role="menuitem"
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="block w-full px-4 py-2.5 text-left text-sm font-medium text-state-danger hover:bg-state-danger-soft"
            >
              Șterge
            </button>
          ) : (
            <div className="px-4 py-3">
              <p className="text-sm font-semibold text-ink">Anulezi {orderLabel}?</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteOrder()}
                  className="flex-1 rounded-lg bg-state-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Confirmă
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm font-semibold text-ink"
                >
                  Anulează
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

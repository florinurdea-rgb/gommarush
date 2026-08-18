"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { orderStatusMeta } from "@/lib/i18n/logistics";
import { ACTIVE_ORDER_STATUSES } from "@/lib/types/logistics";
import type { OrderStatus } from "@/lib/types/logistics";

export interface MoveTarget {
  key: string;
  name: string;
}

/**
 * The compact per-card menu on a vehicle-board order card: Editează,
 * "Asignează în ruta recomandată", "Mută în..." (a tap-friendly alternative
 * to drag-and-drop — the brief calls for it explicitly since native HTML5
 * drag is unreliable on touch), "Schimbă statusul" (manual override — the
 * admin needs to be able to correct or advance a status directly, any time
 * before the order closes, without walking every intermediate scan step),
 * and Șterge. Deliberately lighter than OrderActionsMenu (no hold/reactivate
 * — cards on this board are always active) and takes the route-suggestion/
 * move actions as callbacks since only the board knows about every
 * vehicle's current load and columns.
 *
 * "Schimbă statusul" is restricted to ACTIVE_ORDER_STATUSES (open/
 * in-progress statuses) — 'delivered' has its own confirmation flow
 * (updates inventory_units too, which this can't) and 'cancelled' already
 * has Șterge below; setOrderStatusManually() on the server enforces the
 * same restriction independently, so this is a UI convenience, not the
 * only gate.
 */
export function VehicleCardActionsMenu({
  orderId,
  orderLabel,
  currentStatus,
  moveTargets,
  onAssignRecommended,
  onMoveTo,
}: {
  orderId: string;
  orderLabel: string;
  currentStatus: OrderStatus;
  /** Other columns this card could move to — excludes the one it's already in. */
  moveTargets: MoveTarget[];
  onAssignRecommended: () => void;
  onMoveTo: (targetKey: string) => void;
}) {
  const { showToast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [movingOpen, setMovingOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
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
        setMovingOpen(false);
        setStatusMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function changeStatus(status: OrderStatus) {
    setOpen(false);
    setStatusMenuOpen(false);
    if (status === currentStatus) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set_status", status }),
      });
      const payload = (await response.json()) as { ok: boolean; code?: string; details?: string[] };
      if (payload.ok) {
        showToast(`Status actualizat — ${orderStatusMeta(status).label}.`, "success");
        router.refresh();
      } else {
        const detail = [payload.code, ...(payload.details ?? [])].filter(Boolean).join(" — ");
        showToast(`Statusul nu a putut fi salvat.${detail ? ` (${detail})` : ""}`, "error");
      }
    } catch {
      showToast("Eroare de rețea.", "error");
    } finally {
      setBusy(false);
    }
  }

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
        router.refresh();
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

          {moveTargets.length > 0 && (
            <>
              <button
                role="menuitem"
                type="button"
                onClick={() => setMovingOpen((value) => !value)}
                aria-expanded={movingOpen}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-ink hover:bg-surface-soft"
              >
                Mută în…
                <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${movingOpen ? "rotate-90" : ""}`} fill="currentColor" aria-hidden="true">
                  <path d="M7 5l6 5-6 5V5z" />
                </svg>
              </button>
              {movingOpen && (
                <div className="bg-surface-soft py-1">
                  {moveTargets.map((target) => (
                    <button
                      key={target.key}
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setMovingOpen(false);
                        onMoveTo(target.key);
                      }}
                      className="block w-full px-6 py-2 text-left text-sm text-ink hover:bg-white"
                    >
                      {target.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <button
            role="menuitem"
            type="button"
            onClick={() => setStatusMenuOpen((value) => !value)}
            aria-expanded={statusMenuOpen}
            disabled={busy}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-ink hover:bg-surface-soft disabled:opacity-50"
          >
            Schimbă statusul
            <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${statusMenuOpen ? "rotate-90" : ""}`} fill="currentColor" aria-hidden="true">
              <path d="M7 5l6 5-6 5V5z" />
            </svg>
          </button>
          {statusMenuOpen && (
            <div className="max-h-64 overflow-y-auto bg-surface-soft py-1">
              {ACTIVE_ORDER_STATUSES.map((status) => {
                const meta = orderStatusMeta(status);
                const isCurrent = status === currentStatus;
                return (
                  <button
                    key={status}
                    role="menuitem"
                    type="button"
                    disabled={isCurrent}
                    onClick={() => void changeStatus(status)}
                    className={`block w-full px-6 py-2 text-left text-sm ${
                      isCurrent ? "font-bold text-ink" : "text-ink hover:bg-white"
                    }`}
                  >
                    {meta.label}
                    {isCurrent && " ✓"}
                  </button>
                );
              })}
            </div>
          )}

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

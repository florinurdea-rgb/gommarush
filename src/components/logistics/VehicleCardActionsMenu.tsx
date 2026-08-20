"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { orderStatusMeta } from "@/lib/i18n/logistics";
import { MANUALLY_SETTABLE_STATUSES } from "@/lib/logistics/order-status-rules";
import type { OrderStatus } from "@/lib/types/logistics";

export interface MoveTarget {
  key: string;
  name: string;
}

/**
 * The compact per-card menu on a vehicle-board order card: Editează,
 * "Asignează în ruta recomandată", "Mută în..." (a tap-friendly alternative
 * to drag-and-drop — the brief calls for it explicitly since native HTML5
 * drag is unreliable on touch), Marchează încărcată / Marchează livrată /
 * Livrare eșuată (the Phase 1 order-level dispatch actions — no tyre
 * scanning), "Schimbă statusul" (manual override for everything else), and
 * Șterge. Deliberately lighter than OrderActionsMenu (no hold/reactivate —
 * cards on this board are always active) and takes the route-suggestion/
 * move actions as callbacks since only the board knows about every
 * vehicle's current load and columns.
 *
 * "Schimbă statusul" only lists MANUALLY_SETTABLE_STATUSES (see
 * src/lib/logistics/order-status-rules.ts, shared with the server-side
 * gate in setOrderStatusManually()) — 'loaded'/'delivered'/
 * 'partially_delivered' have their own dedicated actions above instead,
 * since each carries a required side effect (vehicle assignment + loaded_at,
 * or delivered_at + payment recording) a plain status write would skip.
 */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Numerar",
  card: "Card",
  bank_transfer: "Transfer bancar",
  already_paid: "Deja achitat",
  other: "Altă metodă",
};

export function VehicleCardActionsMenu({
  orderId,
  orderLabel,
  currentStatus,
  hasVehicle,
  amountToCollect,
  cashOnDelivery,
  moveTargets,
  onAssignRecommended,
  onMoveTo,
}: {
  orderId: string;
  orderLabel: string;
  currentStatus: OrderStatus;
  /** Whether this card's order already has a vehicle assigned (i.e. not in "Neasignate"). */
  hasVehicle: boolean;
  amountToCollect?: number | null;
  cashOnDelivery?: boolean;
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
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const [amountCollected, setAmountCollected] = useState(
    amountToCollect != null ? String(amountToCollect) : ""
  );
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [failureReason, setFailureReason] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const canMarkLoaded = hasVehicle && (currentStatus === "stored" || currentStatus === "ready_for_loading");
  const canDeliver = currentStatus === "loaded" || currentStatus === "out_for_delivery";

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
        setDeliverOpen(false);
        setFailedOpen(false);
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

  async function runDispatchAction(
    body: Record<string, unknown>,
    successMessage: string
  ): Promise<boolean> {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { ok: boolean; code?: string };
      if (payload.ok) {
        showToast(successMessage, "success");
        router.refresh();
        return true;
      }
      showToast(`Acțiunea nu a putut fi salvată.${payload.code ? ` (${payload.code})` : ""}`, "error");
      return false;
    } catch {
      showToast("Eroare de rețea.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function markLoaded() {
    setOpen(false);
    await runDispatchAction({ action: "mark_loaded" }, `Marcată ca încărcată — ${orderLabel}.`);
  }

  async function confirmDeliver() {
    const trimmed = amountCollected.trim();
    const parsedAmount = trimmed.length > 0 ? Number(trimmed) : null;
    const ok = await runDispatchAction(
      {
        action: "deliver",
        amount_collected: parsedAmount != null && Number.isFinite(parsedAmount) ? parsedAmount : null,
        payment_method: trimmed.length > 0 ? paymentMethod : null,
      },
      `Comandă livrată — ${orderLabel}.`
    );
    if (ok) {
      setOpen(false);
      setDeliverOpen(false);
    }
  }

  async function confirmDeliveryFailed() {
    if (failureReason.trim().length < 3) {
      showToast("Motivul este obligatoriu.", "error");
      return;
    }
    const ok = await runDispatchAction(
      { action: "delivery_failed", reason: failureReason.trim() },
      `Livrare eșuată înregistrată — ${orderLabel}.`
    );
    if (ok) {
      setOpen(false);
      setFailedOpen(false);
      setFailureReason("");
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

          {canMarkLoaded && (
            <button
              role="menuitem"
              type="button"
              disabled={busy}
              onClick={() => void markLoaded()}
              className="block w-full px-4 py-2.5 text-left text-sm font-medium text-state-success hover:bg-surface-soft disabled:opacity-50"
            >
              Marchează încărcată
            </button>
          )}

          {canDeliver && !deliverOpen && (
            <button
              role="menuitem"
              type="button"
              disabled={busy}
              onClick={() => {
                setFailedOpen(false);
                setDeliverOpen(true);
              }}
              className="block w-full px-4 py-2.5 text-left text-sm font-medium text-state-success hover:bg-surface-soft disabled:opacity-50"
            >
              Marchează livrată
            </button>
          )}
          {canDeliver && deliverOpen && (
            <div className="space-y-2 bg-surface-soft px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Confirmă livrarea
              </p>
              {cashOnDelivery && (
                <>
                  <label className="block text-xs font-medium text-ink-soft">
                    Sumă încasată (€)
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={amountCollected}
                      onChange={(event) => setAmountCollected(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-ink/15 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value)}
                    className="w-full rounded-lg border border-ink/15 px-2 py-1.5 text-sm"
                  >
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmDeliver()}
                  className="flex-1 rounded-lg bg-state-success px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Confirmă
                </button>
                <button
                  type="button"
                  onClick={() => setDeliverOpen(false)}
                  className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm font-semibold text-ink"
                >
                  Anulează
                </button>
              </div>
            </div>
          )}

          {canDeliver && !failedOpen && (
            <button
              role="menuitem"
              type="button"
              disabled={busy}
              onClick={() => {
                setDeliverOpen(false);
                setFailedOpen(true);
              }}
              className="block w-full px-4 py-2.5 text-left text-sm font-medium text-state-danger hover:bg-state-danger-soft disabled:opacity-50"
            >
              Livrare eșuată
            </button>
          )}
          {canDeliver && failedOpen && (
            <div className="space-y-2 bg-surface-soft px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Motivul eșecului
              </p>
              <textarea
                value={failureReason}
                onChange={(event) => setFailureReason(event.target.value)}
                placeholder="ex. client închis, marfă refuzată…"
                rows={2}
                className="w-full rounded-lg border border-ink/15 px-2 py-1.5 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmDeliveryFailed()}
                  className="flex-1 rounded-lg bg-state-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Confirmă
                </button>
                <button
                  type="button"
                  onClick={() => setFailedOpen(false)}
                  className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm font-semibold text-ink"
                >
                  Anulează
                </button>
              </div>
            </div>
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
              {MANUALLY_SETTABLE_STATUSES.map((status) => {
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

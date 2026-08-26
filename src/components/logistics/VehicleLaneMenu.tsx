"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useTr } from "@/lib/i18n/tr";

/**
 * The van lane header's "⋯" — Mappa / Rinomina / Elimina il veicolo
 * (redesign brief §30): rarely-used configuration tucked behind a menu
 * rather than permanent lane-header buttons, so the header stays compact.
 * Self-contained (own fetch calls + router.refresh()) rather than routed
 * through FleetManagementModal, since it only ever acts on this one van.
 */
export function VehicleLaneMenu({
  vehicleId,
  vehicleName,
  orderCount,
  onOpenMap,
}: {
  vehicleId: string;
  vehicleName: string;
  orderCount: number;
  onOpenMap: () => void;
}) {
  const tr = useTr();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "rename" | "remove">("menu");
  const [renameValue, setRenameValue] = useState(vehicleName);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setMode("menu");
  }

  async function submitRename() {
    const name = renameValue.trim();
    if (!name) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/vehicles/${vehicleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as { ok: boolean };
      if (payload.ok) {
        showToast(tr("Veicolo rinominato."), "success");
        router.refresh();
        close();
      } else {
        showToast(tr("Rinomina non salvata."), "error");
      }
    } catch {
      showToast(tr("Errore di rete."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function submitRemove() {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/remove`, { method: "POST" });
      const payload = (await response.json()) as { ok: boolean; reassignedOrders?: number };
      if (payload.ok) {
        showToast(
          payload.reassignedOrders
            ? `${vehicleName} eliminato. ${payload.reassignedOrders} ${payload.reassignedOrders === 1 ? "ordine spostato" : tr("ordini spostati")} in Non assegnati.`
            : `${vehicleName} eliminato.`,
          "success"
        );
        router.refresh();
        close();
      } else {
        showToast(tr("Rimozione non salvata."), "error");
      }
    } catch {
      showToast(tr("Errore di rete."), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex-none">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Azioni ${vehicleName}`}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-white hover:text-ink"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
          <circle cx="10" cy="4" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="10" cy="16" r="1.5" />
        </svg>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border border-ink/10 bg-white py-1 shadow-modal">
          {mode === "menu" && (
            <>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  onOpenMap();
                  close();
                }}
                className="block w-full px-4 py-2.5 text-left text-sm font-medium text-ink hover:bg-surface-soft"
              >
                Mappa
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => setMode("rename")}
                className="block w-full px-4 py-2.5 text-left text-sm font-medium text-ink hover:bg-surface-soft"
              >
                Rinomina
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => setMode("remove")}
                className="block w-full px-4 py-2.5 text-left text-sm font-medium text-state-danger hover:bg-state-danger-soft"
              >
                Elimina il veicolo
              </button>
            </>
          )}

          {mode === "rename" && (
            <div className="px-3 py-2.5">
              <input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void submitRename()}
                className="h-9 w-full rounded-lg border border-ink/15 px-2 text-sm text-ink outline-none focus:border-accent"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("menu")}
                  className="flex-1 rounded-lg border border-ink/15 px-2 py-1.5 text-xs font-semibold text-ink"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submitRename()}
                  className="flex-1 rounded-lg bg-accent px-2 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  Salva
                </button>
              </div>
            </div>
          )}

          {mode === "remove" && (
            <div className="px-3 py-2.5">
              {orderCount > 0 ? (
                <p className="text-xs text-ink">
                  {vehicleName} ha {orderCount} {orderCount === 1 ? "ordine assegnato" : tr("ordini assegnati")}.{" "}
                  {orderCount === 1 ? "Verrà spostato" : tr("Verranno spostati")} in Non assegnati.
                </p>
              ) : (
                <p className="text-xs text-ink">Eliminare {vehicleName}?</p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("menu")}
                  className="flex-1 rounded-lg border border-ink/15 px-2 py-1.5 text-xs font-semibold text-ink"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submitRemove()}
                  className="flex-1 rounded-lg bg-state-danger px-2 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  {busy ? "Rimozione…" : tr("Elimina")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

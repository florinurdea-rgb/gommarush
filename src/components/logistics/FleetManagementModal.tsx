"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { VAN_DOT_CLASS } from "@/lib/logistics/vehicle-colors";
import type { VehicleRow } from "@/lib/types/logistics";

/**
 * "Gestionează mașinile" — add/rename/reorder/remove vans (redesign brief
 * §12-24). Vehicles are no longer assumed to always be "Van 1, Van 2, Van
 * 3": the fleet is a real, persistent list the admin can reshape.
 *
 * Order counts come from the board's already-loaded columns (a prop, not a
 * fresh fetch) so opening this sheet never re-queries anything — the board
 * already knows exactly how many orders sit on each vehicle right now.
 */

function suggestNextVanName(vehicles: VehicleRow[]): string {
  let maxN = 0;
  for (const vehicle of vehicles) {
    const match = /^van\s+(\d+)$/i.exec(vehicle.name.trim());
    if (match) maxN = Math.max(maxN, Number(match[1]));
  }
  return `Van ${maxN + 1 || vehicles.length + 1}`;
}

export function FleetManagementModal({
  vehicles,
  orderCounts,
  onClose,
}: {
  vehicles: VehicleRow[];
  /** vehicleId -> currently assigned active order count, from the board's own state. */
  orderCounts: Record<string, number>;
  onClose: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addRegistration, setAddRegistration] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const ordered = useMemo(
    () => [...vehicles].sort((a, b) => (a.display_order ?? Infinity) - (b.display_order ?? Infinity)),
    [vehicles]
  );
  const suggested = useMemo(() => suggestNextVanName(vehicles), [vehicles]);

  function refresh() {
    router.refresh();
  }

  async function submitRename(vehicleId: string) {
    const name = renameValue.trim();
    if (!name) return;
    setBusyId(vehicleId);
    try {
      const response = await fetch(`/api/admin/vehicles/${vehicleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as { ok: boolean };
      if (payload.ok) {
        showToast("Mașină redenumită.", "success");
        refresh();
      } else {
        showToast("Redenumirea nu a putut fi salvată.", "error");
      }
    } catch {
      showToast("Eroare de rețea.", "error");
    } finally {
      setBusyId(null);
      setRenamingId(null);
    }
  }

  async function submitRemove(vehicleId: string) {
    setBusyId(vehicleId);
    try {
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/remove`, { method: "POST" });
      const payload = (await response.json()) as { ok: boolean; reassignedOrders?: number };
      if (payload.ok) {
        showToast(
          payload.reassignedOrders
            ? `Mașină eliminată. ${payload.reassignedOrders} ${payload.reassignedOrders === 1 ? "comandă mutată" : "comenzi mutate"} în Neasignate.`
            : "Mașină eliminată.",
          "success"
        );
        refresh();
      } else {
        showToast("Eliminarea nu a putut fi salvată.", "error");
      }
    } catch {
      showToast("Eroare de rețea.", "error");
    } finally {
      setBusyId(null);
      setRemoveConfirmId(null);
    }
  }

  async function move(vehicleId: string, direction: -1 | 1) {
    const index = ordered.findIndex((v) => v.id === vehicleId);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];

    setBusyId(vehicleId);
    try {
      const response = await fetch("/api/admin/vehicles/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderedVehicleIds: next.map((v) => v.id) }),
      });
      const payload = (await response.json()) as { ok: boolean };
      if (payload.ok) refresh();
      else showToast("Reordonarea nu a putut fi salvată.", "error");
    } catch {
      showToast("Eroare de rețea.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function submitAdd() {
    const name = addName.trim() || suggested;
    setAddBusy(true);
    try {
      const response = await fetch("/api/admin/vehicles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, registration: addRegistration.trim() || null }),
      });
      const payload = (await response.json()) as { ok: boolean; code?: string; details?: string[] };
      if (payload.ok) {
        showToast(`${name} adăugată.`, "success");
        setAddName("");
        setAddRegistration("");
        setAddingOpen(false);
        refresh();
      } else {
        const detail = [payload.code, ...(payload.details ?? [])].filter(Boolean).join(" — ");
        showToast(`Adăugarea nu a putut fi salvată.${detail ? ` (${detail})` : ""}`, "error");
      }
    } catch {
      showToast("Eroare de rețea.", "error");
    } finally {
      setAddBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-modal">
        <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4">
          <h2 className="text-base font-bold text-ink">Mașini</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Închide"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-surface-soft hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {ordered.length === 0 && <p className="py-6 text-center text-sm text-ink-soft">Nicio mașină încă.</p>}

          <ul className="divide-y divide-ink/10">
            {ordered.map((vehicle, index) => {
              const count = orderCounts[vehicle.id] ?? 0;
              const busy = busyId === vehicle.id;
              return (
                <li key={vehicle.id} className="py-2.5">
                  {renamingId === vehicle.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void submitRename(vehicle.id);
                          if (event.key === "Escape") setRenamingId(null);
                        }}
                        className="h-9 flex-1 rounded-lg border border-ink/15 px-2 text-sm text-ink outline-none focus:border-accent"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void submitRename(vehicle.id)}
                        className="h-9 rounded-lg bg-accent px-3 text-xs font-bold text-white disabled:opacity-50"
                      >
                        Salvează
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="h-9 rounded-lg px-2 text-xs font-semibold text-ink-soft"
                      >
                        Anulează
                      </button>
                    </div>
                  ) : removeConfirmId === vehicle.id ? (
                    <div className="rounded-xl bg-state-warning-soft p-3">
                      {count > 0 ? (
                        <>
                          <p className="text-sm font-semibold text-ink">
                            {vehicle.name} are {count} {count === 1 ? "comandă asignată" : "comenzi asignate"}
                          </p>
                          <p className="mt-1 text-xs text-ink-soft">
                            Dacă elimini această mașină, {count === 1 ? "comanda va fi mutată" : "toate comenzile vor fi mutate"} în
                            Neasignate.
                          </p>
                        </>
                      ) : (
                        <p className="text-sm font-semibold text-ink">Ștergi {vehicle.name}?</p>
                      )}
                      <div className="mt-2.5 flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setRemoveConfirmId(null)}
                          className="flex-1 rounded-lg border border-ink/15 bg-white px-3 py-2 text-xs font-semibold text-ink disabled:opacity-50"
                        >
                          Anulează
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void submitRemove(vehicle.id)}
                          className="flex-1 rounded-lg bg-state-danger px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                          {busy ? "Se elimină…" : count > 0 ? "Mută comenzile și elimină mașina" : "Elimină"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 flex-none rounded-full ${VAN_DOT_CLASS[vehicle.color_key ?? "default"]}`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-ink">{vehicle.name}</div>
                        <div className="text-xs text-ink-soft">
                          {vehicle.registration ? `${vehicle.registration} · ` : ""}
                          {count} {count === 1 ? "comandă" : "comenzi"}
                        </div>
                      </div>
                      <div className="flex flex-none items-center gap-0.5">
                        <button
                          type="button"
                          disabled={busy || index === 0}
                          onClick={() => void move(vehicle.id, -1)}
                          aria-label="Mută mai sus"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-surface-soft disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={busy || index === ordered.length - 1}
                          onClick={() => void move(vehicle.id, 1)}
                          aria-label="Mută mai jos"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-surface-soft disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(vehicle.id);
                            setRenameValue(vehicle.name);
                          }}
                          aria-label={`Redenumește ${vehicle.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-surface-soft"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoveConfirmId(vehicle.id)}
                          aria-label={`Elimină ${vehicle.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-state-danger hover:bg-state-danger-soft"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="border-t border-ink/10 p-4">
          {addingOpen ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={addName}
                onChange={(event) => setAddName(event.target.value)}
                placeholder={suggested}
                className="h-10 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-accent"
              />
              <input
                value={addRegistration}
                onChange={(event) => setAddRegistration(event.target.value)}
                placeholder="Nr. înmatriculare (opțional)"
                className="h-10 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-accent"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAddingOpen(false)}
                  className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm font-semibold text-ink"
                >
                  Anulează
                </button>
                <button
                  type="button"
                  disabled={addBusy}
                  onClick={() => void submitAdd()}
                  className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {addBusy ? "Se adaugă…" : "Adaugă"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAddingOpen(true);
                setAddName(suggested);
              }}
              className="flex h-11 w-full items-center justify-center rounded-xl border border-dashed border-ink/20 text-sm font-semibold text-accent hover:bg-accent-light"
            >
              + Adaugă mașină
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

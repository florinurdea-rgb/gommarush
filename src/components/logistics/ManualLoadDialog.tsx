"use client";

import { useState } from "react";
import { errorMessage, t, unitStatusMeta } from "@/lib/i18n/logistics";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import type { ScanOutcome } from "@/components/logistics/DriverConsole";

/**
 * "Adaugă manual ca încărcat" — the exception path for a damaged label or a
 * dead scanner.
 *
 * Two things are non-negotiable and enforced both here and server-side:
 *   * the exact inventory unit must be chosen (no bulk "mark everything")
 *   * a reason is mandatory
 * The resulting audit row is stored as a manual override, never as a scan.
 */
interface LoadableUnit {
  id: string;
  unit_sequence: number;
  status: string;
  description: string | null;
  order_number: number;
  customer_name: string | null;
}

export function ManualLoadDialog({
  units,
  onClose,
  onDone,
}: {
  units: LoadableUnit[];
  onClose: () => void;
  onDone: (outcome: ScanOutcome) => void;
}) {
  const [unitId, setUnitId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(unitId) && reason.trim().length >= 3 && !busy;

  async function submit() {
    if (!canSubmit || !unitId) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/driver/manual-load", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inventory_unit_id: unitId, reason: reason.trim() }),
      });
      const payload = (await response.json()) as { ok: boolean; code?: string };

      if (!payload.ok) {
        setError(errorMessage(payload.code));
        return;
      }

      onDone({
        tone: "success",
        title: "ADĂUGAT MANUAL",
        detail: "Înregistrat ca excepție, nu ca scanare.",
      });
    } catch {
      setError(errorMessage("UNKNOWN"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-lg font-extrabold">{t("addManuallyAsLoaded")}</h2>
        <button type="button" onClick={onClose} className="min-h-12 px-4 text-base font-bold text-white/70">
          {t("cancel")}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="mb-4 rounded-xl bg-state-warning-soft p-3 text-sm font-semibold text-state-warning">
          Doar pentru excepții: etichetă deteriorată sau cititor defect. Acțiunea
          este marcată ca manuală în istoric.
        </p>

        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-white/50">
          Alege obiectul exact
        </h3>
        <ul className="space-y-2">
          {units.map((unit) => (
            <li key={unit.id}>
              <button
                type="button"
                onClick={() => setUnitId(unit.id)}
                className={`w-full rounded-xl p-3 text-left ${
                  unitId === unit.id ? "bg-white text-ink" : "bg-white/10 text-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs opacity-60">
                      {formatOrderNumber(unit.order_number)} · #{unit.unit_sequence}
                    </div>
                    <div className="truncate font-bold">{unit.customer_name ?? "—"}</div>
                    <div className="truncate text-sm opacity-70">{unit.description ?? "—"}</div>
                  </div>
                  <span className="flex-none text-xs font-semibold opacity-70">
                    {unitStatusMeta(unit.status).label}
                  </span>
                </div>
              </button>
            </li>
          ))}
          {units.length === 0 && (
            <li className="rounded-xl bg-white/5 p-4 text-center text-sm text-white/60">
              Niciun obiect disponibil pentru încărcare manuală.
            </li>
          )}
        </ul>

        <div className="mt-5">
          <label htmlFor="manual-reason" className="mb-1 block text-sm font-bold text-white/70">
            {t("reason")} *
          </label>
          <input
            id="manual-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="ex. etichetă deteriorată"
            className="min-h-14 w-full rounded-xl bg-white px-4 text-base font-semibold text-ink outline-none"
          />
          {reason.trim().length > 0 && reason.trim().length < 3 && (
            <p className="mt-1 text-xs text-state-warning">{t("reasonRequired")}</p>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-state-danger p-3 text-sm font-bold">
            {error}
          </p>
        )}
      </div>

      <footer className="border-t border-white/10 px-4 py-3">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="min-h-16 w-full rounded-xl bg-state-warning text-lg font-extrabold text-white disabled:opacity-40"
        >
          {busy ? t("loading") : t("confirm")}
        </button>
      </footer>
    </div>
  );
}

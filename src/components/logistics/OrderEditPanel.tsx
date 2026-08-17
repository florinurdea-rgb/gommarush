"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { STAND_CODES } from "@/lib/types/logistics";
import { errorMessage, t } from "@/lib/i18n/logistics";
import type { StandCode } from "@/lib/types/logistics";
import type { OptionRef } from "@/components/logistics/NewOrderFlow";

/**
 * Assignment editor on the order detail page: stand, driver, van, delivery date,
 * plus the hold/reactivate/cancel controls.
 *
 * Stand assignment is the interesting one — it can legitimately fail
 * (STAND_OCCUPIED) because another order took the stand between page load and
 * save, so the result is always surfaced rather than assumed.
 */

const inputClass =
  "h-11 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-accent";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft";

interface OrderEditPanelProps {
  orderId: string;
  standCode: StandCode | null;
  availableStands: StandCode[];
  drivers: OptionRef[];
  vehicles: OptionRef[];
  driverId: string | null;
  vehicleId: string | null;
  plannedDate: string | null;
  status: string;
}

export function OrderEditPanel({
  orderId,
  standCode,
  availableStands,
  drivers,
  vehicles,
  driverId,
  vehicleId,
  plannedDate,
  status,
}: OrderEditPanelProps) {
  const router = useRouter();
  const [stand, setStand] = useState<string>(standCode ?? "");
  const [driver, setDriver] = useState(driverId ?? "");
  const [vehicle, setVehicle] = useState(vehicleId ?? "");
  const [date, setDate] = useState(plannedDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onHold = status === "on_hold";
  const cancelled = status === "cancelled";

  async function saveAssignment() {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      // The stand goes through its own endpoint because it can collide; the
      // rest is a plain field update.
      if ((stand || null) !== (standCode ?? null)) {
        const response = await fetch(`/api/admin/orders/${orderId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "assign_stand", stand_code: stand || null }),
        });
        const payload = (await response.json()) as { ok: boolean; code?: string };
        if (!payload.ok) {
          setError(errorMessage(payload.code));
          return;
        }
      }

      const response = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          driver_id: driver || null,
          vehicle_id: vehicle || null,
          planned_delivery_date: date || null,
        }),
      });
      const payload = (await response.json()) as { ok: boolean; code?: string };
      if (!payload.ok) {
        setError(errorMessage(payload.code));
        return;
      }

      setNotice("Salvat.");
      router.refresh();
    } catch {
      setError(errorMessage("SAVE_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  async function lifecycle(action: "hold" | "reactivate" | "cancel") {
    if (action === "cancel" && !window.confirm(
      "Anulezi comanda? Va fi scoasă din lista activă, dar produsele, obiectele fizice și istoricul se păstrează."
    )) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, planned_delivery_date: date || null }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        code?: string;
        standWarning?: string | null;
      };
      if (!payload.ok) {
        setError(errorMessage(payload.code));
        return;
      }
      if (payload.standWarning) setNotice(errorMessage(payload.standWarning));
      router.refresh();
    } catch {
      setError(errorMessage("UNKNOWN"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-card">
      <h2 className="text-base font-bold text-ink">{t("assignment")}</h2>

      <div className="mt-4 space-y-3">
        <div>
          <label className={labelClass} htmlFor="edit-stand">{t("stand")}</label>
          <select
            id="edit-stand"
            className={inputClass}
            value={stand}
            disabled={cancelled}
            onChange={(event) => setStand(event.target.value)}
          >
            <option value="">{t("unassigned")}</option>
            {STAND_CODES.map((code) => {
              const usable = availableStands.includes(code) || code === standCode;
              return (
                <option key={code} value={code} disabled={!usable}>
                  {code}
                  {usable ? "" : " — ocupat"}
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="edit-driver">{t("driver")}</label>
          <select id="edit-driver" className={inputClass} value={driver} disabled={cancelled}
            onChange={(event) => setDriver(event.target.value)}>
            <option value="">—</option>
            {drivers.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="edit-vehicle">{t("vehicle")}</label>
          <select id="edit-vehicle" className={inputClass} value={vehicle} disabled={cancelled}
            onChange={(event) => setVehicle(event.target.value)}>
            <option value="">—</option>
            {vehicles.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="edit-date">{t("plannedDate")}</label>
          <input id="edit-date" type="date" className={inputClass} value={date} disabled={cancelled}
            onChange={(event) => setDate(event.target.value)} />
        </div>

        <Button className="w-full" disabled={busy || cancelled} onClick={saveAssignment}>
          {busy ? t("loading") : t("save")}
        </Button>
      </div>

      {(error || notice) && (
        <p
          role="alert"
          className={`mt-3 rounded-lg p-2.5 text-sm font-medium ${
            error ? "bg-state-danger-soft text-state-danger" : "bg-state-success-soft text-state-success"
          }`}
        >
          {error ?? notice}
        </p>
      )}

      {!cancelled && (
        <div className="mt-5 space-y-2 border-t border-ink/10 pt-4">
          {onHold ? (
            <Button variant="secondary" className="w-full" disabled={busy}
              onClick={() => lifecycle("reactivate")}>
              {t("reactivate")}
            </Button>
          ) : (
            <Button variant="secondary" className="w-full" disabled={busy}
              onClick={() => lifecycle("hold")}>
              {t("moveToHold")}
            </Button>
          )}

          {/* Kept visibly accessible, but always confirmed, and it cancels
              rather than destroys. */}
          <Button variant="danger" className="w-full" disabled={busy}
            onClick={() => lifecycle("cancel")}>
            {t("cancelOrder")}
          </Button>
        </div>
      )}
    </section>
  );
}

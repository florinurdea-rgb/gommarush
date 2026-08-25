"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { errorMessage, t } from "@/lib/i18n/logistics";
import type { OptionRef } from "@/components/logistics/NewOrderFlow";

/**
 * "Alege mașina" — today's van, for an already-authenticated driver.
 *
 * Identity is no longer picked here (see src/lib/auth/driver-session.ts):
 * this only sets drivers.current_vehicle_id for the signed-in driver, a
 * lower-stakes operational preference, never an identity claim.
 */
export function DriverSessionPicker({ driverName, vehicles }: { driverName: string; vehicles: OptionRef[] }) {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!vehicleId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/driver/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vehicle_id: vehicleId }),
      });
      const payload = (await response.json()) as { ok: boolean; code?: string };
      if (!payload.ok) {
        setError(errorMessage(payload.code));
        return;
      }
      router.refresh();
    } catch {
      setError(errorMessage("UNKNOWN"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink px-4 py-6 text-white">
      <div className="mx-auto w-full max-w-md">
        <Logo iconClassName="h-12 w-12" textClassName="text-2xl [&>span]:!text-white" />

        <h1 className="mt-8 text-2xl font-extrabold">Salut, {driverName}</h1>
        <p className="mt-1 text-sm text-white/60">Scegli il veicolo con cui parti oggi.</p>

        <section className="mt-6">
          <div className="grid gap-2">
            {vehicles.map((vehicle) => (
              <button
                key={vehicle.id}
                type="button"
                onClick={() => setVehicleId(vehicle.id)}
                className={`min-h-16 rounded-xl px-5 text-left text-xl font-bold transition-colors ${
                  vehicleId === vehicle.id
                    ? "bg-white text-ink"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {vehicle.name}
              </button>
            ))}
            {vehicles.length === 0 && (
              <p className="text-sm text-white/60">Nessun veicolo configurato.</p>
            )}
          </div>
        </section>

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-state-danger p-3 text-sm font-semibold">
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={!vehicleId || busy}
          onClick={start}
          className="mt-8 min-h-16 w-full rounded-xl bg-accent text-xl font-extrabold text-white disabled:opacity-40"
        >
          {busy ? t("loading") : "Inizia il turno"}
        </button>
      </div>
    </div>
  );
}

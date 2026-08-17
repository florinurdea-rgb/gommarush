"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { errorMessage, t } from "@/lib/i18n/logistics";
import type { OptionRef } from "@/components/logistics/NewOrderFlow";

/**
 * Phase 1 driver "login": pick who you are and which van you're in.
 *
 * Simplified by design, but the resulting session is a signed server-side
 * cookie, so every scan endpoint reads the driver identity from one trusted
 * place. Replacing this with real authentication means changing
 * src/lib/auth/driver-session.ts, not this screen.
 *
 * Big targets throughout: this is used with gloves on, on a phone.
 */
export function DriverSessionPicker({
  drivers,
  vehicles,
}: {
  drivers: OptionRef[];
  vehicles: OptionRef[];
}) {
  const router = useRouter();
  const [driverId, setDriverId] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!driverId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/driver/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ driver_id: driverId, vehicle_id: vehicleId }),
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

        <h1 className="mt-8 text-2xl font-extrabold">{t("selectDriverSession")}</h1>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-white/50">
            {t("driver")}
          </h2>
          <div className="grid gap-2">
            {drivers.map((driver) => (
              <button
                key={driver.id}
                type="button"
                onClick={() => setDriverId(driver.id)}
                className={`min-h-16 rounded-xl px-5 text-left text-xl font-bold transition-colors ${
                  driverId === driver.id
                    ? "bg-white text-ink"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {driver.name}
              </button>
            ))}
            {drivers.length === 0 && (
              <p className="text-sm text-white/60">
                Niciun șofer configurat. Rulează scriptul de seed sau adaugă șoferi în Supabase.
              </p>
            )}
          </div>
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-white/50">
            {t("vehicle")}
          </h2>
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
          </div>
        </section>

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-state-danger p-3 text-sm font-semibold">
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={!driverId || busy}
          onClick={start}
          className="mt-8 min-h-16 w-full rounded-xl bg-accent text-xl font-extrabold text-white disabled:opacity-40"
        >
          {busy ? t("loading") : "Începe tura"}
        </button>
      </div>
    </div>
  );
}

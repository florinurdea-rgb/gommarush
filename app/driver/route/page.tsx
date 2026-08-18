import Link from "next/link";
import { listVehicles } from "@/lib/server/reference";
import { Logo } from "@/components/Logo";
import { VAN_DOT_CLASS } from "@/lib/logistics/vehicle-colors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Logare șofer" };

/**
 * "Logare șofer" — a lightweight, read-only route viewer: pick your van,
 * see today's stops in delivery order, open the map. Deliberately not the
 * full /driver console (driver+vehicle login, scanning, loading) — this is
 * just "what's my route today", so it only asks for the one thing that
 * actually matters here: which van.
 */
export default async function DriverRoutePickerPage() {
  const vehicles = await listVehicles();

  return (
    <div className="min-h-screen bg-surface-soft">
      <header className="border-b border-ink/10 bg-white px-4 py-4 sm:px-6">
        <Logo iconClassName="h-9 w-9" textClassName="text-xl" />
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Logare șofer</h1>
        <p className="mt-1 text-sm text-ink-soft">Alege mașina ta pentru a vedea ruta de azi.</p>

        {vehicles.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-ink/20 bg-white px-4 py-8 text-center text-sm text-ink-soft">
            Nicio mașină activă.
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id}>
                <Link
                  href={`/driver/route/${vehicle.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-card transition-colors hover:border-accent hover:bg-accent-light"
                >
                  <span
                    className={`h-3 w-3 flex-none rounded-full ${VAN_DOT_CLASS[(vehicle.color_key as keyof typeof VAN_DOT_CLASS) ?? "default"] ?? VAN_DOT_CLASS.default}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-bold text-ink">{vehicle.name}</span>
                    {vehicle.registration && (
                      <span className="block text-xs text-ink-soft">{vehicle.registration}</span>
                    )}
                  </span>
                  <span aria-hidden="true" className="text-ink-soft">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

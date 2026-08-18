"use client";

import Link from "next/link";
import { useState } from "react";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { operationalStatus } from "@/lib/logistics/operational-status";
import { TyreIcon } from "@/components/logistics/TyreIcon";
import { DriverRouteMapModal } from "@/components/logistics/DriverRouteMapModal";
import type { DriverRouteStop } from "@/components/logistics/DriverRouteMapModal";
import type { OrderListRow } from "@/lib/server/orders";

function MapIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M9 4.5 4 6.5v13l5-2 6 2 5-2v-13l-5 2-6-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9 4.5v13M15 6.5v13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * "Comenzile tale de azi" — a driver's route for the day, van-scoped, tap a
 * stop to expand its details inline (customer, tyre count, address), "Hartă"
 * opens the same stop-order map the admin board uses. Read-only by design:
 * this is a route viewer, not the /driver scanning console.
 */
export function DriverRouteView({
  vehicleName,
  orders,
  stops,
  depotLocation,
}: {
  vehicleName: string;
  orders: OrderListRow[];
  stops: DriverRouteStop[];
  depotLocation: { lat: number; lng: number } | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface-soft pb-10">
      <header className="sticky top-0 z-10 border-b border-ink/10 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href="/driver/route" className="text-xs font-semibold text-accent hover:underline">
              ← Schimbă mașina
            </Link>
            <h1 className="truncate text-lg font-extrabold text-ink">{vehicleName}</h1>
            <p className="text-xs text-ink-soft">
              {orders.length} {orders.length === 1 ? "comandă azi" : "comenzi azi"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="flex h-11 flex-none items-center gap-1.5 rounded-xl border border-ink/15 bg-white px-4 text-sm font-semibold text-ink hover:bg-surface-soft"
          >
            <MapIcon />
            Hartă
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-4 sm:px-6">
        {orders.length === 0 ? (
          <p className="mt-8 rounded-xl border border-dashed border-ink/20 bg-white px-4 py-10 text-center text-sm text-ink-soft">
            Nicio comandă azi pe {vehicleName}.
          </p>
        ) : (
          <ul className="space-y-2">
            {orders.map((order, index) => {
              const status = operationalStatus(order.status, order.progress.problem > 0);
              const expanded = expandedId === order.id;
              const address = [order.customer_address, order.customer_city].filter(Boolean).join(", ");
              return (
                <li key={order.id} className="overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-card">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : order.id)}
                    aria-expanded={expanded}
                    className="flex w-full items-center gap-3 p-4 text-left"
                  >
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent-light text-sm font-bold text-accent-dark">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-ink-soft">
                          {formatOrderNumber(order.order_number)}
                        </span>
                        <span title={status.label} className="text-xs">
                          {status.emoji}
                        </span>
                      </div>
                      <div className="truncate text-base font-bold text-ink">{order.customer_name ?? "—"}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-soft">
                        <TyreIcon className="h-3.5 w-3.5" />
                        {order.tyre_count} anv.
                      </div>
                    </div>
                    <span
                      aria-hidden="true"
                      className={`flex-none text-ink-soft transition-transform ${expanded ? "rotate-90" : ""}`}
                    >
                      ›
                    </span>
                  </button>
                  {expanded && (
                    <div className="border-t border-ink/10 bg-surface-soft px-4 py-3 text-sm">
                      <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Adresă</div>
                      <div className="text-ink">{address || "—"}</div>
                      <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Status</div>
                      <div className="text-ink">
                        {status.emoji} {status.label}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {mapOpen && (
        <DriverRouteMapModal
          vehicleName={vehicleName}
          stops={stops}
          depotLocation={depotLocation}
          onClose={() => setMapOpen(false)}
        />
      )}
    </div>
  );
}

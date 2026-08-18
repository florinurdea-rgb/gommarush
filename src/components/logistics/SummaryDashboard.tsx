"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DeliveriesModal } from "@/components/logistics/DeliveriesModal";
import { VAN_DOT_CLASS } from "@/lib/logistics/vehicle-colors";
import type { OperationalSummary } from "@/lib/server/summary";

function formatEuro(value: number): string {
  return `€${value.toLocaleString("ro-RO")}`;
}

function KpiCard({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white p-4">
      <div className="text-3xl font-black tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-sm text-ink-soft">{label}</div>
    </div>
  );
}

/** Matches VehicleBoard's 12s cadence — the same near-live behavior on both operational dashboards, see its own comment for why 12s is the sweet spot here. */
const AUTO_REFRESH_MS = 12_000;

export function SummaryDashboard({
  summary,
  periodLabel,
}: {
  summary: OperationalSummary;
  periodLabel: string;
}) {
  const router = useRouter();
  const [activeVehicle, setActiveVehicle] = useState<string>("total");
  const [deliveriesOpen, setDeliveriesOpen] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (deliveriesOpen) return;
      router.refresh();
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [router, deliveriesOpen]);

  const vehicleRowById = useMemo(
    () => new Map(summary.vehicles.map((row) => [row.vehicleId, row])),
    [summary.vehicles]
  );
  // Vehicles rendered here (active or since-removed) come straight from what
  // actually delivered tyres in the selected period — never a separately
  // fetched "current fleet" list — so a van removed from active planning
  // still shows its historical numbers instead of vanishing from Sumar.
  const vehicleTabs = useMemo(
    () => [...summary.vehicles].sort((a, b) => a.vehicleName.localeCompare(b.vehicleName, "ro")),
    [summary.vehicles]
  );

  const scoped =
    activeVehicle === "total"
      ? {
          orders: summary.deliveries.length,
          tyres: summary.deliveredTyreCount,
          profit: summary.profit,
          deliveries: summary.deliveries,
          label: "Total",
        }
      : (() => {
          const row = vehicleRowById.get(activeVehicle);
          return {
            orders: row?.orders ?? 0,
            tyres: row?.tyres ?? 0,
            profit: row?.profit ?? 0,
            deliveries: summary.deliveries.filter((d) => d.vehicleId === activeVehicle),
            label: row?.vehicleName ?? "—",
          };
        })();

  const insights = useMemo(() => {
    const list: { title: string; detail: string }[] = [];
    const topVehicle = summary.vehicles[0];
    if (topVehicle && topVehicle.tyres > 0) {
      list.push({
        title: `${topVehicle.vehicleName} a livrat cele mai multe anvelope`,
        detail: `${topVehicle.tyres} anvelope în perioada selectată.`,
      });
    }
    const topSupplier = summary.supplierPickups[0];
    if (topSupplier && topSupplier.pickups > 0) {
      list.push({
        title: `${topSupplier.supplierName} a avut cele mai multe ridicări`,
        detail: `${topSupplier.pickups} ridicări · ${topSupplier.tyres} anvelope.`,
      });
    }
    if (summary.waitingGoodsCount > 0) {
      list.push({
        title: `${summary.waitingGoodsCount} comenzi sunt încă în așteptare`,
        detail: "Comenzi active care așteaptă marfa de la furnizor, la data curentă.",
      });
    }
    return list.slice(0, 4);
  }, [summary]);

  return (
    <>
      {/* --------------------------------------------------------- KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard value={summary.orderCount} label="Comenzi" />
        <KpiCard value={summary.pickupCount} label="Ridicări supplier" />
        <KpiCard value={summary.deliveredTyreCount} label="Anvelope livrate" />
        <KpiCard value={formatEuro(summary.profit)} label="Profit transport" />
      </div>

      {/* ---------------------------------------------------- Insights */}
      {insights.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Activitate</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {insights.map((insight) => (
              <div key={insight.title} className="rounded-xl border border-ink/10 bg-white p-4">
                <div className="text-sm font-bold text-ink">{insight.title}</div>
                <div className="mt-1 text-xs text-ink-soft">{insight.detail}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------ Supplier pickups */}
      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Ridicări de la furnizori</h2>
        {summary.supplierPickups.length === 0 ? (
          <p className="mt-2 rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink-soft">
            Nu există ridicări în perioada selectată.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {summary.supplierPickups.map((row) => (
              <div
                key={row.supplierId}
                className="flex items-center justify-between rounded-xl border border-ink/10 bg-white px-4 py-3"
              >
                <span className="font-semibold text-ink">{row.supplierName}</span>
                <span className="text-sm text-ink-soft">
                  {row.pickups} {row.pickups === 1 ? "ridicare" : "ridicări"} · {row.tyres} anvelope
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ----------------------------------------------------- Deliveries */}
      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Livrări</h2>
          <button
            type="button"
            onClick={() => setDeliveriesOpen(true)}
            className="text-sm font-semibold text-accent hover:underline"
          >
            Vezi livrările →
          </button>
        </div>
        {summary.deliveredTyreCount === 0 ? (
          <p className="mt-2 rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink-soft">
            Nu există livrări pentru perioada selectată.
          </p>
        ) : (
          <p className="mt-2 rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink">
            <strong>{summary.deliveredTyreCount}</strong> anvelope livrate ·{" "}
            <strong>{summary.deliveries.length}</strong> comenzi · <strong>{formatEuro(summary.profit)}</strong>{" "}
            profit
          </p>
        )}
      </section>

      {/* ------------------------------------------------------ Vehicles */}
      {vehicleTabs.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Pe mașină</h2>
          <div className="mt-2 flex flex-wrap gap-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveVehicle("total")}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                activeVehicle === "total"
                  ? "border-accent bg-accent-light text-accent-dark"
                  : "border-ink/15 bg-white text-ink-soft hover:bg-surface-soft"
              }`}
            >
              Total
            </button>
            {vehicleTabs.map((vehicle) => (
              <button
                key={vehicle.vehicleId}
                type="button"
                onClick={() => setActiveVehicle(vehicle.vehicleId)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  activeVehicle === vehicle.vehicleId
                    ? "border-accent bg-accent-light text-accent-dark"
                    : "border-ink/15 bg-white text-ink-soft hover:bg-surface-soft"
                }`}
              >
                <span
                  className={`h-2 w-2 flex-none rounded-full ${VAN_DOT_CLASS[(vehicle.colorKey as keyof typeof VAN_DOT_CLASS) ?? "default"] ?? VAN_DOT_CLASS.default}`}
                  aria-hidden="true"
                />
                {vehicle.vehicleName}
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-ink/10 bg-white p-4">
            <div className="text-sm font-bold text-ink">{scoped.label}</div>
            <div className="mt-1 text-sm text-ink-soft">
              {scoped.orders} {scoped.orders === 1 ? "comandă" : "comenzi"} · {scoped.tyres} anvelope ·{" "}
              {formatEuro(scoped.profit)} profit
            </div>
          </div>
        </section>
      )}

      {deliveriesOpen && (
        <DeliveriesModal
          deliveries={scoped.deliveries}
          periodLabel={periodLabel}
          onClose={() => setDeliveriesOpen(false)}
        />
      )}
    </>
  );
}

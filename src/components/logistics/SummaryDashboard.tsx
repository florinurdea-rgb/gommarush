"use client";

import { useMemo, useState } from "react";
import { DeliveriesModal } from "@/components/logistics/DeliveriesModal";
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

export function SummaryDashboard({
  summary,
  vehicleOptions,
  periodLabel,
}: {
  summary: OperationalSummary;
  vehicleOptions: { id: string; name: string }[];
  periodLabel: string;
}) {
  const [activeVehicle, setActiveVehicle] = useState<string>("total");
  const [deliveriesOpen, setDeliveriesOpen] = useState(false);

  const vehicleRowById = useMemo(
    () => new Map(summary.vehicles.map((row) => [row.vehicleId, row])),
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
          const vehicleName = vehicleOptions.find((v) => v.id === activeVehicle)?.name ?? "—";
          return {
            orders: row?.orders ?? 0,
            tyres: row?.tyres ?? 0,
            profit: row?.profit ?? 0,
            deliveries: summary.deliveries.filter((d) => d.vehicleId === activeVehicle),
            label: vehicleName,
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
      {vehicleOptions.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Pe mașină</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
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
            {vehicleOptions.map((vehicle) => (
              <button
                key={vehicle.id}
                type="button"
                onClick={() => setActiveVehicle(vehicle.id)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  activeVehicle === vehicle.id
                    ? "border-accent bg-accent-light text-accent-dark"
                    : "border-ink/15 bg-white text-ink-soft hover:bg-surface-soft"
                }`}
              >
                {vehicle.name}
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

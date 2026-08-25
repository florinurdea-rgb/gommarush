"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeSignal } from "@/hooks/useRealtimeSignal";
import { DeliveriesModal } from "@/components/logistics/DeliveriesModal";
import { VAN_BORDER_CLASS, VAN_DOT_CLASS } from "@/lib/logistics/vehicle-colors";
import { TyreIcon } from "@/components/logistics/TyreIcon";
import { OrdersIcon, PickupIcon, ProfitIcon, TrophyIcon, BuildingIcon, ClockIcon } from "@/components/logistics/SummaryIcons";
import type { OperationalSummary } from "@/lib/server/summary";

/**
 * "Sumar" is the visual/analytics dashboard (Consegne is the dense
 * operational one) — every tile here deliberately carries a color and an
 * icon rather than staying plain black-on-white, per the brief: this page
 * is meant to read like an infographic at a glance, not a spreadsheet.
 * Colors are drawn from the existing design-system tokens (state-*, accent)
 * plus the fleet's own van-color palette — nothing new invented here.
 */

function formatEuro(value: number): string {
  return `€${value.toLocaleString("ro-RO")}`;
}

type Tone = "blue" | "amber" | "green" | "purple";

const TONE_ICON_BG: Record<Tone, string> = {
  blue: "bg-accent-light text-accent-dark",
  amber: "bg-state-waiting-soft text-state-waiting",
  green: "bg-state-success-soft text-state-success",
  purple: "bg-purple-100 text-purple-700",
};

const TONE_BLOB: Record<Tone, string> = {
  blue: "bg-accent",
  amber: "bg-state-waiting",
  green: "bg-state-success",
  purple: "bg-purple-600",
};

function KpiCard({
  value,
  label,
  icon,
  tone,
}: {
  value: string | number;
  label: string;
  icon: React.ReactNode;
  tone: Tone;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-ink/10 bg-white p-4 shadow-card">
      <div className={`absolute -right-5 -top-5 h-24 w-24 rounded-full opacity-[0.08] ${TONE_BLOB[tone]}`} aria-hidden="true" />
      <div className={`relative flex h-10 w-10 items-center justify-center rounded-xl ${TONE_ICON_BG[tone]}`}>
        {icon}
      </div>
      <div className="relative mt-3 text-3xl font-black tabular-nums text-ink">{value}</div>
      <div className="relative mt-0.5 text-sm text-ink-soft">{label}</div>
    </div>
  );
}

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
  const deliveriesOpenRef = useRef(deliveriesOpen);
  deliveriesOpenRef.current = deliveriesOpen;

  // Reacts to the 'gorush-ops' Realtime broadcast rather than polling
  // blindly — see useRealtimeSignal.ts — paused while the deliveries
  // breakdown modal is open so a refresh doesn't close it under the user.
  useRealtimeSignal(() => {
    if (deliveriesOpenRef.current) return;
    router.refresh();
  });

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
          colorKey: null as string | null,
        }
      : (() => {
          const row = vehicleRowById.get(activeVehicle);
          return {
            orders: row?.orders ?? 0,
            tyres: row?.tyres ?? 0,
            profit: row?.profit ?? 0,
            deliveries: summary.deliveries.filter((d) => d.vehicleId === activeVehicle),
            label: row?.vehicleName ?? "—",
            colorKey: row?.colorKey ?? null,
          };
        })();

  const insights = useMemo(() => {
    const list: { title: string; detail: string; icon: React.ReactNode; tone: Tone }[] = [];
    const topVehicle = summary.vehicles[0];
    if (topVehicle && topVehicle.tyres > 0) {
      list.push({
        title: `${topVehicle.vehicleName} a livrat cele mai multe pneumatici`,
        detail: `${topVehicle.tyres} pneumatici nel periodo selezionato.`,
        icon: <TrophyIcon className="h-5 w-5" />,
        tone: "purple",
      });
    }
    const topSupplier = summary.supplierPickups[0];
    if (topSupplier && topSupplier.pickups > 0) {
      list.push({
        title: `${topSupplier.supplierName} a avut cele mai multe ritiri`,
        detail: `${topSupplier.pickups} ritiri · ${topSupplier.tyres} pneumatici.`,
        icon: <BuildingIcon className="h-5 w-5" />,
        tone: "blue",
      });
    }
    if (summary.waitingGoodsCount > 0) {
      list.push({
        title: `${summary.waitingGoodsCount} ordini sono ancora in attesa`,
        detail: "Ordini attivi in attesa della merce dal fornitore, alla data odierna.",
        icon: <ClockIcon className="h-5 w-5" />,
        tone: "amber",
      });
    }
    return list.slice(0, 4);
  }, [summary]);

  const maxPickups = Math.max(1, ...summary.supplierPickups.map((row) => row.pickups));

  return (
    <>
      {/* --------------------------------------------------------- KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard value={summary.orderCount} label="Comenzi" icon={<OrdersIcon />} tone="blue" />
        <KpiCard value={summary.pickupCount} label="Ritiri fornitore" icon={<PickupIcon />} tone="amber" />
        <KpiCard value={summary.deliveredTyreCount} label="Anvelope livrate" icon={<TyreIcon className="h-5 w-5" />} tone="green" />
        <KpiCard value={formatEuro(summary.profit)} label="Profit transport" icon={<ProfitIcon />} tone="purple" />
      </div>

      {/* ------------------------------------------------ Needs attention */}
      {(summary.deliveryFailedCount > 0 || summary.unassignedCount > 0 || summary.codExpected > 0) && (
        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Richiede attenzione</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {summary.deliveryFailedCount > 0 && (
              <div className="rounded-xl border border-state-danger/30 bg-state-danger-soft p-4">
                <div className="text-2xl font-black tabular-nums text-state-danger">
                  {summary.deliveryFailedCount}
                </div>
                <div className="text-sm font-semibold text-state-danger">
                  {summary.deliveryFailedCount === 1 ? "consegna non riuscita" : "consegne non riuscite"}
                </div>
              </div>
            )}
            {summary.unassignedCount > 0 && (
              <div className="rounded-xl border border-state-waiting/30 bg-state-waiting-soft p-4">
                <div className="text-2xl font-black tabular-nums text-state-waiting">
                  {summary.unassignedCount}
                </div>
                <div className="text-sm font-semibold text-state-waiting">
                  {summary.unassignedCount === 1 ? "ordine non assegnato" : "ordini non assegnati"}
                </div>
              </div>
            )}
            {summary.codExpected > 0 && (
              <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-card">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-ink-soft">Contrassegno previsto</span>
                  <span className="font-bold tabular-nums text-ink">{formatEuro(summary.codExpected)}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between text-sm">
                  <span className="text-ink-soft">Incassato</span>
                  <span className="font-bold tabular-nums text-ink">{formatEuro(summary.codCollected)}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between text-sm">
                  <span className="text-ink-soft">Differenza</span>
                  <span
                    className={`font-bold tabular-nums ${
                      summary.codExpected - summary.codCollected > 0 ? "text-state-danger" : "text-state-success"
                    }`}
                  >
                    {formatEuro(summary.codExpected - summary.codCollected)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------- Insights */}
      {insights.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Activitate</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {insights.map((insight) => (
              <div
                key={insight.title}
                className="flex items-start gap-3 rounded-xl border border-ink/10 bg-white p-4 shadow-card"
              >
                <div className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${TONE_ICON_BG[insight.tone]}`}>
                  {insight.icon}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-ink">{insight.title}</div>
                  <div className="mt-0.5 text-xs text-ink-soft">{insight.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------ Supplier pickups */}
      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Ritiri dai fornitori</h2>
        {summary.supplierPickups.length === 0 ? (
          <p className="mt-2 rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink-soft">
            Nessun ritiro nel periodo selezionato.
          </p>
        ) : (
          <div className="mt-2 space-y-2 rounded-xl border border-ink/10 bg-white p-4 shadow-card">
            {summary.supplierPickups.map((row) => (
              <div key={row.supplierId}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-ink">{row.supplierName}</span>
                  <span className="flex-none text-xs font-semibold text-ink-soft">
                    {row.pickups} {row.pickups === 1 ? "ridicare" : "ritiri"} · {row.tyres} pneumatici
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-soft">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(4, Math.round((row.pickups / maxPickups) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ----------------------------------------------------- Deliveries */}
      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Consegne</h2>
          <button
            type="button"
            onClick={() => setDeliveriesOpen(true)}
            className="text-sm font-semibold text-accent hover:underline"
          >
            Vedi le consegne →
          </button>
        </div>
        {summary.deliveredTyreCount === 0 ? (
          <p className="mt-2 rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink-soft">
            Nessuna consegna nel periodo selezionato.
          </p>
        ) : (
          <div className="mt-2 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-ink/10 bg-white p-3 text-center shadow-card">
              <div className="text-xl font-black tabular-nums text-state-success">{summary.deliveredTyreCount}</div>
              <div className="text-xs text-ink-soft">pneumatici</div>
            </div>
            <div className="rounded-xl border border-ink/10 bg-white p-3 text-center shadow-card">
              <div className="text-xl font-black tabular-nums text-accent">{summary.deliveries.length}</div>
              <div className="text-xs text-ink-soft">ordini</div>
            </div>
            <div className="rounded-xl border border-ink/10 bg-white p-3 text-center shadow-card">
              <div className="text-xl font-black tabular-nums text-purple-600">{formatEuro(summary.profit)}</div>
              <div className="text-xs text-ink-soft">profit</div>
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ Vehicles */}
      {vehicleTabs.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Per veicolo</h2>
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

          <div
            className={`mt-3 overflow-hidden rounded-xl border border-ink/10 bg-white p-4 shadow-card border-t-[3px] ${
              VAN_BORDER_CLASS[(scoped.colorKey as keyof typeof VAN_BORDER_CLASS) ?? "default"] ?? VAN_BORDER_CLASS.default
            }`}
          >
            <div className="text-sm font-bold text-ink">{scoped.label}</div>
            <div className="mt-2 grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-lg font-black tabular-nums text-accent">{scoped.orders}</div>
                <div className="text-[11px] text-ink-soft">{scoped.orders === 1 ? "ordine" : "ordini"}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-black tabular-nums text-state-success">{scoped.tyres}</div>
                <div className="text-[11px] text-ink-soft">pneumatici</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-black tabular-nums text-purple-600">{formatEuro(scoped.profit)}</div>
                <div className="text-[11px] text-ink-soft">profit</div>
              </div>
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

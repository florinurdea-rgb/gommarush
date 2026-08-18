"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { VehicleIcon } from "@/components/logistics/VehicleIcon";
import { OrderDetailModal } from "@/components/logistics/OrderDetailModal";
import { VehicleCardActionsMenu } from "@/components/logistics/VehicleCardActionsMenu";
import { RouteStopsModal } from "@/components/logistics/RouteStopsModal";
import { TyreIcon } from "@/components/logistics/TyreIcon";
import { useToast } from "@/components/ui/Toast";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { computeVehicleLoad, moveOrderBetweenColumns } from "@/lib/logistics/vehicle-board";
import { suggestRouteAssignments, suggestRouteForOrder } from "@/lib/logistics/route-suggestion";
import { operationalStatus } from "@/lib/logistics/operational-status";
import type { OperationalBucket } from "@/lib/logistics/operational-status";
import type { RoutableOrder, RoutableVehicle } from "@/lib/logistics/route-suggestion";
import type { OrderListRow } from "@/lib/server/orders";

/**
 * "Livrări" — the day-scoped operational board: orders grouped under the
 * vehicle they're assigned to, draggable between vehicles and reorderable
 * within one ("ordinea livrării"). Owns its own date/search/status filter
 * state entirely client-side, so switching days or typing a search never
 * re-fetches — every active order (any date) is fetched once by the server
 * page and filtered here.
 *
 * Native HTML5 drag-and-drop, deliberately not a library: this is a
 * desktop-first admin tool, the interaction is a plain "pick up a card,
 * drop it somewhere in a list", and the browser API covers that without
 * adding a dependency. Every card also carries a "Mută în…" menu action as
 * a tap-friendly fallback, since native drag is unreliable on touch.
 *
 * State is optimistic: a drop updates the local column immediately and
 * fires the write. Either way — success or failure — the local state is
 * then resynced from the server's next render (see the initialColumns
 * effect below), so a failed save visibly snaps the card back instead of
 * leaving a stale, silently-wrong position on screen.
 */

export interface VehicleColumnData {
  /** vehicle.id, or "unassigned" for the no-vehicle bucket. */
  key: string;
  vehicleId: string | null;
  name: string;
  /** Display number for the van icon's badge — null for "unassigned" (no icon). */
  number: number | null;
  capacityUnits: number | null;
  orders: OrderListRow[];
}

type QuickFilter = "all" | "unassigned" | OperationalBucket;

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "all", label: "Toate" },
  { key: "unassigned", label: "Neasignate" },
  { key: "waiting_goods", label: "Așteaptă marfa" },
  { key: "receiving", label: "În recepție" },
  { key: "to_prepare", label: "De pregătit" },
  { key: "ready", label: "Gata" },
  { key: "problem", label: "Probleme" },
];

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short" }).format(date);
}

function formatDateLong(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "long", year: "numeric" }).format(date);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "CARLINI GOMME TYRES DISTRIBUT..." -> "Carlini" — the full name still shows in the order detail drawer. */
function shortSupplierName(name: string): string {
  const firstWord = name.trim().split(/\s+/)[0] ?? name;
  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
}

function matchesSearch(order: OrderListRow, query: string): boolean {
  if (!query) return true;
  const haystack = [
    formatOrderNumber(order.order_number),
    order.customer_name,
    order.customer_address,
    order.customer_city,
    order.supplier_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function matchesQuickFilter(order: OrderListRow, filter: QuickFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unassigned") return !order.vehicle_id;
  return operationalStatus(order.status, order.progress.problem > 0).bucket === filter;
}

export function VehicleBoard({
  columns: initialColumns,
  depotLocation,
}: {
  columns: VehicleColumnData[];
  depotLocation: { lat: number; lng: number } | null;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [columnsByKey, setColumnsByKey] = useState<Record<string, OrderListRow[]>>(() =>
    Object.fromEntries(initialColumns.map((column) => [column.key, column.orders]))
  );
  const [drag, setDrag] = useState<{ orderId: string; fromKey: string } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [mapColumnKey, setMapColumnKey] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso());
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [mobileColumnKey, setMobileColumnKey] = useState<string>("unassigned");
  // Suppresses the click that would otherwise open the drawer right after a
  // real drag-and-drop — see the click handler below.
  const justDraggedRef = useRef(false);

  const columnMeta = useMemo(
    () => new Map(initialColumns.map((column) => [column.key, column])),
    [initialColumns]
  );

  // Resyncs local state from the server's latest render — the fix for the
  // real bug behind "the move didn't save but the card stayed put anyway":
  // a bare useState initializer only runs once, so router.refresh() alone
  // never actually rolled a failed move back. This makes every commit
  // (success or failure) converge to the true server state.
  useEffect(() => {
    setColumnsByKey(Object.fromEntries(initialColumns.map((column) => [column.key, column.orders])));
  }, [initialColumns]);

  const commitColumn = useCallback(
    async (vehicleId: string | null, orderedOrderIds: string[]) => {
      try {
        const response = await fetch("/api/admin/orders/reorder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vehicleId, orderedOrderIds }),
        });
        const payload = (await response.json()) as { ok: boolean; code?: string; details?: string[] };
        if (!payload.ok) {
          const detail = [payload.code, ...(payload.details ?? [])].filter(Boolean).join(" — ");
          showToast(
            `Nu am putut salva modificarea. Încearcă din nou.${detail ? ` (${detail})` : ""}`,
            "error"
          );
        }
      } catch {
        showToast("Eroare de rețea. Nu am putut salva modificarea.", "error");
      } finally {
        router.refresh();
      }
    },
    [router, showToast]
  );

  /** Vehicles as route-suggestion input, load taken from the live board state (not the server snapshot). */
  const routableVehicles = useCallback((): RoutableVehicle[] => {
    return initialColumns
      .filter((column) => column.vehicleId !== null)
      .map((column) => ({
        id: column.vehicleId as string,
        currentLoad: (columnsByKey[column.key] ?? []).reduce((sum, order) => sum + order.progress.total, 0),
        capacityUnits: column.capacityUnits,
      }));
  }, [initialColumns, columnsByKey]);

  /** toIndex is always a FULL-column index (not a filtered/visible index) — see handleCardDrop. */
  function handleDrop(toKey: string, toIndex: number) {
    setDragOverKey(null);
    if (!drag) return;

    const { orderId, fromKey } = drag;
    setDrag(null);
    if (fromKey === toKey && columnsByKey[fromKey]?.findIndex((o) => o.id === orderId) === toIndex) {
      return; // dropped back where it started
    }

    setColumnsByKey((current) => {
      const next = moveOrderBetweenColumns(current, orderId, fromKey, toKey, toIndex);
      const targetVehicleId = columnMeta.get(toKey)?.vehicleId ?? null;
      void commitColumn(
        targetVehicleId,
        next[toKey].map((order) => order.id)
      );
      if (fromKey !== toKey) {
        const targetName = columnMeta.get(toKey)?.name ?? "coloană";
        showToast(`Comandă mutată pe ${targetName}.`, "success");
      }
      return next;
    });
  }

  function moveOrderToColumn(order: OrderListRow, fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    setColumnsByKey((current) => {
      const toIndex = current[toKey]?.length ?? 0;
      const next = moveOrderBetweenColumns(current, order.id, fromKey, toKey, toIndex);
      void commitColumn(
        toKey === "unassigned" ? null : toKey,
        next[toKey].map((o) => o.id)
      );
      return next;
    });
    const targetName = columnMeta.get(toKey)?.name ?? "coloană";
    showToast(`Comandă mutată pe ${targetName}.`, "success");
  }

  function handleAssignRecommended(order: OrderListRow, fromKey: string) {
    const vehicles = routableVehicles();
    if (vehicles.length === 0) {
      showToast("Nicio mașină disponibilă pentru sugestie.", "error");
      return;
    }
    const routableOrder: RoutableOrder = { id: order.id, city: order.customer_city, unitCount: order.progress.total };
    const suggestedVehicleId = suggestRouteForOrder(routableOrder, vehicles);
    if (!suggestedVehicleId) {
      showToast("Nicio mașină disponibilă pentru sugestie.", "error");
      return;
    }
    if (suggestedVehicleId === fromKey) {
      showToast("Comanda este deja pe ruta recomandată.", "info");
      return;
    }
    moveOrderToColumn(order, fromKey, suggestedVehicleId);
  }

  function handleOptimizeRoutes() {
    const unassignedOrders = columnsByKey["unassigned"] ?? [];
    if (unassignedOrders.length === 0) {
      showToast("Nu există comenzi neasignate.", "info");
      return;
    }
    const vehicles = routableVehicles();
    if (vehicles.length === 0) {
      showToast("Nicio mașină disponibilă pentru sugestie.", "error");
      return;
    }

    const routableOrders: RoutableOrder[] = unassignedOrders.map((order) => ({
      id: order.id,
      city: order.customer_city,
      unitCount: order.progress.total,
    }));
    const assignments = suggestRouteAssignments(routableOrders, vehicles);
    if (assignments.length === 0) {
      showToast("Nicio sugestie disponibilă.", "info");
      return;
    }

    setColumnsByKey((current) => {
      const assignedIds = new Set(assignments.map((a) => a.orderId));
      const byOrderId = new Map(unassignedOrders.map((order) => [order.id, order]));
      const byVehicle = new Map<string, string[]>();
      for (const assignment of assignments) {
        const list = byVehicle.get(assignment.vehicleId) ?? [];
        list.push(assignment.orderId);
        byVehicle.set(assignment.vehicleId, list);
      }

      const next: Record<string, OrderListRow[]> = {
        ...current,
        unassigned: (current["unassigned"] ?? []).filter((order) => !assignedIds.has(order.id)),
      };

      for (const [vehicleId, orderIds] of byVehicle) {
        const moved = orderIds.map((id) => byOrderId.get(id)).filter((o): o is OrderListRow => Boolean(o));
        next[vehicleId] = [...(next[vehicleId] ?? []), ...moved];
        void commitColumn(
          vehicleId,
          next[vehicleId].map((o) => o.id)
        );
      }

      return next;
    });

    showToast(
      assignments.length === 1 ? "1 comandă asignată." : `${assignments.length} comenzi asignate.`,
      "success"
    );
  }

  // ---------------------------------------------------------------- derived

  const allOrders = useMemo(() => Object.values(columnsByKey).flat(), [columnsByKey]);
  const ordersForDate = useMemo(
    () => allOrders.filter((order) => order.planned_delivery_date === selectedDate),
    [allOrders, selectedDate]
  );
  const supplierOptions = useMemo(
    () => [...new Set(allOrders.map((order) => order.supplier_name).filter((name): name is string => Boolean(name)))].sort(),
    [allOrders]
  );

  const summary = useMemo(() => {
    const totalTyres = ordersForDate.reduce((sum, order) => sum + order.tyre_count, 0);
    const unassigned = ordersForDate.filter((order) => !order.vehicle_id).length;
    const waitingGoods = ordersForDate.filter(
      (order) => operationalStatus(order.status, order.progress.problem > 0).bucket === "waiting_goods"
    ).length;
    return { total: ordersForDate.length, totalTyres, unassigned, waitingGoods };
  }, [ordersForDate]);

  const quickFilterCounts = useMemo(() => {
    const counts = new Map<QuickFilter, number>();
    for (const filter of QUICK_FILTERS) {
      counts.set(filter.key, ordersForDate.filter((order) => matchesQuickFilter(order, filter.key)).length);
    }
    return counts;
  }, [ordersForDate]);

  function visibleOrdersFor(columnKey: string): OrderListRow[] {
    return (columnsByKey[columnKey] ?? []).filter(
      (order) =>
        order.planned_delivery_date === selectedDate &&
        matchesSearch(order, search) &&
        matchesQuickFilter(order, quickFilter) &&
        (supplierFilter === "all" || order.supplier_name === supplierFilter)
    );
  }

  const mapColumn = mapColumnKey ? columnMeta.get(mapColumnKey) : null;
  const activeOrder = openOrderId ? allOrders.find((o) => o.id === openOrderId) ?? null : null;

  function renderCard(order: OrderListRow, columnKey: string) {
    const fullList = columnsByKey[columnKey] ?? [];
    const fullIndex = fullList.findIndex((o) => o.id === order.id);
    const status = operationalStatus(order.status, order.progress.problem > 0);
    const moveTargets = initialColumns
      .filter((column) => column.key !== columnKey)
      .map((column) => ({ key: column.key, name: column.name }));

    return (
      <div
        key={order.id}
        draggable
        onDragStart={(event) => {
          setDrag({ orderId: order.id, fromKey: columnKey });
          justDraggedRef.current = true;
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          setDrag(null);
          setDragOverKey(null);
          window.setTimeout(() => {
            justDraggedRef.current = false;
          }, 0);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragOverKey(columnKey);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleDrop(columnKey, fullIndex);
        }}
        onClick={() => {
          if (justDraggedRef.current) return;
          setOpenOrderId(order.id);
        }}
        className={`cursor-pointer rounded-xl bg-white p-2.5 shadow-sm ring-1 ring-ink/5 transition hover:shadow-card active:cursor-grabbing ${
          drag?.orderId === order.id ? "opacity-40" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-semibold text-ink-soft">
            {formatOrderNumber(order.order_number)}
          </span>
          <div className="flex flex-none items-center gap-1">
            <span
              title={status.label}
              className="inline-flex items-center gap-1 rounded-md bg-surface-soft px-1.5 py-0.5 text-[10px] font-bold text-ink"
            >
              {status.emoji} {status.label}
            </span>
            <VehicleCardActionsMenu
              orderId={order.id}
              orderLabel={formatOrderNumber(order.order_number)}
              moveTargets={moveTargets}
              onAssignRecommended={() => handleAssignRecommended(order, columnKey)}
              onMoveTo={(targetKey) => moveOrderToColumn(order, columnKey, targetKey)}
            />
          </div>
        </div>

        <div className="mt-1 truncate text-sm font-bold text-ink">{order.customer_name ?? "—"}</div>
        {order.customer_address && (
          <div className="truncate text-[11px] text-ink-soft">{order.customer_address}</div>
        )}

        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="flex items-center gap-1 text-xs font-semibold text-ink">
              <TyreIcon className="h-3.5 w-3.5 flex-none text-ink-soft" />
              {order.tyre_count}
            </span>
            {order.supplier_name && (
              <span className="truncate rounded-md bg-state-neutral-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-state-neutral">
                {shortSupplierName(order.supplier_name)}
              </span>
            )}
          </div>
          <span className="flex-none text-[11px] text-ink-soft">{formatDate(order.planned_delivery_date)}</span>
        </div>
      </div>
    );
  }

  function renderColumnBody(column: VehicleColumnData, orders: OrderListRow[], isOver: boolean) {
    return (
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOverKey(column.key);
        }}
        onDragLeave={() => setDragOverKey((current) => (current === column.key ? null : current))}
        onDrop={(event) => {
          event.preventDefault();
          handleDrop(column.key, (columnsByKey[column.key] ?? []).length);
        }}
        className={`min-h-24 space-y-2 rounded-xl p-2 transition-colors ${isOver ? "bg-accent-light/50" : ""}`}
      >
        {orders.length === 0 && <p className="py-6 text-center text-xs text-ink-soft">Nicio comandă</p>}
        {orders.map((order) => renderCard(order, column.key))}
      </div>
    );
  }

  function renderColumnHeader(column: VehicleColumnData, orders: OrderListRow[]) {
    const unitCount = orders.reduce((sum, order) => sum + order.progress.total, 0);
    const stats = computeVehicleLoad(orders.length, unitCount, column.capacityUnits);
    const tyreCount = orders.reduce((sum, order) => sum + order.tyre_count, 0);

    return (
      <div className="flex items-center gap-3 px-1 pb-2">
        {column.number !== null ? (
          <VehicleIcon number={column.number} />
        ) : (
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-state-neutral-soft text-lg font-bold text-state-neutral">
            —
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-ink">{column.name}</div>
          <div className="text-xs text-ink-soft">
            {stats.orderCount} {stats.orderCount === 1 ? "oprire" : "opriri"} · {tyreCount} anvelope
            {stats.occupancyPercent !== null && ` · ${stats.occupancyPercent}%`}
          </div>
          {stats.occupancyPercent !== null && (
            <div className="mt-1 h-1 w-full max-w-[8rem] overflow-hidden rounded-full bg-ink/10">
              <div
                className={`h-full rounded-full ${stats.occupancyPercent > 100 ? "bg-state-danger" : "bg-accent"}`}
                style={{ width: `${Math.min(100, stats.occupancyPercent)}%` }}
              />
            </div>
          )}
          {stats.returnTrips > 0 && (
            <div className="mt-0.5 text-[11px] font-semibold text-state-warning">
              ⟲ {stats.returnTrips} {stats.returnTrips === 1 ? "revenire" : "reveniri"} la hală
            </div>
          )}
        </div>
        {column.vehicleId !== null && (
          <button
            type="button"
            onClick={() => setMapColumnKey(column.key)}
            className="flex-none rounded-lg px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-light"
          >
            Hartă
          </button>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Livrări">
      {/* ---------------------------------------------------------- summary */}
      <p className="mb-4 text-sm text-ink-soft">
        <strong className="text-ink">{summary.total}</strong> {summary.total === 1 ? "comandă" : "comenzi"} ·{" "}
        <strong className="text-ink">{summary.totalTyres}</strong> anvelope ·{" "}
        <strong className="text-ink">{summary.unassigned}</strong> neasignate ·{" "}
        <strong className="text-ink">{summary.waitingGoods}</strong> așteaptă marfa
      </p>

      {/* ------------------------------------------------------- date + CTA */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-ink-soft">Livrări pentru:</span>
          <button
            type="button"
            onClick={() => setSelectedDate((current) => addDays(current, -1))}
            aria-label="Ziua anterioară"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink/15 bg-white text-ink hover:bg-surface-soft"
          >
            ‹
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value || todayIso())}
            className="h-9 rounded-lg border border-ink/15 px-2 text-sm text-ink"
          />
          <button
            type="button"
            onClick={() => setSelectedDate((current) => addDays(current, 1))}
            aria-label="Ziua următoare"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink/15 bg-white text-ink hover:bg-surface-soft"
          >
            ›
          </button>
          {selectedDate !== todayIso() && (
            <button
              type="button"
              onClick={() => setSelectedDate(todayIso())}
              className="h-9 rounded-lg px-3 text-sm font-semibold text-accent hover:bg-accent-light"
            >
              Astăzi
            </button>
          )}
          <span className="hidden text-sm text-ink-soft sm:inline">{formatDateLong(selectedDate)}</span>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/warehouse"
            className="hidden h-10 items-center justify-center rounded-xl border border-ink/15 bg-white px-4 text-sm font-semibold text-ink hover:bg-surface-soft sm:flex"
          >
            Scanează / Recepție
          </Link>
          <button
            type="button"
            onClick={handleOptimizeRoutes}
            className="h-10 rounded-xl bg-accent px-4 text-sm font-bold text-white hover:bg-accent-dark"
          >
            Optimizează rutele
          </button>
        </div>
      </div>

      {/* --------------------------------------------------------- filters */}
      <div className="mb-4 space-y-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Caută client / comandă / adresă / furnizor"
          className="h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus:border-accent sm:max-w-sm"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_FILTERS.map((filter) => {
            const count = quickFilterCounts.get(filter.key) ?? 0;
            const active = quickFilter === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setQuickFilter(filter.key)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? "border-accent bg-accent-light text-accent-dark"
                    : "border-ink/15 bg-white text-ink-soft hover:bg-surface-soft"
                }`}
              >
                {filter.label}
                {filter.key !== "all" && <span className="ml-1 tabular-nums opacity-70">{count}</span>}
              </button>
            );
          })}

          {supplierOptions.length > 1 && (
            <select
              value={supplierFilter}
              onChange={(event) => setSupplierFilter(event.target.value)}
              className="h-8 rounded-full border border-ink/15 bg-white px-3 text-xs font-semibold text-ink-soft"
            >
              <option value="all">Toți furnizorii</option>
              {supplierOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------- board */}

      {/* Desktop / tablet landscape: full Kanban row. */}
      <div className="hidden gap-3 overflow-x-auto pb-2 lg:flex">
        {initialColumns.map((column) => {
          const orders = visibleOrdersFor(column.key);
          const isOver = dragOverKey === column.key;
          return (
            <div key={column.key} className="w-72 flex-none rounded-2xl bg-surface-soft p-2">
              {renderColumnHeader(column, orders)}
              {renderColumnBody(column, orders, isOver)}
            </div>
          );
        })}
      </div>

      {/* Mobile / tablet portrait: one column at a time via tabs. */}
      <div className="lg:hidden">
        <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          {initialColumns.map((column) => {
            const count = visibleOrdersFor(column.key).length;
            const active = mobileColumnKey === column.key;
            return (
              <button
                key={column.key}
                type="button"
                onClick={() => setMobileColumnKey(column.key)}
                className={`flex-none rounded-full border px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? "border-accent bg-accent-light text-accent-dark"
                    : "border-ink/15 bg-white text-ink-soft"
                }`}
              >
                {column.name}
                {column.number !== null ? ` ${column.number}` : ""} · {count}
              </button>
            );
          })}
        </div>

        {(() => {
          const column = initialColumns.find((c) => c.key === mobileColumnKey) ?? initialColumns[0];
          if (!column) return null;
          const orders = visibleOrdersFor(column.key);
          return (
            <div className="rounded-2xl bg-surface-soft p-2">
              {renderColumnHeader(column, orders)}
              {renderColumnBody(column, orders, dragOverKey === column.key)}
            </div>
          );
        })()}

        <Link
          href="/warehouse"
          className="mt-4 flex h-11 items-center justify-center rounded-xl border border-ink/15 bg-white text-sm font-semibold text-ink"
        >
          Scanează / Recepție
        </Link>
      </div>

      {activeOrder && <OrderDetailModal orderId={activeOrder.id} onClose={() => setOpenOrderId(null)} />}

      {mapColumn && (
        <RouteStopsModal
          vehicleName={mapColumn.name}
          orders={columnsByKey[mapColumn.key] ?? []}
          depotLocation={depotLocation}
          onClose={() => setMapColumnKey(null)}
        />
      )}
    </section>
  );
}

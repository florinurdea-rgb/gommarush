"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OrderDetailModal } from "@/components/logistics/OrderDetailModal";
import { VehicleCardActionsMenu } from "@/components/logistics/VehicleCardActionsMenu";
import { VehicleLaneMenu } from "@/components/logistics/VehicleLaneMenu";
import { FleetManagementModal } from "@/components/logistics/FleetManagementModal";
import { RouteStopsModal } from "@/components/logistics/RouteStopsModal";
import { TyreIcon } from "@/components/logistics/TyreIcon";
import { useToast } from "@/components/ui/Toast";
import { useRealtimeSignal } from "@/hooks/useRealtimeSignal";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { computeVehicleLoad, moveOrderBetweenColumns } from "@/lib/logistics/vehicle-board";
import { suggestRouteAssignments, suggestRouteForOrder } from "@/lib/logistics/route-suggestion";
import { operationalStatus, OPERATIONAL_BUCKETS, operationalBucketMeta } from "@/lib/logistics/operational-status";
import type { OperationalBucket } from "@/lib/logistics/operational-status";
import { VAN_BORDER_CLASS } from "@/lib/logistics/vehicle-colors";
import { PickupIcon } from "@/components/logistics/SummaryIcons";
import type { RoutableOrder, RoutableVehicle } from "@/lib/logistics/route-suggestion";
import type { OrderListRow } from "@/lib/server/orders";
import type { VehicleRow } from "@/lib/types/logistics";

/**
 * "Livrări" — the day-scoped, high-density dispatch board: orders grouped
 * under the vehicle they're assigned to, draggable between vehicles and
 * reorderable within one ("ordinea livrării"). Owns its own date/search/
 * status filter state entirely client-side, so switching days or typing a
 * search never re-fetches — every active order (any date) is fetched once
 * by the server page and filtered here.
 *
 * Compact by design (redesign brief "5-van board"): the priority is more
 * orders visible on one office monitor, not decorative widgets — see
 * renderCard/renderColumnHeader below for the deliberately small type scale.
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
  colorKey: string | null;
  orders: OrderListRow[];
}

type QuickFilter = "all" | "unassigned" | OperationalBucket;

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

/** "Via Santa Fosca, NR. 25, 37030 Dueville" -> "Santa Fosca 25" — street + number only, one line. */
function shortAddress(address: string | null): string | null {
  if (!address) return null;
  const withoutPrefix = address.replace(/^(via|viale|piazza|corso|strada)\s+/i, "");
  const firstSegment = withoutPrefix.split(",")[0]?.trim();
  return firstSegment || null;
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

/**
 * 12s: near-live without hammering the server — this is a low-concurrency
 * internal admin tool (a handful of staff, not thousands of users), so a
 * plain router.refresh() every 12s is cheap, and Next only re-runs the
 * server component, it doesn't remount the page — client state (search
 * text, open menus) survives every tick. Paused on a hidden tab and while
 * the user is mid-interaction (drag, an open drawer/modal) so a refresh
 * never yanks something out from under them.
 */
export function VehicleBoard({
  columns: initialColumns,
  vehicles,
  depotLocation,
}: {
  columns: VehicleColumnData[];
  /** Raw fleet list (including any deactivated ones may pass through, though the server only sends active) — feeds the fleet management sheet, which needs registration/display_order beyond what a column carries. */
  vehicles: VehicleRow[];
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
  const [fleetModalOpen, setFleetModalOpen] = useState(false);
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

  // Keeps the board up to date without a manual reload — reacts to the
  // 'gorush-ops' Realtime broadcast (see useRealtimeSignal.ts) rather than
  // polling blindly, and stays paused whenever the user is mid-interaction
  // (dragging, or has the order drawer / route map / fleet sheet open), so
  // a refresh never yanks focus or a card out from under them.
  const interactionActive = drag !== null || openOrderId !== null || mapColumnKey !== null || fleetModalOpen;
  const interactionActiveRef = useRef(interactionActive);
  interactionActiveRef.current = interactionActive;
  useRealtimeSignal(() => {
    if (interactionActiveRef.current) return;
    router.refresh();
  });

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

  const bucketCounts = useMemo(() => {
    const counts = new Map<OperationalBucket, number>();
    for (const bucket of OPERATIONAL_BUCKETS) {
      counts.set(bucket, ordersForDate.filter((order) => matchesQuickFilter(order, bucket)).length);
    }
    return counts;
  }, [ordersForDate]);
  const unassignedCount = useMemo(() => ordersForDate.filter((order) => !order.vehicle_id).length, [ordersForDate]);

  /** vehicleId -> currently assigned order count, for the fleet sheet's remove-confirmation copy — no separate fetch needed. */
  const orderCountsByVehicle = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const column of initialColumns) {
      if (column.vehicleId) counts[column.vehicleId] = (columnsByKey[column.key] ?? []).length;
    }
    return counts;
  }, [initialColumns, columnsByKey]);

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
    const address = shortAddress(order.customer_address);

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
        className={`cursor-pointer rounded-lg bg-white p-2 shadow-sm ring-1 ring-ink/5 transition hover:shadow-card active:cursor-grabbing ${
          drag?.orderId === order.id ? "opacity-40" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-1.5">
          <span className="font-mono text-[11px] font-semibold text-ink-soft">
            {formatOrderNumber(order.order_number)}
          </span>
          <div className="flex flex-none items-center gap-0.5">
            <span
              title={status.label}
              className="inline-flex items-center gap-0.5 rounded-md bg-surface-soft px-1 py-0.5 text-[10px] font-bold leading-none text-ink"
            >
              {status.emoji}
            </span>
            <VehicleCardActionsMenu
              orderId={order.id}
              orderLabel={formatOrderNumber(order.order_number)}
              currentStatus={order.status}
              hasVehicle={columnKey !== "unassigned"}
              amountToCollect={order.amount_to_collect}
              cashOnDelivery={order.cash_on_delivery}
              moveTargets={moveTargets}
              onAssignRecommended={() => handleAssignRecommended(order, columnKey)}
              onMoveTo={(targetKey) => moveOrderToColumn(order, columnKey, targetKey)}
            />
          </div>
        </div>

        <div className="mt-0.5 truncate text-[13px] font-bold leading-tight text-ink">
          {order.customer_name ?? "—"}
        </div>

        <div className="mt-1 flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1 text-[11px] font-semibold text-ink">
            <TyreIcon className="h-3 w-3 flex-none text-ink-soft" />
            <span>{order.tyre_count} anv.</span>
            {order.supplier_name && (
              <>
                <span className="text-ink-soft">·</span>
                <span className="truncate text-ink-soft">{shortSupplierName(order.supplier_name)}</span>
              </>
            )}
          </div>
          <span className="flex-none text-[10px] text-ink-soft">{formatDate(order.planned_delivery_date)}</span>
        </div>
        {address && <div className="mt-0.5 truncate text-[10px] text-ink-soft">{address}</div>}
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
        className={`min-h-16 flex-1 space-y-1.5 overflow-y-auto rounded-lg p-1.5 transition-colors ${isOver ? "bg-accent-light/50" : ""}`}
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
      <div className="flex items-start gap-1.5 px-1.5 pb-1.5 pt-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-ink">{column.name}</div>
          <div className="text-[11px] text-ink-soft">
            {stats.orderCount} {stats.orderCount === 1 ? "oprire" : "opriri"} · {tyreCount} anv.
          </div>
          {stats.occupancyPercent !== null && (
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-ink/10">
              <div
                className={`h-full rounded-full ${stats.occupancyPercent > 100 ? "bg-state-danger" : "bg-accent"}`}
                style={{ width: `${Math.min(100, stats.occupancyPercent)}%` }}
              />
            </div>
          )}
          {stats.returnTrips > 0 && (
            <div className="mt-0.5 text-[10px] font-semibold text-state-warning">
              ⟲ {stats.returnTrips} {stats.returnTrips === 1 ? "revenire" : "reveniri"}
            </div>
          )}
        </div>
        {column.vehicleId !== null ? (
          <VehicleLaneMenu
            vehicleId={column.vehicleId}
            vehicleName={column.name}
            orderCount={orderCountsByVehicle[column.vehicleId] ?? 0}
            onOpenMap={() => setMapColumnKey(column.key)}
          />
        ) : (
          <span className="flex-none rounded-md bg-state-warning-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-state-warning">
            Necesită dispecerizare
          </span>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Livrări">
      {/* ------------------------------------------------- compact status strip */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-ink/10 bg-white px-3 py-2">
        <span className="text-xs font-semibold text-ink-soft">
          <strong className="text-ink">{unassignedCount}</strong> neasignate
        </span>
        {OPERATIONAL_BUCKETS.map((bucket) => {
          const meta = operationalBucketMeta(bucket);
          return (
            <span key={bucket} className="text-xs font-semibold text-ink-soft">
              {meta.emoji} <strong className="text-ink">{bucketCounts.get(bucket) ?? 0}</strong> {meta.label}
            </span>
          );
        })}
      </div>

      {/* --------------------------------------------------- fleet overview */}
      {/* A grid, not a horizontal-scroll row: it must wrap to more rows on a
          narrow screen rather than ever needing its own scrollbar, per the
          brief — unlike the Kanban below (which legitimately scrolls past
          5 vans), this is just an at-a-glance load summary. */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {initialColumns.map((column) => {
          const orders = columnsByKey[column.key] ?? [];
          const unitCount = orders.reduce((sum, order) => sum + order.progress.total, 0);
          const stats = computeVehicleLoad(orders.length, unitCount, column.capacityUnits);
          const borderClass =
            column.key === "unassigned"
              ? "border-t-state-warning"
              : VAN_BORDER_CLASS[(column.colorKey as keyof typeof VAN_BORDER_CLASS) ?? "default"] ?? VAN_BORDER_CLASS.default;

          return (
            <div
              key={column.key}
              className={`rounded-xl border-t-[3px] bg-white p-2.5 shadow-card ${borderClass}`}
            >
              <div className="flex items-center gap-1.5">
                <PickupIcon className="h-4 w-4 flex-none text-ink-soft" />
                <span className="truncate text-xs font-bold text-ink">{column.name}</span>
              </div>
              <div className="mt-1 text-[11px] text-ink-soft">
                {stats.orderCount} {stats.orderCount === 1 ? "cursă" : "curse"}
              </div>
              {stats.occupancyPercent !== null ? (
                <>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-soft">
                    <div
                      className={`h-full rounded-full ${stats.occupancyPercent > 100 ? "bg-state-danger" : "bg-accent"}`}
                      style={{ width: `${Math.min(100, stats.occupancyPercent)}%` }}
                    />
                  </div>
                  <div className="mt-0.5 text-[11px] font-bold text-ink">{stats.occupancyPercent}%</div>
                </>
              ) : (
                <div className="mt-1 text-[11px] text-ink-soft">—</div>
              )}
            </div>
          );
        })}
      </div>

      {/* ------------------------------------------------------- date + CTA */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Caută client / comandă / adresă / furnizor"
          className="h-9 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus:border-accent sm:max-w-[220px]"
        />

        <select
          value={quickFilter}
          onChange={(event) => setQuickFilter(event.target.value as QuickFilter)}
          className="h-9 rounded-lg border border-ink/15 bg-white px-2 text-xs font-semibold text-ink-soft"
        >
          <option value="all">Toate statusurile</option>
          <option value="unassigned">Neasignate</option>
          {OPERATIONAL_BUCKETS.map((bucket) => (
            <option key={bucket} value={bucket}>
              {operationalBucketMeta(bucket).label}
            </option>
          ))}
        </select>

        {supplierOptions.length > 1 && (
          <select
            value={supplierFilter}
            onChange={(event) => setSupplierFilter(event.target.value)}
            className="h-9 rounded-lg border border-ink/15 bg-white px-2 text-xs font-semibold text-ink-soft"
          >
            <option value="all">Toți furnizorii</option>
            {supplierOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFleetModalOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 text-xs font-semibold text-ink hover:bg-surface-soft"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 6h14M3 10h14M3 14h8" strokeLinecap="round" />
              <circle cx="15" cy="14" r="1.6" />
            </svg>
            Gestionează mașinile
          </button>
        </div>
      </div>

      {/* ----------------------------------------------------------- board */}

      {/* Desktop / tablet landscape: full-width Kanban row, up to 5 vans + Neasignate fit without horizontal scroll. */}
      <div className="hidden gap-2 overflow-x-auto pb-2 lg:flex" style={{ height: "calc(100vh - 340px)", minHeight: "420px" }}>
        {initialColumns.map((column) => {
          const orders = visibleOrdersFor(column.key);
          const isOver = dragOverKey === column.key;
          const borderClass =
            column.key === "unassigned"
              ? "border-t-state-warning bg-state-warning-soft/40"
              : `${VAN_BORDER_CLASS[(column.colorKey as keyof typeof VAN_BORDER_CLASS) ?? "default"] ?? VAN_BORDER_CLASS.default} bg-surface-soft`;
          return (
            <div
              key={column.key}
              className={`flex min-w-[190px] max-w-[260px] flex-1 basis-0 flex-col rounded-xl border-t-[3px] p-1.5 ${borderClass}`}
            >
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
          <button
            type="button"
            onClick={() => setFleetModalOpen(true)}
            className="flex-none rounded-full border border-ink/15 bg-white px-3 py-2 text-sm font-semibold text-ink-soft"
          >
            Mașini ⚙
          </button>
        </div>

        {(() => {
          const column = initialColumns.find((c) => c.key === mobileColumnKey) ?? initialColumns[0];
          if (!column) return null;
          const orders = visibleOrdersFor(column.key);
          return (
            <div className="flex flex-col rounded-2xl bg-surface-soft p-2" style={{ height: "calc(100vh - 420px)", minHeight: "360px" }}>
              {renderColumnHeader(column, orders)}
              {renderColumnBody(column, orders, dragOverKey === column.key)}
            </div>
          );
        })()}
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

      {fleetModalOpen && (
        <FleetManagementModal
          vehicles={vehicles}
          orderCounts={orderCountsByVehicle}
          onClose={() => setFleetModalOpen(false)}
        />
      )}
    </section>
  );
}

"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { VehicleIcon } from "@/components/logistics/VehicleIcon";
import { OrderStatusBadge } from "@/components/logistics/StatusBadge";
import { OrderDetailModal } from "@/components/logistics/OrderDetailModal";
import { VehicleCardActionsMenu } from "@/components/logistics/VehicleCardActionsMenu";
import { RouteStopsModal } from "@/components/logistics/RouteStopsModal";
import { TyreIcon } from "@/components/logistics/TyreIcon";
import { useToast } from "@/components/ui/Toast";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { computeVehicleLoad, moveOrderBetweenColumns } from "@/lib/logistics/vehicle-board";
import { suggestRouteAssignments, suggestRouteForOrder } from "@/lib/logistics/route-suggestion";
import type { RoutableOrder, RoutableVehicle } from "@/lib/logistics/route-suggestion";
import type { OrderListRow } from "@/lib/server/orders";

/**
 * The dashboard's vehicle board: orders grouped under the vehicle they're
 * assigned to, draggable between vehicles and reorderable within one —
 * "ordinea livrării" (delivery order) for that van. A card click opens a
 * quick-look modal instead of navigating away from the board.
 *
 * Native HTML5 drag-and-drop, deliberately not a library: this is a
 * desktop-first admin tool (see AdminShell), the interaction is a plain
 * "pick up a card, drop it somewhere in a list", and the browser API covers
 * that without adding a dependency.
 *
 * State is optimistic: a drop updates the local column immediately, fires
 * the write, and reconciles with router.refresh() once it settles (success
 * or failure) so the board never drifts from the database for long.
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

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short" }).format(date);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function VehicleBoard({ columns: initialColumns }: { columns: VehicleColumnData[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [columnsByKey, setColumnsByKey] = useState<Record<string, OrderListRow[]>>(() =>
    Object.fromEntries(initialColumns.map((column) => [column.key, column.orders]))
  );
  const [drag, setDrag] = useState<{ orderId: string; fromKey: string } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [mapColumnKey, setMapColumnKey] = useState<string | null>(null);
  const [occupancyDate, setOccupancyDate] = useState<string>(todayIso());
  // Suppresses the click that would otherwise open the modal right after a
  // real drag-and-drop — see the click handler below.
  const justDraggedRef = useRef(false);

  const columnMeta = useMemo(
    () => new Map(initialColumns.map((column) => [column.key, column])),
    [initialColumns]
  );

  const commitColumn = useCallback(
    async (vehicleId: string | null, orderedOrderIds: string[]) => {
      try {
        const response = await fetch("/api/admin/orders/reorder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vehicleId, orderedOrderIds }),
        });
        const payload = (await response.json()) as { ok: boolean };
        if (!payload.ok) setError("Mutarea nu a putut fi salvată. Se reîncarcă lista.");
      } catch {
        setError("Eroare de rețea. Se reîncarcă lista.");
      } finally {
        router.refresh();
      }
    },
    [router]
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

  function handleAssignRecommended(order: OrderListRow, fromKey: string) {
    const vehicles = routableVehicles();
    if (vehicles.length === 0) {
      showToast("Nicio mașină disponibilă pentru sugestie.", "error");
      return;
    }
    const routableOrder: RoutableOrder = {
      id: order.id,
      city: order.customer_city,
      unitCount: order.progress.total,
    };
    const suggestedVehicleId = suggestRouteForOrder(routableOrder, vehicles);
    if (!suggestedVehicleId) {
      showToast("Nicio mașină disponibilă pentru sugestie.", "error");
      return;
    }
    if (suggestedVehicleId === fromKey) {
      showToast("Comanda este deja pe ruta recomandată.", "info");
      return;
    }

    setColumnsByKey((current) => {
      const toIndex = current[suggestedVehicleId]?.length ?? 0;
      const next = moveOrderBetweenColumns(current, order.id, fromKey, suggestedVehicleId, toIndex);
      void commitColumn(
        suggestedVehicleId,
        next[suggestedVehicleId].map((o) => o.id)
      );
      return next;
    });

    const vehicleName = columnMeta.get(suggestedVehicleId)?.name ?? "mașină";
    showToast(`Comandă mutată pe ${vehicleName} (rută recomandată).`, "success");
  }

  function handleBulkAssignRecommended() {
    const unassignedOrders = columnsByKey["unassigned"] ?? [];
    if (unassignedOrders.length === 0) {
      showToast("Nu există comenzi în Așteaptă asignare.", "info");
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
      assignments.length === 1
        ? "1 comandă asignată în ruta recomandată."
        : `${assignments.length} comenzi asignate în rutele recomandate.`,
      "success"
    );
  }

  const mapColumn = mapColumnKey ? columnMeta.get(mapColumnKey) : null;

  return (
    <section aria-label="Mașini" className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-ink-soft">
          <label htmlFor="occupancy-date" className="font-semibold">
            Ocupare pentru ziua:
          </label>
          <input
            id="occupancy-date"
            type="date"
            value={occupancyDate}
            onChange={(event) => setOccupancyDate(event.target.value)}
            className="h-9 rounded-lg border border-ink/15 px-2 text-sm text-ink"
          />
        </div>
        <button
          type="button"
          onClick={handleBulkAssignRecommended}
          className="h-10 rounded-xl bg-accent px-4 text-sm font-bold text-white hover:bg-accent-dark"
        >
          Asignează toate comenzile rute recomandate
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-state-danger-soft px-3 py-2 text-sm font-semibold text-state-danger">
          {error}
        </p>
      )}

      <div className="flex gap-4 overflow-x-auto pb-2">
        {initialColumns.map((column) => {
          const orders = columnsByKey[column.key] ?? [];
          const unitCount = orders.reduce((sum, order) => sum + order.progress.total, 0);
          const stats = computeVehicleLoad(orders.length, unitCount, column.capacityUnits);

          const dayOrders = orders.filter((order) => order.planned_delivery_date === occupancyDate);
          const dayUnitCount = dayOrders.reduce((sum, order) => sum + order.progress.total, 0);
          const dayStats = computeVehicleLoad(dayOrders.length, dayUnitCount, column.capacityUnits);

          const isOver = dragOverKey === column.key;

          return (
            <div
              key={column.key}
              className={`w-64 flex-none rounded-2xl transition-colors ${isOver ? "bg-accent-light/50" : "bg-surface-soft"}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOverKey(column.key);
              }}
              onDragLeave={() => setDragOverKey((current) => (current === column.key ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                handleDrop(column.key, orders.length);
              }}
            >
              <div className="flex flex-col items-center px-3 pb-3 pt-4 text-center">
                {column.number !== null ? (
                  <VehicleIcon number={column.number} />
                ) : (
                  <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-state-neutral-soft text-lg font-bold text-state-neutral">
                    —
                  </span>
                )}
                <div className="mt-1.5 text-sm font-bold text-ink">{column.name}</div>
                <div className="mt-0.5 text-xs text-ink-soft">
                  {stats.orderCount} {stats.orderCount === 1 ? "comandă" : "comenzi"}
                  {stats.occupancyPercent !== null && ` · ${stats.occupancyPercent}%`}
                </div>

                {stats.occupancyPercent !== null && (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ink/10">
                    <div
                      className={`h-full rounded-full ${stats.occupancyPercent > 100 ? "bg-state-danger" : "bg-accent"}`}
                      style={{ width: `${Math.min(100, stats.occupancyPercent)}%` }}
                    />
                  </div>
                )}

                {stats.returnTrips > 0 && (
                  <div className="mt-1.5 text-xs font-semibold text-state-warning">
                    ⟲ {stats.returnTrips} {stats.returnTrips === 1 ? "revenire" : "reveniri"} la hală
                  </div>
                )}

                {column.vehicleId !== null && (
                  <div className="mt-1.5 text-[11px] text-ink-soft">
                    {formatDate(occupancyDate)}: {dayStats.orderCount}{" "}
                    {dayStats.orderCount === 1 ? "comandă" : "comenzi"}
                    {dayStats.occupancyPercent !== null && ` · ${dayStats.occupancyPercent}%`}
                  </div>
                )}

                {column.vehicleId !== null && (
                  <button
                    type="button"
                    onClick={() => setMapColumnKey(column.key)}
                    className="mt-1.5 text-xs font-semibold text-accent hover:underline"
                  >
                    Hartă
                  </button>
                )}
              </div>

              <div className="min-h-20 space-y-2 px-3 pb-3">
                {orders.length === 0 && (
                  <p className="py-6 text-center text-xs text-ink-soft">Nicio comandă</p>
                )}

                {orders.map((order, index) => (
                  <div
                    key={order.id}
                    draggable
                    onDragStart={(event) => {
                      setDrag({ orderId: order.id, fromKey: column.key });
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
                      setDragOverKey(column.key);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleDrop(column.key, index);
                    }}
                    onClick={() => {
                      if (justDraggedRef.current) return;
                      setOpenOrderId(order.id);
                    }}
                    className={`cursor-pointer rounded-2xl bg-white p-3 shadow-sm ring-1 ring-ink/5 transition hover:shadow-card active:cursor-grabbing ${
                      drag?.orderId === order.id ? "opacity-40" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="flex h-4 min-w-4 flex-none items-center justify-center rounded-full bg-ink/10 px-1 text-[10px] font-bold tabular-nums text-ink-soft">
                          {index + 1}
                        </span>
                        <span className="truncate font-mono text-xs font-semibold text-ink-soft">
                          {formatOrderNumber(order.order_number)}
                        </span>
                      </div>
                      <div className="flex flex-none items-center gap-1">
                        <OrderStatusBadge status={order.status} size="sm" />
                        <VehicleCardActionsMenu
                          orderId={order.id}
                          orderLabel={formatOrderNumber(order.order_number)}
                          onAssignRecommended={() => handleAssignRecommended(order, column.key)}
                        />
                      </div>
                    </div>
                    <div className="mt-1.5 truncate text-sm font-bold text-ink">
                      {order.customer_name ?? "—"}
                    </div>
                    {order.supplier_name && (
                      <span className="mt-1 inline-flex max-w-full truncate rounded-md bg-state-neutral-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-state-neutral">
                        {order.supplier_name}
                      </span>
                    )}
                    {order.customer_address && (
                      <div className="mt-1 truncate text-[11px] text-ink-soft">{order.customer_address}</div>
                    )}
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-xs font-semibold text-ink">
                        <TyreIcon className="h-3.5 w-3.5 flex-none text-ink-soft" />
                        {order.tyre_count}
                      </span>
                      <span className="text-xs text-ink-soft">{formatDate(order.planned_delivery_date)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {openOrderId && <OrderDetailModal orderId={openOrderId} onClose={() => setOpenOrderId(null)} />}

      {mapColumn && (
        <RouteStopsModal
          vehicleName={mapColumn.name}
          orders={columnsByKey[mapColumn.key] ?? []}
          onClose={() => setMapColumnKey(null)}
        />
      )}
    </section>
  );
}

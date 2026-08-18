"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { VehicleIcon } from "@/components/logistics/VehicleIcon";
import { StandBadge } from "@/components/logistics/StandBadge";
import { OrderStatusBadge } from "@/components/logistics/StatusBadge";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { computeVehicleLoad, moveOrderBetweenColumns } from "@/lib/logistics/vehicle-board";
import type { OrderListRow } from "@/lib/server/orders";

/**
 * The dashboard's vehicle board: orders grouped under the vehicle they're
 * assigned to, draggable between vehicles and reorderable within one —
 * "ordinea livrării" (delivery order) for that van.
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

export function VehicleBoard({ columns: initialColumns }: { columns: VehicleColumnData[] }) {
  const router = useRouter();
  const [columnsByKey, setColumnsByKey] = useState<Record<string, OrderListRow[]>>(() =>
    Object.fromEntries(initialColumns.map((column) => [column.key, column.orders]))
  );
  const [drag, setDrag] = useState<{ orderId: string; fromKey: string } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Column metadata (name/icon/capacity) doesn't change from a drag — only
  // order membership does — so it's read straight from props each render.
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
      return next;
    });
  }

  return (
    <section aria-label="Mașini" className="mb-6">
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
          const isOver = dragOverKey === column.key;

          return (
            <div
              key={column.key}
              className={`w-72 flex-none rounded-2xl border bg-white shadow-card transition-colors ${
                isOver ? "border-accent bg-accent-light/40" : "border-ink/10"
              }`}
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
              <div className="border-b border-ink/10 p-3">
                <div className="flex items-center gap-3">
                  {column.number !== null ? (
                    <VehicleIcon number={column.number} className="h-11 w-20 flex-none" />
                  ) : (
                    <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border-2 border-dashed border-state-warning/50 bg-state-warning-soft text-lg font-black text-state-warning">
                      ?
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-ink">{column.name}</div>
                    <div className="text-xs text-ink-soft">
                      {stats.orderCount} {stats.orderCount === 1 ? "comandă" : "comenzi"} · {stats.unitCount} buc
                      {stats.occupancyPercent !== null && ` · ${stats.occupancyPercent}%`}
                    </div>
                  </div>
                </div>

                {stats.occupancyPercent !== null && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-soft">
                    <div
                      className={`h-full rounded-full ${stats.occupancyPercent > 100 ? "bg-state-danger" : "bg-accent"}`}
                      style={{ width: `${Math.min(100, stats.occupancyPercent)}%` }}
                    />
                  </div>
                )}

                {stats.returnTrips > 0 && (
                  <div className="mt-2 rounded-md bg-state-warning-soft px-2 py-1 text-xs font-bold text-state-warning">
                    ⟲ {stats.returnTrips} {stats.returnTrips === 1 ? "revenire" : "reveniri"} la hală
                  </div>
                )}
              </div>

              <div className="min-h-24 space-y-2 p-3">
                {orders.length === 0 && (
                  <p className="py-4 text-center text-xs text-ink-soft">Nicio comandă</p>
                )}

                {orders.map((order, index) => (
                  <div
                    key={order.id}
                    draggable
                    onDragStart={(event) => {
                      setDrag({ orderId: order.id, fromKey: column.key });
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setDragOverKey(null);
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
                    className={`cursor-grab rounded-lg border border-ink/10 bg-white p-2.5 active:cursor-grabbing ${
                      drag?.orderId === order.id ? "opacity-40" : "hover:border-accent/40"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <StandBadge standCode={order.stand_code} size="sm" />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          draggable={false}
                          className="font-mono text-xs font-bold text-accent hover:underline"
                        >
                          {formatOrderNumber(order.order_number)}
                        </Link>
                        <div className="truncate text-sm font-semibold text-ink">
                          {order.customer_name ?? "—"}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <OrderStatusBadge status={order.status} size="sm" />
                          <span className="text-xs text-ink-soft">{formatDate(order.planned_delivery_date)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

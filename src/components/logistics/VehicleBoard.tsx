"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { VehicleIcon } from "@/components/logistics/VehicleIcon";
import { OrderStatusBadge } from "@/components/logistics/StatusBadge";
import { OrderDetailModal } from "@/components/logistics/OrderDetailModal";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { computeVehicleLoad, moveOrderBetweenColumns } from "@/lib/logistics/vehicle-board";
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

export function VehicleBoard({ columns: initialColumns }: { columns: VehicleColumnData[] }) {
  const router = useRouter();
  const [columnsByKey, setColumnsByKey] = useState<Record<string, OrderListRow[]>>(() =>
    Object.fromEntries(initialColumns.map((column) => [column.key, column.orders]))
  );
  const [drag, setDrag] = useState<{ orderId: string; fromKey: string } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
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
    <section aria-label="Mașini" className="mb-8">
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
                      <span className="font-mono text-xs font-semibold text-ink-soft">
                        {formatOrderNumber(order.order_number)}
                      </span>
                      <OrderStatusBadge status={order.status} size="sm" />
                    </div>
                    <div className="mt-1.5 truncate text-sm font-bold text-ink">
                      {order.customer_name ?? "—"}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-soft">{formatDate(order.planned_delivery_date)}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {openOrderId && <OrderDetailModal orderId={openOrderId} onClose={() => setOpenOrderId(null)} />}
    </section>
  );
}

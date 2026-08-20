"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useFeedbackSounds } from "@/hooks/useFeedbackSounds";
import { DriverRouteMapModal } from "@/components/logistics/DriverRouteMapModal";
import type { DriverRouteStop } from "@/components/logistics/DriverRouteMapModal";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { errorMessage, orderStatusMeta } from "@/lib/i18n/logistics";
import type { DriverOrderSummary } from "@/lib/server/loading";

/**
 * The driver's home screen — Phase 1, order-level, no tyre scanning.
 *
 * TODAY summary, next stop, and the full run in delivery order. Every
 * order card offers exactly the actions valid for its current status:
 * NAVIGATE always; MARK AS LOADED while stored/ready; MARK DELIVERED (with
 * optional COD) and DELIVERY FAILED while loaded/out for delivery. Large
 * touch targets, mobile-first, no scanner screens, no database terminology.
 */

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Numerar",
  card: "Card",
  bank_transfer: "Transfer bancar",
  already_paid: "Deja achitat",
  other: "Altă metodă",
};

function navigateUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export function DriverHome({
  driverName,
  vehicleName,
  orders,
  summary,
  stops,
  depotLocation,
}: {
  driverName: string;
  vehicleName: string | null;
  orders: DriverOrderSummary[];
  summary: { orderCount: number; tyreCount: number; codTotal: number; remainingCount: number };
  stops: DriverRouteStop[];
  depotLocation: { lat: number; lng: number } | null;
}) {
  const router = useRouter();
  const sounds = useFeedbackSounds();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deliverOpenId, setDeliverOpenId] = useState<string | null>(null);
  const [failedOpenId, setFailedOpenId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const runAction = useCallback(
    async (url: string, body: Record<string, unknown>, orderId: string) => {
      setBusyId(orderId);
      setError(null);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as { ok: boolean; code?: string };
        if (!payload.ok) {
          sounds.feedback("error");
          setError(errorMessage(payload.code));
          return false;
        }
        sounds.feedback("success");
        router.refresh();
        return true;
      } catch {
        sounds.feedback("error");
        setError(errorMessage("UNKNOWN"));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [router, sounds]
  );

  const markLoaded = useCallback(
    (orderId: string) => void runAction("/api/driver/mark-loaded", { order_id: orderId }, orderId),
    [runAction]
  );

  const confirmDeliver = useCallback(
    async (order: DriverOrderSummary) => {
      const parsedAmount = amount.trim().length > 0 ? Number(amount) : null;
      const done = await runAction(
        "/api/driver/deliver-order",
        {
          order_id: order.id,
          amount_collected: parsedAmount != null && Number.isFinite(parsedAmount) ? parsedAmount : null,
          payment_method: amount.trim().length > 0 ? method : null,
        },
        order.id
      );
      if (done) {
        setDeliverOpenId(null);
        setAmount("");
      }
    },
    [amount, method, runAction]
  );

  const confirmFailed = useCallback(
    async (order: DriverOrderSummary) => {
      if (reason.trim().length < 3) {
        setError("Motivul este obligatoriu.");
        return;
      }
      const done = await runAction(
        "/api/driver/delivery-failed",
        { order_id: order.id, reason: reason.trim() },
        order.id
      );
      if (done) {
        setFailedOpenId(null);
        setReason("");
      }
    },
    [reason, runAction]
  );

  const nextStop = orders.find((order) => order.status !== "delivered") ?? null;

  return (
    <div className="min-h-screen bg-ink pb-24 text-white">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-ink/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-lg font-extrabold">{driverName}</div>
            <div className="truncate text-sm text-white/60">{vehicleName ?? "Fără mașină"}</div>
          </div>
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={() => setMapOpen(true)}
              className="flex h-11 items-center gap-1.5 rounded-xl bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/20"
            >
              Hartă
            </button>
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/driver/logout", { method: "POST" });
                router.replace("/driver/login");
                router.refresh();
              }}
              className="flex h-11 items-center rounded-xl px-3 text-xs font-semibold text-white/50 hover:text-white"
            >
              Ieșire
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-lg px-4 py-4">
        {/* TODAY */}
        <section className="grid grid-cols-3 gap-2 rounded-2xl bg-white/5 p-4 text-center">
          <div>
            <div className="font-mono text-2xl font-black tabular-nums">{summary.orderCount}</div>
            <div className="text-[11px] uppercase tracking-wide text-white/50">Livrări</div>
          </div>
          <div>
            <div className="font-mono text-2xl font-black tabular-nums">{summary.tyreCount}</div>
            <div className="text-[11px] uppercase tracking-wide text-white/50">Anvelope</div>
          </div>
          <div>
            <div className="font-mono text-2xl font-black tabular-nums">
              {summary.codTotal > 0 ? `€${summary.codTotal.toFixed(0)}` : "—"}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-white/50">COD</div>
          </div>
        </section>

        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-state-danger p-3 text-sm font-semibold">
            {error}
          </p>
        )}

        {/* NEXT STOP */}
        {nextStop && (
          <section className="mt-4">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">Următoarea oprire</h2>
            <OrderCard
              order={nextStop}
              highlight
              expanded
              busy={busyId === nextStop.id}
              deliverOpen={deliverOpenId === nextStop.id}
              failedOpen={failedOpenId === nextStop.id}
              amount={amount}
              method={method}
              reason={reason}
              onToggle={() => {}}
              onNavigate={() => window.open(navigateUrl(addressOf(nextStop)), "_blank")}
              onMarkLoaded={() => markLoaded(nextStop.id)}
              onOpenDeliver={() => {
                setFailedOpenId(null);
                setDeliverOpenId(nextStop.id);
                setAmount(nextStop.amount_to_collect != null ? String(nextStop.amount_to_collect) : "");
              }}
              onOpenFailed={() => {
                setDeliverOpenId(null);
                setFailedOpenId(nextStop.id);
              }}
              onConfirmDeliver={() => void confirmDeliver(nextStop)}
              onConfirmFailed={() => void confirmFailed(nextStop)}
              onCancelDeliver={() => setDeliverOpenId(null)}
              onCancelFailed={() => setFailedOpenId(null)}
              onAmountChange={setAmount}
              onMethodChange={setMethod}
              onReasonChange={setReason}
            />
          </section>
        )}

        {/* FULL RUN */}
        <section className="mt-5">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">
            Comenzile tale de azi ({orders.length})
          </h2>
          {orders.length === 0 && (
            <p className="rounded-xl bg-white/5 p-6 text-center text-white/60">Nicio livrare alocată.</p>
          )}
          <ul className="space-y-2">
            {orders.map((order) => (
              <li key={order.id}>
                <OrderCard
                  order={order}
                  highlight={false}
                  expanded={expandedId === order.id}
                  busy={busyId === order.id}
                  deliverOpen={deliverOpenId === order.id}
                  failedOpen={failedOpenId === order.id}
                  amount={amount}
                  method={method}
                  reason={reason}
                  onToggle={() => setExpandedId(expandedId === order.id ? null : order.id)}
                  onNavigate={() => window.open(navigateUrl(addressOf(order)), "_blank")}
                  onMarkLoaded={() => markLoaded(order.id)}
                  onOpenDeliver={() => {
                    setFailedOpenId(null);
                    setDeliverOpenId(order.id);
                    setAmount(order.amount_to_collect != null ? String(order.amount_to_collect) : "");
                  }}
                  onOpenFailed={() => {
                    setDeliverOpenId(null);
                    setFailedOpenId(order.id);
                  }}
                  onConfirmDeliver={() => void confirmDeliver(order)}
                  onConfirmFailed={() => void confirmFailed(order)}
                  onCancelDeliver={() => setDeliverOpenId(null)}
                  onCancelFailed={() => setFailedOpenId(null)}
                  onAmountChange={setAmount}
                  onMethodChange={setMethod}
                  onReasonChange={setReason}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>

      {mapOpen && (
        <DriverRouteMapModal
          vehicleName={vehicleName ?? "Ruta mea"}
          stops={stops}
          depotLocation={depotLocation}
          onClose={() => setMapOpen(false)}
        />
      )}
    </div>
  );
}

function addressOf(order: DriverOrderSummary): string {
  return [order.customer_address, order.customer_city].filter(Boolean).join(", ");
}

function OrderCard({
  order,
  highlight,
  expanded,
  busy,
  deliverOpen,
  failedOpen,
  amount,
  method,
  reason,
  onToggle,
  onNavigate,
  onMarkLoaded,
  onOpenDeliver,
  onOpenFailed,
  onConfirmDeliver,
  onConfirmFailed,
  onCancelDeliver,
  onCancelFailed,
  onAmountChange,
  onMethodChange,
  onReasonChange,
}: {
  order: DriverOrderSummary;
  highlight: boolean;
  expanded: boolean;
  busy: boolean;
  deliverOpen: boolean;
  failedOpen: boolean;
  amount: string;
  method: string;
  reason: string;
  onToggle: () => void;
  onNavigate: () => void;
  onMarkLoaded: () => void;
  onOpenDeliver: () => void;
  onOpenFailed: () => void;
  onConfirmDeliver: () => void;
  onConfirmFailed: () => void;
  onCancelDeliver: () => void;
  onCancelFailed: () => void;
  onAmountChange: (value: string) => void;
  onMethodChange: (value: string) => void;
  onReasonChange: (value: string) => void;
}) {
  const canMarkLoaded = order.status === "stored" || order.status === "ready_for_loading";
  const canDeliver = order.status === "loaded" || order.status === "out_for_delivery";
  const isDelivered = order.status === "delivered";
  const address = addressOf(order);
  const statusMeta = orderStatusMeta(order.status);

  return (
    <article
      className={`overflow-hidden rounded-2xl p-4 ${highlight ? "bg-white text-ink" : "bg-white/5"} ${
        isDelivered ? "opacity-60" : ""
      }`}
    >
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 text-left">
        <span
          className={`flex h-14 w-14 flex-none items-center justify-center rounded-xl text-3xl font-black ${
            highlight ? "bg-ink text-white" : "bg-white text-ink"
          }`}
        >
          {order.stand_code ?? "•"}
        </span>
        <div className="min-w-0 flex-1">
          <div className={`font-mono text-xs font-bold ${highlight ? "text-ink/60" : "text-white/60"}`}>
            {formatOrderNumber(order.order_number)} · {statusMeta.label}
          </div>
          <div className="truncate text-lg font-bold">{order.customer_name ?? "—"}</div>
          {order.customer_city && (
            <div className={`text-sm ${highlight ? "text-ink/60" : "text-white/60"}`}>{order.customer_city}</div>
          )}
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-black tabular-nums">{order.tyre_count}</div>
          <div className={`text-[11px] uppercase ${highlight ? "text-ink/50" : "text-white/50"}`}>anv.</div>
        </div>
      </button>

      {(expanded || highlight) && (
        <div className={`mt-3 space-y-2 border-t pt-3 text-sm ${highlight ? "border-ink/10" : "border-white/10"}`}>
          {address && <div>{address}</div>}
          {order.customer_phone && <div className="opacity-80">{order.customer_phone}</div>}
          {order.items.length > 0 && (
            <ul className="opacity-80">
              {order.items.map((item) => (
                <li key={item.id}>
                  {item.quantity}× {item.description}
                </li>
              ))}
            </ul>
          )}
          {order.delivery_notes && <div className="italic opacity-70">{order.delivery_notes}</div>}
          {order.cash_on_delivery && (
            <div className="font-bold">
              COD €{(order.amount_to_collect ?? 0).toFixed(2)}
              {order.payment_status === "collected" && order.amount_collected != null && (
                <span className="ml-2 font-normal opacity-70">
                  (încasat €{order.amount_collected.toFixed(2)})
                </span>
              )}
            </div>
          )}
          {order.delivery_failure_reason && (
            <div className="rounded-lg bg-state-danger/20 px-2 py-1 text-state-danger">
              Livrare eșuată anterior: {order.delivery_failure_reason}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onNavigate}
          disabled={!address}
          className={`h-12 flex-1 rounded-xl text-sm font-bold disabled:opacity-40 ${
            highlight ? "border-2 border-ink/20 text-ink" : "border-2 border-white/20 text-white"
          }`}
        >
          Navighează
        </button>

        {canMarkLoaded && (
          <button
            type="button"
            disabled={busy}
            onClick={onMarkLoaded}
            className="h-12 flex-1 rounded-xl bg-state-warning text-sm font-bold text-ink disabled:opacity-50"
          >
            {busy ? "…" : "Marchează încărcată"}
          </button>
        )}

        {canDeliver && !deliverOpen && !failedOpen && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onOpenDeliver}
              className="h-12 flex-1 rounded-xl bg-state-success text-sm font-bold text-white disabled:opacity-50"
            >
              Marchează livrată
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onOpenFailed}
              className="h-12 flex-none rounded-xl border-2 border-state-danger px-4 text-sm font-bold text-state-danger disabled:opacity-50"
            >
              Eșuată
            </button>
          </>
        )}
      </div>

      {canDeliver && deliverOpen && (
        <div className={`mt-3 space-y-2 rounded-xl p-3 ${highlight ? "bg-surface-soft" : "bg-white/10"}`}>
          {order.cash_on_delivery && (
            <>
              <label className="block text-xs font-bold uppercase opacity-70">
                Sumă încasată (€)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(event) => onAmountChange(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-2 py-2 text-base text-ink"
                />
              </label>
              <select
                value={method}
                onChange={(event) => onMethodChange(event.target.value)}
                className="w-full rounded-lg border border-ink/15 bg-white px-2 py-2 text-base text-ink"
              >
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onConfirmDeliver}
              className="h-12 flex-1 rounded-xl bg-state-success text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Confirmă livrarea"}
            </button>
            <button
              type="button"
              onClick={onCancelDeliver}
              className="h-12 flex-1 rounded-xl border-2 border-ink/20 text-sm font-bold text-ink"
            >
              Anulează
            </button>
          </div>
        </div>
      )}

      {canDeliver && failedOpen && (
        <div className={`mt-3 space-y-2 rounded-xl p-3 ${highlight ? "bg-surface-soft" : "bg-white/10"}`}>
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Motivul: client închis, marfă refuzată…"
            rows={2}
            className="w-full rounded-lg border border-ink/15 bg-white px-2 py-2 text-base text-ink"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onConfirmFailed}
              className="h-12 flex-1 rounded-xl bg-state-danger text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Confirmă eșecul"}
            </button>
            <button
              type="button"
              onClick={onCancelFailed}
              className="h-12 flex-1 rounded-xl border-2 border-ink/20 text-sm font-bold text-ink"
            >
              Anulează
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

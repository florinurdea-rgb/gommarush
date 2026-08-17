"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useCameraCapture } from "@/hooks/useCameraCapture";
import { useFeedbackSounds } from "@/hooks/useFeedbackSounds";
import { useScannerInput } from "@/hooks/useScannerInput";
import { SupplierLabelScanner } from "@/components/logistics/SupplierLabelScanner";
import { ScanResultScreen } from "@/components/logistics/ScanResultScreen";
import { ManualLoadDialog } from "@/components/logistics/ManualLoadDialog";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { errorMessage, t, unitStatusMeta } from "@/lib/i18n/logistics";
import type { DriverOrderSummary } from "@/lib/server/loading";
import type { StandCode } from "@/lib/types/logistics";

/**
 * The driver's operational screen: their assigned deliveries, the supplier-label
 * camera scan, and the van-loading barcode scan.
 *
 * Mobile-first throughout — large targets, large type, no typing required in
 * the normal flow.
 */

export interface ScanOutcome {
  tone: "success" | "warning" | "error";
  title: string;
  orderNumber?: string;
  customer?: string;
  product?: string;
  standCode?: StandCode | null;
  detail?: string;
}

interface LoadableUnit {
  id: string;
  unit_sequence: number;
  status: string;
  description: string | null;
  order_number: number;
  customer_name: string | null;
}

type Mode = "orders" | "receive" | "load";

export function DriverConsole({
  driverName,
  vehicleName,
  orders,
  progress,
  loadableUnits,
}: {
  driverName: string;
  vehicleName: string | null;
  orders: DriverOrderSummary[];
  progress: { loaded: number; total: number; label: string };
  loadableUnits: LoadableUnit[];
}) {
  const router = useRouter();
  const sounds = useFeedbackSounds();
  const camera = useCameraCapture();
  const [mode, setMode] = useState<Mode>("orders");
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Loading scan: verifies ownership server-side, then reports the verdict. */
  const submitLoadScan = useCallback(
    async (token: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const response = await fetch("/api/driver/load", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            unit_token: token,
            // Idempotent per physical token per second, so a scanner
            // double-fire can't be counted twice.
            idempotency_key: `load-${token}-${Math.floor(Date.now() / 1000)}`,
          }),
        });
        const payload = (await response.json()) as {
          ok: boolean;
          code?: string;
          result?: {
            ok: boolean;
            code: string;
            orderNumber?: number | string;
            customer?: string;
            description?: string | null;
            standCode?: StandCode | null;
          };
        };

        if (!payload.ok || !payload.result) {
          setOutcome({ tone: "error", title: errorMessage(payload.code) });
          sounds.feedback("error");
          return;
        }

        const result = payload.result;

        if (result.ok) {
          setOutcome({
            tone: "success",
            title: "ÎNCĂRCAT",
            orderNumber: formatOrderNumber(result.orderNumber ?? null),
            customer: result.customer,
            product: result.description ?? undefined,
            standCode: result.standCode ?? null,
          });
          sounds.feedback("success");
          router.refresh();
          return;
        }

        // The wrong-item case gets its own loud treatment.
        if (result.code === "WRONG_DRIVER" || result.code === "WRONG_VEHICLE") {
          setOutcome({
            tone: "error",
            title: t("wrongItem"),
            detail: t("wrongItemDetail"),
            orderNumber: formatOrderNumber(result.orderNumber ?? null),
            customer: result.customer,
            product: result.description ?? undefined,
          });
          sounds.feedback("error");
          return;
        }

        // Duplicates and "not stored yet" are warnings, not failures — and
        // crucially not successes, so they never earn the success beep.
        setOutcome({
          tone: result.code === "ALREADY_LOADED" || result.code === "ALREADY_MOVED_ON" ? "warning" : "error",
          title: errorMessage(result.code),
          orderNumber: formatOrderNumber(result.orderNumber ?? null),
          customer: result.customer,
          product: result.description ?? undefined,
        });
        sounds.feedback(
          result.code === "ALREADY_LOADED" || result.code === "ALREADY_MOVED_ON" ? "warning" : "error"
        );
      } catch {
        setOutcome({ tone: "error", title: errorMessage("UNKNOWN") });
        sounds.feedback("error");
      } finally {
        setBusy(false);
      }
    },
    [busy, router, sounds]
  );

  const scanner = useScannerInput({
    onScan: (token) => void submitLoadScan(token),
    disabled: mode !== "load" || manualOpen,
  });

  return (
    <div className="min-h-screen bg-ink pb-24 text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-white/10 bg-ink/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-lg font-extrabold">{driverName}</div>
            <div className="truncate text-sm text-white/60">{vehicleName ?? "Fără mașină"}</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-black tabular-nums">{progress.label}</div>
            <div className="text-xs uppercase tracking-wide text-white/50">{t("loaded")}</div>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-lg px-4 py-4">
        {/* Mode switch */}
        <div className="grid grid-cols-3 gap-2">
          {([
            ["orders", "Livrări"],
            ["receive", "Recepție"],
            ["load", "Încărcare"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
                setOutcome(null);
                if (value !== "receive") camera.stop();
              }}
              className={`min-h-14 rounded-xl text-base font-bold transition-colors ${
                mode === value ? "bg-white text-ink" : "bg-white/10 text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ------------------------------------------------------- Orders */}
        {mode === "orders" && (
          <section className="mt-5 space-y-3">
            {orders.length === 0 && (
              <p className="rounded-xl bg-white/5 p-6 text-center text-white/60">
                Nicio livrare alocată.
              </p>
            )}

            {orders.map((order) => (
              <article key={order.id} className="rounded-2xl bg-white/5 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-16 w-16 flex-none items-center justify-center rounded-xl bg-white text-4xl font-black text-ink">
                    {order.stand_code ?? "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm font-bold text-white/60">
                      {formatOrderNumber(order.order_number)}
                    </div>
                    <div className="truncate text-lg font-bold">{order.customer_name ?? "—"}</div>
                    {order.customer_city && (
                      <div className="text-sm text-white/60">{order.customer_city}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xl font-black tabular-nums">
                      {order.progress.loadedLabel}
                    </div>
                    <div className="text-xs uppercase text-white/50">{t("loaded")}</div>
                  </div>
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-state-success transition-[width]"
                    style={{ width: `${order.progress.loadedPercent}%` }}
                  />
                </div>

                <ul className="mt-3 space-y-1 text-sm">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate text-white/80">{item.description}</span>
                      <span className="flex flex-none gap-1">
                        {item.units.map((unit) => (
                          <span
                            key={unit.id}
                            title={unitStatusMeta(unit.status).label}
                            className={`h-2.5 w-2.5 rounded-full ${
                              unit.status === "loaded"
                                ? "bg-state-success"
                                : unit.status === "stored"
                                  ? "bg-white/70"
                                  : "bg-white/20"
                            }`}
                          />
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        )}

        {/* ------------------------------------------------------ Receive */}
        {mode === "receive" && (
          <SupplierLabelScanner
            camera={camera}
            sounds={sounds}
            onOutcome={setOutcome}
            onChanged={() => router.refresh()}
          />
        )}

        {/* --------------------------------------------------------- Load */}
        {mode === "load" && (
          <section className="mt-5">
            <div className="rounded-2xl bg-white/5 p-5 text-center">
              <div
                className={`mx-auto mb-3 h-3 w-3 rounded-full ${
                  scanner.focused ? "animate-pulse bg-state-success" : "bg-state-warning"
                }`}
              />
              <h2 className="text-xl font-extrabold">{t("loadingScan")}</h2>
              <p className="mt-1 text-sm text-white/60">
                Scanează eticheta GoRush de pe fiecare produs cu cititorul de coduri.
              </p>

              {/* Always-focused capture field for the HID scanner. Visually
                  hidden but focusable — a display:none input cannot be typed
                  into by a scanner. */}
              <input
                {...scanner.inputProps}
                className="h-0 w-0 border-0 bg-transparent p-0 text-transparent outline-none"
              />

              {!scanner.focused && (
                <button
                  type="button"
                  onClick={scanner.focus}
                  className="mt-3 min-h-14 w-full rounded-xl bg-state-warning text-base font-bold"
                >
                  Atinge pentru a activa scanarea
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setManualOpen(true)}
              className="mt-4 min-h-14 w-full rounded-xl border-2 border-white/20 text-base font-bold text-white/80"
            >
              {t("addManuallyAsLoaded")}
            </button>
          </section>
        )}
      </div>

      {/* Full-screen scan verdict */}
      {outcome && <ScanResultScreen outcome={outcome} onDismiss={() => setOutcome(null)} />}

      {manualOpen && (
        <ManualLoadDialog
          units={loadableUnits}
          onClose={() => setManualOpen(false)}
          onDone={(result) => {
            setManualOpen(false);
            setOutcome(result);
            // Deliberately a warning cue: a manual override is not a scan, and
            // must not sound like one.
            sounds.feedback(result.tone === "success" ? "warning" : "error");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

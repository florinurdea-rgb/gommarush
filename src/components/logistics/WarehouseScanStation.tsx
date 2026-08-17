"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useFeedbackSounds } from "@/hooks/useFeedbackSounds";
import { useScannerInput } from "@/hooks/useScannerInput";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { errorMessage, t } from "@/lib/i18n/logistics";
import type { StandCode } from "@/lib/types/logistics";

/**
 * Handheld-scanner station for confirming physical storage.
 *
 * The scanner is treated as a HID keyboard: a hidden, always-focused input
 * receives TOKEN + ENTER, so the operator never has to click anything between
 * items. Recent scans stay on screen as a running tally.
 */

interface ScanRow {
  id: string;
  tone: "success" | "warning" | "error";
  title: string;
  orderNumber?: string;
  customer?: string;
  description?: string | null;
  standCode?: StandCode | null;
  at: string;
}

export function WarehouseScanStation({ operatorName }: { operatorName: string }) {
  const sounds = useFeedbackSounds();
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  const push = useCallback((row: Omit<ScanRow, "id" | "at">) => {
    setRows((current) =>
      [
        { ...row, id: `${Date.now()}-${Math.random()}`, at: new Date().toLocaleTimeString("ro-RO") },
        ...current,
      ].slice(0, 25)
    );
  }, []);

  const handleScan = useCallback(
    async (token: string) => {
      if (busy) return;
      setBusy(true);

      try {
        const response = await fetch("/api/warehouse/store", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            unit_token: token,
            idempotency_key: `store-${token}-${Math.floor(Date.now() / 1000)}`,
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
          push({ tone: "error", title: errorMessage(payload.code) });
          sounds.feedback("error");
          return;
        }

        const result = payload.result;

        if (result.ok) {
          push({
            tone: "success",
            title: "DEPOZITAT",
            orderNumber: formatOrderNumber(result.orderNumber ?? null),
            customer: result.customer,
            description: result.description,
            standCode: result.standCode ?? null,
          });
          sounds.feedback("success");
          return;
        }

        // A re-scan is a normal event: clear message, harmless audit row, and
        // deliberately NOT the success sound.
        push({
          tone: "warning",
          title: errorMessage(result.code),
          orderNumber: formatOrderNumber(result.orderNumber ?? null),
          customer: result.customer,
          description: result.description,
        });
        sounds.feedback("warning");
      } catch {
        push({ tone: "error", title: errorMessage("UNKNOWN") });
        sounds.feedback("error");
      } finally {
        setBusy(false);
      }
    },
    [busy, push, sounds]
  );

  const scanner = useScannerInput({ onScan: (token) => void handleScan(token) });

  return (
    <div className="min-h-screen bg-ink px-4 py-5 text-white">
      <div className="mx-auto w-full max-w-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">{t("storageScan")}</h1>
            <p className="text-sm text-white/60">Operator: {operatorName}</p>
          </div>
          <Link href="/admin" className="min-h-12 rounded-xl bg-white/10 px-4 py-3 text-sm font-bold">
            {t("dashboard")}
          </Link>
        </header>

        <div className="mt-5 rounded-2xl bg-white/5 p-6 text-center">
          <div
            className={`mx-auto mb-3 h-4 w-4 rounded-full ${
              scanner.focused ? "animate-pulse bg-state-success" : "bg-state-warning"
            }`}
          />
          <p className="text-lg font-bold">
            {scanner.focused ? "Gata de scanare" : "Atinge ecranul pentru a activa scanarea"}
          </p>
          <p className="mt-1 text-sm text-white/60">
            Scanează eticheta GoRush de pe produs cu cititorul de coduri de bare.
          </p>

          {/* Visually hidden but focusable — a display:none input cannot
              receive a scan. */}
          <input
            {...scanner.inputProps}
            className="h-0 w-0 border-0 bg-transparent p-0 text-transparent outline-none"
          />

          {!armed && (
            <button
              type="button"
              onClick={async () => {
                // This click is the user gesture that unlocks Web Audio, so the
                // confirmation beep can play on later scans.
                await sounds.unlock();
                setArmed(true);
                scanner.focus();
              }}
              className="mt-4 min-h-14 w-full rounded-xl bg-accent text-lg font-extrabold"
            >
              Activează sunetul și scanarea
            </button>
          )}
        </div>

        <ul className="mt-5 space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className={`flex items-center gap-3 rounded-xl p-3 ${
                row.tone === "success"
                  ? "bg-state-success/20"
                  : row.tone === "warning"
                    ? "bg-state-warning/20"
                    : "bg-state-danger/20"
              }`}
            >
              {row.standCode && (
                <span className="flex h-12 w-12 flex-none items-center justify-center rounded-lg bg-white text-2xl font-black text-ink">
                  {row.standCode}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-bold">{row.title}</div>
                <div className="truncate text-sm text-white/70">
                  {row.orderNumber ? `${row.orderNumber} · ` : ""}
                  {row.customer ?? ""}
                  {row.description ? ` · ${row.description}` : ""}
                </div>
              </div>
              <span className="flex-none font-mono text-xs text-white/50">{row.at}</span>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="rounded-xl bg-white/5 p-6 text-center text-sm text-white/60">
              Nicio scanare încă în această sesiune.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

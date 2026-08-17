"use client";

import { useCallback, useState } from "react";
import { errorMessage, t } from "@/lib/i18n/logistics";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { normaliseProduct } from "@/lib/logistics/product-normalise";
import type { ScanOutcome } from "@/components/logistics/DriverConsole";
import type { StandCode } from "@/lib/types/logistics";
import type { useCameraCapture } from "@/hooks/useCameraCapture";
import type { useFeedbackSounds } from "@/hooks/useFeedbackSounds";

/**
 * Reading the ORIGINAL SUPPLIER LABEL attached to the tyre.
 *
 * This is a different operation from scanning GoRush's own barcode later:
 * nothing on a supplier label is guaranteed machine-readable, so the flow is
 *   capture -> read what we can -> match against ACTIVE expected orders ->
 *   confident match, or an honest "no confident match" with manual search.
 *
 * The success beep is only ever played for a confident, server-confirmed match.
 */

interface Candidate {
  orderItemId: string;
  orderNumber: string;
  customerName: string | null;
  standCode: StandCode | null;
  description: string | null;
  brand: string | null;
  supplierSku?: string | null;
  unitsExpected: number;
  score?: number;
}

interface SupplierLabelScannerProps {
  camera: ReturnType<typeof useCameraCapture>;
  sounds: ReturnType<typeof useFeedbackSounds>;
  onOutcome: (outcome: ScanOutcome) => void;
  onChanged: () => void;
}

function newIdempotencyKey() {
  return `recv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function SupplierLabelScanner({
  camera,
  sounds,
  onOutcome,
  onChanged,
}: SupplierLabelScannerProps) {
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [manualQuery, setManualQuery] = useState("");
  const [manualResults, setManualResults] = useState<Candidate[] | null>(null);
  const [typedLabel, setTypedLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  /**
   * Starting the camera is also where the Web Audio context gets unlocked —
   * this click is the user gesture browsers require before any sound can play
   * later, when a match actually succeeds.
   */
  const startScanning = useCallback(async () => {
    await sounds.unlock();
    const started = await camera.start();
    if (!started) setError(errorMessage(camera.error ?? "CAMERA_UNAVAILABLE"));
  }, [camera, sounds]);

  const submit = useCallback(
    async (payload: {
      label: Record<string, string | null>;
      orderItemId?: string;
      manual?: boolean;
    }) => {
      setBusy(true);
      setError(null);

      try {
        const response = await fetch("/api/driver/scan-label", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: payload.label,
            idempotency_key: newIdempotencyKey(),
            order_item_id: payload.orderItemId ?? null,
            manual: payload.manual ?? false,
          }),
        });
        const result = (await response.json()) as {
          ok: boolean;
          code?: string;
          outcome?: string;
          candidates?: Candidate[];
          result?: {
            ok: boolean;
            code: string;
            orderNumber?: number | string;
            customer?: string;
            product?: string;
            standCode?: StandCode | null;
            printJobId?: string | null;
          };
        };

        if (!result.ok) {
          setError(errorMessage(result.code));
          sounds.feedback("error");
          return;
        }

        // Uncertain: never invent an order, never beep.
        if (result.outcome !== "matched") {
          setCandidates(result.candidates ?? []);
          sounds.feedback("warning");
          return;
        }

        const matched = result.result!;
        setCandidates(null);
        setManualResults(null);

        if (matched.code === "ALREADY_PROCESSED") {
          onOutcome({
            tone: "warning",
            title: errorMessage("ALREADY_PROCESSED"),
            orderNumber: formatOrderNumber(matched.orderNumber ?? null),
          });
          sounds.feedback("warning");
          return;
        }

        onOutcome({
          tone: "success",
          title: t("orderFound"),
          orderNumber: formatOrderNumber(matched.orderNumber ?? null),
          customer: matched.customer,
          product: matched.product,
          standCode: matched.standCode ?? null,
        });
        sounds.feedback("success");
        onChanged();
      } catch {
        setError(errorMessage("UNKNOWN"));
        sounds.feedback("error");
      } finally {
        setBusy(false);
      }
    },
    [onChanged, onOutcome, sounds]
  );

  /**
   * Capture and read the frame.
   *
   * IMPORTANT: there is no on-device OCR in Phase 1. Rather than pretend to
   * read the photo, the capture is paired with whatever text the operator has
   * typed, and the server matches on that. If nothing was typed, the result is
   * an honest "no confident match" with manual search — never a guess.
   */
  const captureAndMatch = useCallback(async () => {
    const frame = camera.capture();
    if (!frame) {
      setError(errorMessage("LABEL_UNREADABLE"));
      return;
    }

    const typed = typedLabel.trim();
    if (!typed) {
      // Nothing readable to match on. Say so plainly.
      setCandidates([]);
      sounds.feedback("warning");
      return;
    }

    const parsed = normaliseProduct(typed);
    await submit({
      label: {
        rawText: typed,
        brand: parsed.brand,
        size:
          parsed.width && parsed.aspectRatio && parsed.rimDiameter
            ? `${parsed.width}/${parsed.aspectRatio} R${parsed.rimDiameter}`
            : null,
        loadIndex: parsed.loadIndex,
        speedRating: parsed.speedRating,
        supplierSku: null,
        barcode: null,
      },
    });
  }, [camera, sounds, submit, typedLabel]);

  const runManualSearch = useCallback(async () => {
    if (!manualQuery.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/driver/search-expected?q=${encodeURIComponent(manualQuery.trim())}`
      );
      const payload = (await response.json()) as { ok: boolean; lines?: Candidate[] };
      setManualResults(payload.ok ? (payload.lines ?? []) : []);
    } catch {
      setManualResults([]);
    } finally {
      setBusy(false);
    }
  }, [manualQuery]);

  const results = manualResults ?? candidates;

  return (
    <section className="mt-5 space-y-4">
      {!camera.active ? (
        <button
          type="button"
          onClick={startScanning}
          className="min-h-20 w-full rounded-2xl bg-accent text-2xl font-extrabold text-white"
        >
          {t("startScanning")}
        </button>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl bg-black">
            <video
              ref={camera.videoRef}
              playsInline
              muted
              autoPlay
              className="aspect-[4/3] w-full object-cover"
            />
          </div>

          <div>
            <label htmlFor="label-text" className="mb-1 block text-sm font-semibold text-white/70">
              Text de pe eticheta furnizorului
            </label>
            <input
              id="label-text"
              value={typedLabel}
              onChange={(event) => setTypedLabel(event.target.value)}
              placeholder="ex. MICHELIN 225/55 R18 98V"
              className="min-h-14 w-full rounded-xl bg-white px-4 text-lg font-semibold text-ink outline-none"
            />
            <p className="mt-1 text-xs text-white/50">
              Recunoașterea automată a etichetei nu este activă în Faza 1 — sistemul
              nu inventează date. Scrie marca și dimensiunea de pe etichetă.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={captureAndMatch}
              className="min-h-16 rounded-xl bg-state-success text-lg font-extrabold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Caută comanda"}
            </button>
            <button
              type="button"
              onClick={camera.stop}
              className="min-h-16 rounded-xl bg-white/10 text-lg font-bold text-white"
            >
              {t("stopScanning")}
            </button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-state-danger p-3 text-sm font-bold text-white">
          {error}
        </p>
      )}

      {/* Uncertain match -> manual selection. Never guesses on the operator's
          behalf. */}
      {results && (
        <div className="rounded-2xl bg-white/5 p-4">
          {candidates?.length === 0 && !manualResults && (
            <p className="mb-3 text-lg font-bold text-state-warning">{t("noConfidentMatch")}</p>
          )}

          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-white/50">
            {t("manualSearch")}
          </h3>

          <div className="flex gap-2">
            <input
              value={manualQuery}
              onChange={(event) => setManualQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runManualSearch();
              }}
              placeholder="Comandă, client, marcă, dimensiune, SKU…"
              className="min-h-14 flex-1 rounded-xl bg-white px-4 text-base font-semibold text-ink outline-none"
            />
            <button
              type="button"
              onClick={runManualSearch}
              disabled={busy}
              className="min-h-14 rounded-xl bg-accent px-5 text-base font-bold text-white disabled:opacity-50"
            >
              {t("search")}
            </button>
          </div>

          <ul className="mt-3 space-y-2">
            {results.map((candidate) => (
              <li key={candidate.orderItemId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    submit({
                      label: { rawText: typedLabel || manualQuery },
                      orderItemId: candidate.orderItemId,
                      manual: true,
                    })
                  }
                  className="w-full rounded-xl bg-white/10 p-3 text-left disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 flex-none items-center justify-center rounded-lg bg-white text-2xl font-black text-ink">
                      {candidate.standCode ?? "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs text-white/60">
                        {candidate.orderNumber}
                      </div>
                      <div className="truncate font-bold">{candidate.customerName ?? "—"}</div>
                      <div className="truncate text-sm text-white/70">
                        {candidate.brand ? `${candidate.brand} ` : ""}
                        {candidate.description ?? ""}
                      </div>
                    </div>
                    <span className="flex-none text-sm font-bold text-white/60">
                      {candidate.unitsExpected} rămase
                    </span>
                  </div>
                </button>
              </li>
            ))}

            {results.length === 0 && manualResults && (
              <li className="py-3 text-center text-sm text-white/60">
                {errorMessage("ORDER_NOT_FOUND")}
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}

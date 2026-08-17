"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";
import { formatTyreSizeLine, seasonLabel, yesNo } from "@/lib/tyre-lookup/format";
import type { TyreLookupResult } from "@/lib/tyre-lookup/types";

type Phase = "idle" | "searching" | "result";

interface ApiResponse {
  ok: boolean;
  code?: string;
  result?: TyreLookupResult;
}

const REQUEST_ERROR_MESSAGE: Record<string, string> = {
  RATE_LIMITED: "Prea multe căutări — așteaptă un moment și reîncearcă.",
  INVALID_BARCODE: "Codul introdus nu pare un cod de bare valid.",
  VALIDATION_FAILED: "Codul introdus nu este valid.",
};

/**
 * A barcode scanner behaves as a HID keyboard: it types the code into
 * whatever has focus, then sends Enter. So the entire interaction model
 * here is "the input is always focused" + "a form submit on Enter" — no
 * custom keyboard handling needed, and no click required between scans.
 *
 * requestIdRef guards against a slow first search's response landing after
 * a second, faster scan already replaced it on screen.
 */
export function TyreLookupScanner() {
  const [inputValue, setInputValue] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [searchingBarcode, setSearchingBarcode] = useState("");
  const [result, setResult] = useState<TyreLookupResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runLookup = useCallback(async (barcode: string) => {
    const requestId = ++requestIdRef.current;
    setPhase("searching");
    setSearchingBarcode(barcode);
    setRequestError(null);

    try {
      const response = await fetch("/api/tyre-lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ barcode }),
      });
      const payload = (await response.json()) as ApiResponse;

      if (requestId !== requestIdRef.current) return; // superseded by a newer scan

      if (!payload.ok || !payload.result) {
        setRequestError(REQUEST_ERROR_MESSAGE[payload.code ?? ""] ?? "Căutarea a eșuat. Încearcă din nou.");
        setPhase("idle");
        return;
      }

      setResult(payload.result);
      setPhase("result");
    } catch {
      if (requestId !== requestIdRef.current) return;
      setRequestError("Eroare de rețea — încearcă din nou.");
      setPhase("idle");
    } finally {
      if (requestId === requestIdRef.current) {
        // Ready for the next scan immediately — never wait for a click.
        inputRef.current?.focus();
      }
    }
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const barcode = inputValue.trim();
    if (!barcode) return;

    // Clear + refocus immediately so the scanner can fire the next code
    // right away, even while this search is still in flight.
    setInputValue("");
    inputRef.current?.focus();
    void runLookup(barcode);
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-soft">
      <header className="mx-auto flex w-full max-w-content items-center justify-between gap-4 px-4 pt-6 sm:px-6">
        <Link href="/">
          <Logo iconClassName="h-11 w-11" textClassName="text-xl" />
        </Link>
        <Link href="/" className="text-sm font-semibold text-ink-soft hover:text-ink">
          ← Acasă
        </Link>
      </header>

      <main className="mx-auto w-full max-w-content flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Caută cauciuc</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Scanează codul de bare de pe eticheta producătorului cu pistolul, sau introdu-l manual.
        </p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            placeholder="Scanează codul de bare…"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onBlur={() => {
              // The input must stay permanently ready for the scanner —
              // if focus is lost to something else on the page, reclaim it.
              window.setTimeout(() => inputRef.current?.focus(), 50);
            }}
            className="h-16 flex-1 rounded-2xl border-2 border-ink/15 bg-white px-5 font-mono text-2xl text-ink outline-none focus:border-accent"
          />
          <Button type="submit" size="lg" className="sm:w-40">
            Caută
          </Button>
        </form>

        <div className="mt-8">
          {phase === "searching" && (
            <p className="font-mono text-lg text-ink-soft">Se caută: {searchingBarcode}…</p>
          )}

          {requestError && <p className="font-semibold text-state-danger">{requestError}</p>}

          {phase === "result" && result && <ResultPanel result={result} />}
        </div>
      </main>
    </div>
  );
}

function ResultPanel({ result }: { result: TyreLookupResult }) {
  if (result.status === "unconfigured" || result.status === "failed") {
    return (
      <div className="rounded-2xl border-2 border-state-neutral-soft bg-state-neutral-soft p-6">
        <p className="text-lg font-bold text-state-neutral">
          {result.status === "unconfigured" ? "Căutare indisponibilă" : "Căutarea a eșuat"}
        </p>
        <p className="mt-1 font-mono text-sm text-ink-soft">Barcode: {result.barcode}</p>
        {result.notes.map((note) => (
          <p key={note} className="mt-2 text-sm text-ink-soft">
            {note}
          </p>
        ))}
      </div>
    );
  }

  if (result.status === "unknown") {
    return (
      <div className="rounded-2xl border-2 border-state-danger-soft bg-state-danger-soft p-6">
        <p className="text-2xl font-black text-state-danger">❌ COD NECUNOSCUT</p>
        <p className="mt-2 font-mono text-lg text-ink">Barcode: {result.barcode}</p>
      </div>
    );
  }

  const sizeLine = formatTyreSizeLine(result);
  const tone = result.status === "identified" ? "success" : "warning";
  const borderClass = tone === "success" ? "border-state-success-soft" : "border-state-warning-soft";
  const bgClass = tone === "success" ? "bg-state-success-soft" : "bg-state-warning-soft";

  return (
    <div className={`rounded-2xl border-2 ${borderClass} ${bgClass} p-6 sm:p-8`}>
      {result.brand && (
        <p className="text-4xl font-black uppercase tracking-tight text-ink sm:text-5xl">{result.brand}</p>
      )}
      {result.model && <p className="mt-1 text-2xl font-bold text-ink sm:text-3xl">{result.model}</p>}
      {sizeLine && <p className="mt-1 font-mono text-2xl font-bold text-ink sm:text-3xl">{sizeLine}</p>}

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:max-w-md">
        {result.ean && <Field label="EAN" value={result.ean} mono />}
        {seasonLabel(result.season) && <Field label="Season" value={seasonLabel(result.season)!} />}
        {result.extraLoad !== null && <Field label="XL" value={yesNo(result.extraLoad)!} />}
        {result.runFlat !== null && <Field label="Runflat" value={yesNo(result.runFlat)!} />}
        {result.manufacturerCode && (
          <Field label="Manufacturer code" value={result.manufacturerCode} mono />
        )}
      </dl>

      <p className={`mt-6 text-lg font-black ${tone === "success" ? "text-state-success" : "text-state-warning"}`}>
        {tone === "success" ? "✓ PRODUS IDENTIFICAT" : "⚠ VERIFICARE NECESARĂ"}
      </p>

      {result.notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {result.sources.length > 0 && (
        <div className="mt-6 border-t border-ink/10 pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Surse</p>
          <ul className="mt-2 space-y-1">
            {result.sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent hover:underline"
                >
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.cached && <p className="mt-4 text-xs text-ink-soft">Rezultat din cache</p>}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className={`text-ink ${mono ? "font-mono" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}

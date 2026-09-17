"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocale } from "@/components/site/LocaleProvider";

/**
 * "Trova il tuo pneumatico" — the public code lookup.
 *
 * A dialog rather than a page: someone checking a delivery has a stack of
 * tyres and a scanner, and sending them through a navigation each time
 * would make the second lookup as expensive as the first. So the field
 * stays focused and pre-selected after every search — scan, read, scan
 * again, without touching the mouse.
 *
 * Everything shown here comes from /api/tyre-lookup, whose projection is
 * fixed server-side. This component cannot render a supplier price or
 * article code because it is never sent one.
 */

interface TyreResult {
  brand: string | null;
  modelPattern: string | null;
  description: string | null;
  sizeDisplay: string | null;
  widthMm: number | null;
  aspectRatio: number | null;
  rimInch: number | null;
  loadIndex: string | null;
  speedRating: string | null;
  loadSpeedRaw: string | null;
  season: string | null;
  productClass: string | null;
  xl: boolean | null;
  runFlat: boolean | null;
  weightKg: number | null;
  eprelId: string | null;
  matchedOn: string;
  matchedValue: string;
}

type State =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "found"; results: TyreResult[]; query: string }
  | { kind: "empty"; query: string }
  | { kind: "invalid" }
  | { kind: "error"; message: string };

export function TyreFinder({ triggerClassName }: { triggerClassName?: string } = {}) {
  const { copy } = useLocale();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setState({ kind: "idle" });
    setCode("");
    // Focus goes back where it came from, or the page loses the user's place.
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      // Keep Tab inside the dialog: a modal the keyboard can walk out of
      // behind is not a modal.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href]'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
    };
  }, [open, close]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;

    setState({ kind: "searching" });
    try {
      const response = await fetch("/api/tyre-lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        code?: string;
        status?: string;
        query?: string;
        results?: TyreResult[];
      };

      if (!payload.ok) {
        setState({
          kind: "error",
          message: payload.code === "RATE_LIMITED" ? copy.finderRateLimited : copy.finderErrorBody,
        });
        return;
      }

      if (payload.status === "invalid_code") setState({ kind: "invalid" });
      else if (payload.status === "found" && payload.results?.length) {
        setState({ kind: "found", results: payload.results, query: payload.query ?? trimmed });
      } else setState({ kind: "empty", query: payload.query ?? trimmed });
    } catch {
      setState({ kind: "error", message: copy.finderErrorBody });
    } finally {
      // Ready for the next scan without a click.
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "mt-4 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border-2 border-ink/15 bg-white/90 px-7 text-base font-bold text-ink shadow-sm backdrop-blur transition-all duration-150 hover:border-accent hover:text-accent active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 sm:mt-0 sm:text-lg"
        }
      >
        <SearchIcon />
        {copy.finderCta}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4 pt-[8vh] backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="text-xl font-extrabold text-ink sm:text-2xl">
                  {copy.finderTitle}
                </h2>
                <p className="mt-1 text-sm text-ink-soft">{copy.finderIntro}</p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label={copy.finderClose}
                className="-mr-2 -mt-2 flex h-10 w-10 flex-none items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <CloseIcon />
              </button>
            </div>

            <form onSubmit={search} className="mt-5 flex flex-col gap-3 sm:flex-row">
              <div className="flex-1">
                <label htmlFor="tyre-finder-code" className="sr-only">
                  {copy.finderLabel}
                </label>
                <input
                  ref={inputRef}
                  id="tyre-finder-code"
                  name="code"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder={copy.finderPlaceholder}
                  className="min-h-[52px] w-full rounded-xl border-2 border-ink/15 px-4 font-mono text-base text-ink transition-colors focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                />
              </div>
              <button
                type="submit"
                disabled={state.kind === "searching" || !code.trim()}
                className="min-h-[52px] flex-none rounded-xl bg-accent px-8 text-base font-bold text-white transition-all duration-150 hover:bg-accent-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                {state.kind === "searching" ? copy.finderSearching : copy.finderSubmit}
              </button>
            </form>

            <div aria-live="polite" className="mt-5">
              <Results state={state} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Results({ state }: { state: State }) {
  const { copy } = useLocale();

  if (state.kind === "idle" || state.kind === "searching") return null;

  if (state.kind === "invalid") {
    return <Notice title={copy.finderInvalidTitle} body={copy.finderInvalidBody} tone="warning" />;
  }
  if (state.kind === "error") {
    return <Notice title={copy.finderErrorTitle} body={state.message} tone="danger" />;
  }
  if (state.kind === "empty") {
    return <Notice title={copy.finderEmptyTitle} body={copy.finderEmptyBody} tone="neutral" />;
  }

  const heading =
    state.results.length === 1
      ? copy.finderResultsOne
      : copy.finderResultsMany.replace("{count}", String(state.results.length));

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{heading}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {state.results.map((result, index) => (
          <li key={`${result.matchedValue}-${index}`}>
            <TyreCard result={result} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TyreCard({ result }: { result: TyreResult }) {
  const { copy } = useLocale();

  const seasonLabels: Record<string, string> = {
    summer: copy.finderSeasonSummer,
    winter: copy.finderSeasonWinter,
    all_season: copy.finderSeasonAllSeason,
  };
  const classLabels: Record<string, string> = {
    passenger_car: copy.finderClassPassengerCar,
    passenger_car_runflat: copy.finderClassPassengerCarRunflat,
    suv_4x4: copy.finderClassSuv4x4,
    light_truck_van: copy.finderClassLightTruckVan,
    motorcycle: copy.finderClassMotorcycle,
    scooter: copy.finderClassScooter,
    old_dot: copy.finderClassOldDot,
    spare: copy.finderClassSpare,
  };

  const title = [result.brand, result.modelPattern].filter(Boolean).join(" ") || result.description;
  const size =
    result.sizeDisplay ??
    (result.widthMm && result.aspectRatio && result.rimInch
      ? `${result.widthMm}/${result.aspectRatio} R${result.rimInch}`
      : null);
  const loadSpeed =
    result.loadSpeedRaw ??
    (result.loadIndex && result.speedRating ? `${result.loadIndex}${result.speedRating}` : null);

  const specs: [string, string | null][] = [
    [copy.finderSpecSize, size],
    [copy.finderSpecLoadSpeed, loadSpeed],
    [copy.finderSpecSeason, result.season ? (seasonLabels[result.season] ?? result.season) : null],
    [
      copy.finderSpecClass,
      result.productClass ? (classLabels[result.productClass] ?? result.productClass) : null,
    ],
    // A weight we do not hold says so, rather than showing a plausible zero.
    [copy.finderSpecWeight, result.weightKg !== null ? `${result.weightKg} kg` : copy.finderUnknownWeight],
    [copy.finderSpecXl, result.xl === null ? null : result.xl ? copy.finderYes : copy.finderNo],
    [
      copy.finderSpecRunFlat,
      result.runFlat === null ? null : result.runFlat ? copy.finderYes : copy.finderNo,
    ],
    [copy.finderSpecEprel, result.eprelId],
  ];

  return (
    <div className="rounded-xl border border-ink/10 bg-surface-soft/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-extrabold text-ink sm:text-lg">{title}</h3>
        <span className="rounded-full bg-white px-2.5 py-0.5 font-mono text-[11px] font-semibold text-ink-soft ring-1 ring-inset ring-ink/10">
          {result.matchedValue}
        </span>
      </div>

      {size && <p className="mt-0.5 font-mono text-sm font-bold text-accent">{size} {loadSpeed}</p>}

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {specs
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 text-sm sm:block">
              <dt className="text-ink-soft sm:text-xs sm:uppercase sm:tracking-wide">{label}</dt>
              <dd className="font-semibold text-ink">{value}</dd>
            </div>
          ))}
      </dl>

      <p className="mt-3 text-[11px] text-ink-soft">
        {result.matchedOn === "manufacturer_code"
          ? copy.finderMatchedOnManufacturer
          : copy.finderMatchedOnEan}
      </p>
    </div>
  );
}

function Notice({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone: "neutral" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-state-danger/40 bg-state-danger-soft"
      : tone === "warning"
        ? "border-state-warning/40 bg-state-warning-soft"
        : "border-ink/15 bg-surface-soft";
  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <p className="text-sm font-bold text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-soft">{body}</p>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m16.5 16.5 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

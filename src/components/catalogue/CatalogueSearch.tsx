"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTr } from "@/lib/i18n/tr";
import { formatCents } from "@/lib/documents/pipeline/money";
import type { InternalTyreOffer } from "@/lib/pricing/projection";

/**
 * Internal commercial preview: find a tyre, see what GommaRush could sell it
 * for, and see how that number was built.
 *
 * The breakdown is shown in full rather than as a single "price" because the
 * question this screen answers is not "what is the price" but "are we
 * competitive, and where does the money go". A single figure would hide
 * whether a thin number came from a thin margin or a missing input.
 */

interface Facets {
  widths: number[];
  aspectRatios: number[];
  rims: number[];
}

interface PreviewSettings {
  markupPercent: number;
  markupProvenance: string;
  minimumProfitCents: number | null;
  vatRatePercent: number;
  vatRateProvenance: string;
  pfuVatBase: string;
}

const SEASONS = [
  { value: "", label: "Tutte le stagioni" },
  { value: "summer", label: "Estivo" },
  { value: "winter", label: "Invernale" },
  { value: "all_season", label: "Quattro stagioni" },
] as const;

/** An amount, or a dash. Never a zero standing in for "we do not know". */
function money(cents: number | null): string {
  return cents === null ? "—" : formatCents(cents);
}

export function CatalogueSearch({ facets }: { facets: Facets }) {
  const tr = useTr();
  const [width, setWidth] = useState("");
  const [aspect, setAspect] = useState("");
  const [rim, setRim] = useState("");
  const [season, setSeason] = useState("");
  const [results, setResults] = useState<InternalTyreOffer[] | null>(null);
  const [settings, setSettings] = useState<PreviewSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSearch = width !== "" || aspect !== "" || rim !== "" || season !== "";

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (width) params.set("width", width);
      if (aspect) params.set("aspect", aspect);
      if (rim) params.set("rim", rim);
      if (season) params.set("season", season);

      const response = await fetch(`/api/admin/catalogue/search?${params.toString()}`);
      const payload = (await response.json()) as {
        ok?: boolean;
        results?: InternalTyreOffer[];
        settings?: PreviewSettings;
      };
      if (!response.ok || !payload.ok) {
        setError(tr("Ricerca non riuscita."));
        setResults(null);
        return;
      }
      setResults(payload.results ?? []);
      setSettings(payload.settings ?? null);
    } catch {
      setError(tr("Ricerca non riuscita."));
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [width, aspect, rim, season, tr]);

  // Re-run whenever a selector changes. The result set for one size is small
  // and the query is indexed, so a separate "search" click would only add a
  // step between the operator and the answer.
  useEffect(() => {
    if (!canSearch) {
      setResults(null);
      return;
    }
    const timer = setTimeout(() => void search(), 150);
    return () => clearTimeout(timer);
  }, [canSearch, search]);

  const pricedCount = useMemo(
    () => (results ?? []).filter((row) => row.tyreSaleNetCents !== null).length,
    [results]
  );

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Select
          label={tr("Larghezza")}
          value={width}
          onChange={setWidth}
          options={facets.widths.map((n) => ({ value: String(n), label: String(n) }))}
          anyLabel={tr("Tutte")}
        />
        <Select
          label={tr("Serie")}
          value={aspect}
          onChange={setAspect}
          options={facets.aspectRatios.map((n) => ({ value: String(n), label: String(n) }))}
          anyLabel={tr("Tutte")}
        />
        <Select
          label={tr("Cerchio")}
          value={rim}
          onChange={setRim}
          options={facets.rims.map((n) => ({ value: String(n), label: `R${n}` }))}
          anyLabel={tr("Tutti")}
        />
        <Select
          label={tr("Stagione")}
          value={season}
          onChange={setSeason}
          options={SEASONS.filter((s) => s.value !== "").map((s) => ({
            value: s.value,
            label: tr(s.label),
          }))}
          anyLabel={tr("Tutte")}
        />
      </div>

      {settings && <SettingsBanner settings={settings} />}

      {error && (
        <div className="mb-4 rounded-xl border border-state-danger/40 bg-state-danger-soft p-4">
          <p className="text-sm font-bold text-state-danger">{error}</p>
        </div>
      )}

      {!canSearch && (
        <div className="rounded-xl border border-dashed border-ink/20 bg-white px-6 py-16 text-center">
          <p className="text-base font-semibold text-ink">{tr("Scegli una misura")}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {tr("Per esempio 205 / 55 / R16, poi la stagione.")}
          </p>
        </div>
      )}

      {canSearch && loading && results === null && (
        <p className="py-10 text-center text-sm text-ink-soft">{tr("Ricerca in corso…")}</p>
      )}

      {canSearch && results !== null && results.length === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-ink/20 bg-white px-6 py-16 text-center">
          <p className="text-base font-semibold text-ink">{tr("Nessun pneumatico trovato")}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {tr("Nessun articolo a catalogo corrisponde a questa combinazione.")}
          </p>
        </div>
      )}

      {results !== null && results.length > 0 && (
        <>
          <p className="mb-3 text-sm text-ink-soft">
            {results.length} {tr("articoli")} · {pricedCount} {tr("con prezzo calcolabile")}
          </p>
          <div className="space-y-3">
            {results.map((row) => (
              <ResultCard key={row.supplierListingId} row={row} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SettingsBanner({ settings }: { settings: PreviewSettings }) {
  const tr = useTr();
  return (
    <div className="mb-4 rounded-xl border border-accent/30 bg-accent-light px-4 py-3">
      <p className="text-sm font-bold text-ink">
        {tr("Ricarico configurato")}: {settings.markupPercent}%
      </p>
      <p className="mt-1 text-xs text-ink-soft">
        {tr(
          "Impostazione commerciale centrale, non un valore fisso nel codice. Il ricarico non viene mai applicato al PFU."
        )}
      </p>
      {settings.pfuVatBase === "unresolved" && (
        <p className="mt-1 text-xs text-ink-soft">
          {tr(
            "Il trattamento IVA del PFU è ancora da confermare con il commercialista, quindi il totale finale non viene calcolato."
          )}
        </p>
      )}
    </div>
  );
}

function ResultCard({ row }: { row: InternalTyreOffer }) {
  const tr = useTr();
  const { tyre } = row;

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-base font-bold text-ink">
            {tyre.brand ?? tr("Marca non indicata")}{" "}
            <span className="font-medium text-ink-soft">{tyre.modelPattern ?? ""}</span>
          </p>
          <p className="text-sm text-ink-soft">
            {tyre.sizeDisplay ?? "—"}
            {tyre.loadSpeedRaw ? ` · ${tyre.loadSpeedRaw}` : ""}
            {tyre.season ? ` · ${tr(seasonLabel(tyre.season))}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {tyre.xl && <Tag label="XL" />}
          {tyre.runFlat && <Tag label="Run Flat" />}
          {tyre.oldDot && <Tag label={tr("DOT vecchio")} tone="waiting" />}
          {tyre.eprelId && <Tag label={`EPREL ${tyre.eprelId}`} tone="neutral" />}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-ink/10 pt-3 text-sm sm:grid-cols-3">
        <Row label={tr("Costo fornitore")} value={money(row.supplierCostCents)} />
        <Row
          label={`${tr("Ricarico")}${
            row.markupPercentApplied !== null ? ` ${row.markupPercentApplied}%` : ""
          }${row.minimumProfitApplied ? ` (${tr("minimo")})` : ""}`}
          value={money(row.markupAmountCents)}
        />
        <Row label={tr("Prezzo vendita netto")} value={money(row.tyreSaleNetCents)} strong />
        <Row
          label={tr("PFU")}
          value={row.pfuStatus === "TO_CONFIRM" ? tr("PFU da confermare") : money(row.pfuAmountCents)}
          tone={row.pfuStatus === "TO_CONFIRM" ? "waiting" : undefined}
        />
        <Row
          label={`${tr("IVA")}${
            row.vatRatePercentApplied !== null ? ` ${row.vatRatePercentApplied}%` : ""
          }`}
          value={money(row.vatAmountCents)}
        />
        <Row label={tr("Totale cliente")} value={money(row.customerTotalCents)} strong />
        <Row
          label={tr("Utile lordo")}
          value={
            row.grossProfitCents === null
              ? "—"
              : `${money(row.grossProfitCents)}${
                  row.grossMarginPercent !== null
                    ? ` (${row.grossMarginPercent.toFixed(1)}% ${tr("margine")})`
                    : ""
                }`
          }
        />
        <Row label={tr("Disponibilità")} value={tr(availabilityLabel(row.availability))} />
      </dl>

      {row.blockedReasons.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-ink/10 pt-3">
          {row.blockedReasons.map((reason) => (
            <li key={reason} className="text-xs text-ink-soft">
              {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function seasonLabel(season: string): string {
  if (season === "summer") return "Estivo";
  if (season === "winter") return "Invernale";
  if (season === "all_season") return "Quattro stagioni";
  return season;
}

function availabilityLabel(availability: string): string {
  if (availability === "in_stock") return "Disponibile";
  if (availability === "on_request") return "Su richiesta";
  return "Non nota";
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "waiting";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:block">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd
        className={[
          "tabular-nums",
          strong ? "text-base font-bold text-ink" : "text-sm text-ink",
          tone === "waiting" ? "text-state-waiting" : "",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

function Tag({ label, tone = "progress" }: { label: string; tone?: "progress" | "waiting" | "neutral" }) {
  const tones: Record<string, string> = {
    progress: "bg-state-progress-soft text-state-progress",
    waiting: "bg-state-waiting-soft text-state-waiting",
    neutral: "bg-state-neutral-soft text-state-neutral",
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{label}</span>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  anyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  anyLabel: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-soft">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
      >
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

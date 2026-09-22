"use client";

import { useCallback, useEffect, useState } from "react";
import { useTr } from "@/lib/i18n/tr";
import { formatCents } from "@/lib/documents/pipeline/money";
import { SUPPLIER_LANES, type LaneCode } from "@/lib/catalogue/supplier-lanes";
import type { CatalogueRow, SupplierOffer } from "@/lib/server/catalogue-browse";

/**
 * The admin Catalogue workspace: browse tyres, compare supplier offers.
 *
 * Two modes over one query. "All suppliers" puts each canonical tyre on one
 * row with a column per lane, for comparison. A single lane gets a denser
 * operational table, because when you already know the supplier the useful
 * question is cost, stock and freshness rather than who has it.
 *
 * INTERNAL. Supplier cost, article codes and raw stock are all on screen
 * deliberately; none of this may back a customer surface.
 */

interface Facets {
  widths: number[];
  aspectRatios: number[];
  rims: number[];
  seasons: string[];
  brands: string[];
}

interface BrowseResponse {
  ok?: boolean;
  rows?: CatalogueRow[];
  total?: number;
  limit?: number;
  offset?: number;
  facets?: Facets;
  settings?: { markupPercent: number; pfuVatBase: string };
  minimumOfferQuantity?: number;
}

const VEHICLES = [
  { value: "all", label: "Tutti" },
  { value: "car_van", label: "Auto e furgone" },
  { value: "truck", label: "Autocarro" },
] as const;

function money(cents: number | null): string {
  return cents === null ? "—" : formatCents(cents);
}

/** The supplier's figure, verbatim. A band stays a band. */
function stock(offer: SupplierOffer): string {
  if (offer.stockExact !== null) return String(offer.stockExact);
  if (offer.stockMinimum !== null) return `> ${offer.stockMinimum}`;
  return "—";
}

function freshness(offer: SupplierOffer, tr: (s: string) => string): string {
  if (offer.ageMs === null) return "—";
  const hours = Math.floor(offer.ageMs / 3_600_000);
  if (hours < 1) return tr("adesso");
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}g`;
}

export function CatalogueWorkspace({ initialFacets }: { initialFacets: Facets }) {
  const tr = useTr();
  const [lane, setLane] = useState<LaneCode | "all">("all");
  const [vehicle, setVehicle] = useState<string>("all");
  const [needsReview, setNeedsReview] = useState(false);
  const [width, setWidth] = useState("");
  const [aspect, setAspect] = useState("");
  const [rim, setRim] = useState("");
  const [season, setSeason] = useState("");
  const [brand, setBrand] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<CatalogueRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets>(initialFacets);
  const [markup, setMarkup] = useState<number | null>(null);
  const [minimumOffer, setMinimumOffer] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (lane !== "all") params.set("lane", lane);
      if (vehicle !== "all") params.set("vehicle", vehicle);
      if (needsReview) params.set("needsReview", "1");
      if (width) params.set("width", width);
      if (aspect) params.set("aspect", aspect);
      if (rim) params.set("rim", rim);
      if (season) params.set("season", season);
      if (brand) params.set("brand", brand);
      if (search.trim()) params.set("q", search.trim());
      params.set("limit", String(LIMIT));
      params.set("offset", String(page * LIMIT));

      const response = await fetch(`/api/admin/catalogue/browse?${params.toString()}`);
      const payload = (await response.json()) as BrowseResponse;
      if (!response.ok || !payload.ok) {
        setError(tr("Ricerca non riuscita."));
        setRows(null);
        return;
      }
      setRows(payload.rows ?? []);
      setTotal(payload.total ?? 0);
      if (payload.facets) setFacets(payload.facets);
      setMarkup(payload.settings?.markupPercent ?? null);
      setMinimumOffer(payload.minimumOfferQuantity ?? null);
    } catch {
      setError(tr("Ricerca non riuscita."));
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [lane, vehicle, needsReview, width, aspect, rim, season, brand, search, page, tr]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 180);
    return () => clearTimeout(timer);
  }, [load]);

  // Any filter change invalidates the current page number.
  useEffect(() => {
    setPage(0);
  }, [lane, vehicle, needsReview, width, aspect, rim, season, brand, search]);

  const activeLane = lane === "all" ? null : lane;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div>
      {/* Supplier lanes */}
      <div className="mb-4 flex flex-wrap gap-2">
        <LaneTab active={lane === "all"} onClick={() => setLane("all")} label={tr("Tutti i fornitori")} />
        {SUPPLIER_LANES.map((entry) => (
          <LaneTab
            key={entry.code}
            active={lane === entry.code}
            onClick={() => setLane(entry.code)}
            label={`${entry.label} · ${entry.leadTimeLabel}`}
          />
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Select label={tr("Veicolo")} value={vehicle} onChange={setVehicle}
          options={VEHICLES.map((v) => ({ value: v.value, label: tr(v.label) }))} includeAny={false} />
        <Select label={tr("Larghezza")} value={width} onChange={setWidth}
          options={facets.widths.map((n) => ({ value: String(n), label: String(n) }))} anyLabel={tr("Tutte")} />
        <Select label={tr("Serie")} value={aspect} onChange={setAspect}
          options={facets.aspectRatios.map((n) => ({ value: String(n), label: String(n) }))} anyLabel={tr("Tutte")} />
        <Select label={tr("Cerchio")} value={rim} onChange={setRim}
          options={facets.rims.map((n) => ({ value: String(n), label: `R${n}` }))} anyLabel={tr("Tutti")} />
        <Select label={tr("Stagione")} value={season} onChange={setSeason}
          options={facets.seasons.map((s) => ({ value: s, label: tr(seasonLabel(s)) }))} anyLabel={tr("Tutte")} />
        <Select label={tr("Marca")} value={brand} onChange={setBrand}
          options={facets.brands.map((b) => ({ value: b, label: b }))} anyLabel={tr("Tutte")} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-soft">
            {tr("Cerca")}
          </span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr("EAN o modello")}
            className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={needsReview}
            onChange={(event) => setNeedsReview(event.target.checked)}
            className="h-4 w-4 rounded border-ink/30" />
          {tr("Solo da verificare")}
        </label>
        <p className="text-sm text-ink-soft">
          {total} {tr("pneumatici")}
          {markup !== null && ` · ${tr("ricarico")} ${markup}%`}
          {minimumOffer !== null && ` · ${tr("minimo vendita")} ${minimumOffer}`}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-state-danger/40 bg-state-danger-soft p-4">
          <p className="text-sm font-bold text-state-danger">{error}</p>
        </div>
      )}

      {rows !== null && rows.length === 0 && !loading && (
        <EmptyState lane={activeLane} />
      )}

      {loading && rows === null && (
        <p className="py-10 text-center text-sm text-ink-soft">{tr("Caricamento…")}</p>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <div className="space-y-2">
            {rows.map((row) => (
              <CatalogueRowCard key={row.product.productId} row={row} lane={activeLane} />
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-ink/15 px-3 py-2 text-sm disabled:opacity-40"
            >
              {tr("Precedente")}
            </button>
            <span className="text-sm text-ink-soft">
              {tr("Pagina")} {page + 1} / {pages}
            </span>
            <button
              onClick={() => setPage((p) => (p + 1 < pages ? p + 1 : p))}
              disabled={page + 1 >= pages}
              className="rounded-lg border border-ink/15 px-3 py-2 text-sm disabled:opacity-40"
            >
              {tr("Successiva")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** A lane with no listings is a real state, not an error. */
function EmptyState({ lane }: { lane: LaneCode | null }) {
  const tr = useTr();
  const entry = SUPPLIER_LANES.find((l) => l.code === lane);

  return (
    <div className="rounded-xl border border-dashed border-ink/20 bg-white px-6 py-16 text-center">
      <p className="text-base font-semibold text-ink">
        {entry ? `${entry.label}: ${tr("nessun articolo a catalogo")}` : tr("Nessun pneumatico trovato")}
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">
        {entry
          ? tr("Questo fornitore non ha ancora un listino importato. Nessun dato viene inventato.")
          : tr("Nessun articolo corrisponde a questi filtri.")}
      </p>
    </div>
  );
}

function CatalogueRowCard({ row, lane }: { row: CatalogueRow; lane: LaneCode | null }) {
  const tr = useTr();
  const { product } = row;

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-3 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">
            {product.brand ?? tr("Marca non indicata")}{" "}
            <span className="font-medium text-ink-soft">{product.modelPattern ?? ""}</span>
          </p>
          <p className="text-xs text-ink-soft">
            {product.sizeDisplay ?? sizeFallback(product)}
            {product.loadSpeedRaw ? ` · ${product.loadSpeedRaw}` : ""}
            {" · "}
            {product.season ? tr(seasonLabel(product.season)) : (
              <span className="text-state-waiting">{tr("stagione non indicata")}</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <StateBadge state={row.state} />
          {product.xl && <Tag label="XL" />}
          {product.runFlat && <Tag label="RFT" />}
          {product.oldDot && <Tag label={tr("DOT vecchio")} tone="waiting" />}
        </div>
      </div>

      {row.offers.length === 0 ? (
        <p className="mt-2 border-t border-ink/10 pt-2 text-xs text-ink-soft">
          {tr("Nessuna offerta fornitore per questo filtro.")}
        </p>
      ) : lane ? (
        <SupplierModeTable offers={row.offers} />
      ) : (
        <CompareModeGrid offers={row.offers} />
      )}
    </div>
  );
}

/** All-suppliers: one cell per lane, so a tyre's options sit side by side. */
function CompareModeGrid({ offers }: { offers: readonly SupplierOffer[] }) {
  const tr = useTr();
  return (
    <div className="mt-2 grid gap-2 border-t border-ink/10 pt-2 sm:grid-cols-3">
      {SUPPLIER_LANES.map((entry) => {
        const offer = offers.find((o) => o.laneCode === entry.code);
        return (
          <div key={entry.code} className="rounded-lg border border-ink/10 px-2 py-1.5">
            <p className="text-xs font-semibold text-ink-soft">{entry.label}</p>
            {offer ? (
              <>
                <p className="text-sm font-bold tabular-nums text-ink">
                  {money(offer.purchasePriceCents)}
                </p>
                <p className="text-xs text-ink-soft">
                  {tr("stock")} {stock(offer)} · {freshness(offer, tr)}
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-soft">—</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Supplier mode: denser, because the supplier is already known. */
function SupplierModeTable({ offers }: { offers: readonly SupplierOffer[] }) {
  const tr = useTr();
  return (
    <div className="mt-2 overflow-x-auto border-t border-ink/10 pt-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-ink-soft">
            <th className="pb-1 font-medium">{tr("Costo")}</th>
            <th className="pb-1 font-medium">{tr("Stock")}</th>
            <th className="pb-1 font-medium">{tr("Aggiornato")}</th>
            <th className="pb-1 font-medium">{tr("Articolo")}</th>
            <th className="pb-1 font-medium">{tr("Vendibile")}</th>
            <th className="pb-1 font-medium">{tr("Prezzo netto GommaRush")}</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => (
            <tr key={offer.listingId} className="border-t border-ink/5">
              <td className="py-1 font-bold tabular-nums text-ink">
                {money(offer.purchasePriceCents)}
              </td>
              <td className="py-1 tabular-nums text-ink">{stock(offer)}</td>
              <td className="py-1 text-ink-soft">{freshness(offer, tr)}</td>
              <td className="py-1 font-mono text-ink-soft">{offer.supplierArticleId ?? "—"}</td>
              <td className="py-1">
                {offer.sellable ? (
                  <span className="text-state-success">{tr("sì")}</span>
                ) : (
                  <span className="text-state-waiting">{tr(sellabilityLabel(offer.sellabilityReason))}</span>
                )}
              </td>
              <td className="py-1 tabular-nums text-ink">
                {money(offer.pricing.tyreSaleNetCents)}
                {/* PFU is unresolved, so a customer-payable total is never shown. */}
                <span className="ml-1 text-ink-soft">{tr("+ PFU da confermare")}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StateBadge({ state }: { state: CatalogueRow["state"] }) {
  const tr = useTr();
  const map: Record<string, { label: string; tone: string }> = {
    CURRENT: { label: "Aggiornato", tone: "bg-state-success-soft text-state-success" },
    NO_CURRENT_PRICE: { label: "Senza prezzo attuale", tone: "bg-state-neutral-soft text-state-neutral" },
    NEEDS_REVIEW: { label: "Da verificare", tone: "bg-state-waiting-soft text-state-waiting" },
    CONFLICT: { label: "Conflitto", tone: "bg-state-danger-soft text-state-danger" },
  };
  const entry = map[state] ?? map.NO_CURRENT_PRICE;
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${entry.tone}`}>
      {tr(entry.label)}
    </span>
  );
}

function sizeFallback(p: CatalogueRow["product"]): string {
  if (p.widthMm && p.aspectRatio && p.rimInch) return `${p.widthMm}/${p.aspectRatio} R${p.rimInch}`;
  return "—";
}

function seasonLabel(season: string): string {
  if (season === "summer") return "Estivo";
  if (season === "winter") return "Invernale";
  if (season === "all_season") return "Quattro stagioni";
  return season;
}

function sellabilityLabel(reason: string): string {
  if (reason === "below_minimum_offer_quantity") return "sotto il minimo";
  if (reason === "supplier_out_of_stock") return "esaurito";
  if (reason === "stock_unknown") return "stock non noto";
  return "no";
}

function Tag({ label, tone = "progress" }: { label: string; tone?: "progress" | "waiting" }) {
  const tones: Record<string, string> = {
    progress: "bg-state-progress-soft text-state-progress",
    waiting: "bg-state-waiting-soft text-state-waiting",
  };
  return <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{label}</span>;
}

function LaneTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
        active ? "bg-ink text-white" : "border border-ink/15 bg-white text-ink hover:border-accent"
      }`}
    >
      {label}
    </button>
  );
}

function Select({
  label, value, onChange, options, anyLabel, includeAny = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  anyLabel?: string;
  includeAny?: boolean;
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
        {includeAny && <option value="">{anyLabel ?? ""}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

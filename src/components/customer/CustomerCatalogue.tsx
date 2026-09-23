"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { addBasketLine } from "@/lib/customer/basket";
import { BRAND_TIER_LABELS } from "@/lib/catalogue/brand-tiers";

type Offer = {
  tyre: {
    productId: string;
    brand: string | null;
    modelPattern: string | null;
    sizeDisplay: string | null;
    loadIndex: string | null;
    speedRating: string | null;
    season: string | null;
    xl: boolean | null;
    runFlat: boolean | null;
    oldDot: boolean;
  };
  availability: "unknown" | "in_stock" | "on_request";
  tyreSaleNetCents: number | null;
  pfuStatus: string;
  pfuAmountCents: number | null;
  vatAmountCents: number | null;
  customerTotalCents: number | null;
  priceAvailable: boolean;
};
type Facets = { widths: number[]; aspectRatios: number[]; rims: number[]; brands: string[] };
type Refusal = { reason: string; matched: number; maximum: number };

const PAGE_SIZE = 24;
const money = (c: number | null) =>
  c === null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100);

const EMPTY_FACETS: Facets = { widths: [], aspectRatios: [], rims: [], brands: [] };

export function CustomerCatalogue() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [refused, setRefused] = useState<Refusal | null>(null);
  const [tiersConfigured, setTiersConfigured] = useState(false);

  const [width, setWidth] = useState("");
  const [aspect, setAspect] = useState("");
  const [rim, setRim] = useState("");
  const [season, setSeason] = useState("");
  const [brand, setBrand] = useState("");
  const [tier, setTier] = useState("");
  const [sort, setSort] = useState("price_asc");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(() => {
    const p = new URLSearchParams();
    if (width) p.set("width", width);
    if (aspect) p.set("aspect", aspect);
    if (rim) p.set("rim", rim);
    if (season) p.set("season", season);
    if (brand.trim()) p.set("brand", brand.trim());
    if (tier) p.set("tier", tier);
    p.set("sort", sort);
    return p.toString();
  }, [width, aspect, rim, season, brand, tier, sort]);

  // A changed filter or order invalidates the page number: page 3 of the old
  // selection is not page 3 of the new one.
  useEffect(() => setPage(0), [filters]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = `${filters}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
        const r = await fetch(`/api/account/catalogue?${qs}`, { signal: controller.signal });
        const j = await r.json();
        if (!r.ok) throw new Error();
        setOffers(j.offers ?? []);
        setFacets(j.facets ?? EMPTY_FACETS);
        setTotal(j.total ?? 0);
        setRefused(j.refused ?? null);
        setTiersConfigured(j.tiersConfigured === true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Catalogo non disponibile. Riprova.");
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, page]);

  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);
  const add = useCallback((o: Offer) => addBasketLine(o.tyre.productId, o.tyre.oldDot), []);

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-ink">Catalogo pneumatici</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Cerca per misura e stagione. Il prezzo mostrato è il miglior prezzo GommaRush per ogni pneumatico.
      </p>

      <div className="mt-6 grid gap-3 rounded-2xl bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-3">
        <Select label="Larghezza" value={width} set={setWidth} values={facets.widths} />
        <Select label="Spalla" value={aspect} set={setAspect} values={facets.aspectRatios} />
        <Select label="Cerchio" value={rim} set={setRim} values={facets.rims} />
        <label className="text-sm font-semibold text-ink">
          Stagione
          <select
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-3 font-normal"
          >
            <option value="">Tutte le stagioni</option>
            <option value="summer">Estive</option>
            <option value="winter">Invernali</option>
            <option value="all_season">4 stagioni</option>
          </select>
        </label>
        <label className="text-sm font-semibold text-ink">
          Marca
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Es. Michelin"
            list="customer-catalogue-brands"
            className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-3 font-normal"
          />
          <datalist id="customer-catalogue-brands">
            {facets.brands.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
        <label className="text-sm font-semibold text-ink">
          Ordina per
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-3 font-normal"
          >
            <option value="price_asc">Prezzo più basso</option>
            <option value="brand_asc">Marca A–Z</option>
          </select>
        </label>

        {/*
          Premium / Fascia media / Economiche appear only once an APPROVED brand
          classification exists. Showing three filters that all return nothing
          would look like an empty catalogue instead of an unset business rule.
        */}
        {tiersConfigured && (
          <label className="text-sm font-semibold text-ink">
            Fascia
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-3 font-normal"
            >
              <option value="">Tutte le fasce</option>
              {BRAND_TIER_LABELS.map((x) => (
                <option key={x.tier} value={x.tier}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {refused ? (
        <p className="mt-6 rounded-xl bg-white p-4 text-sm text-ink-soft shadow-card">
          La selezione è troppo ampia per essere ordinata correttamente ({refused.matched} pneumatici).
          Scegli almeno una misura per restringere la ricerca.
        </p>
      ) : error ? (
        <p className="mt-6 rounded-xl bg-state-danger-soft p-4 text-state-danger">{error}</p>
      ) : loading ? (
        <p className="mt-6 text-sm text-ink-soft">Ricerca…</p>
      ) : (
        <>
          <p className="mt-6 text-sm text-ink-soft" aria-live="polite">
            {total === 0 ? "Nessun risultato" : `${total} pneumatici disponibili`}
          </p>
          <div className="mt-3 space-y-3">
            {offers.length === 0 ? (
              <div className="rounded-2xl bg-white p-8 text-center text-ink-soft">
                Nessun pneumatico disponibile con questi filtri.
              </div>
            ) : (
              offers.map((o) => (
                <article
                  key={`${o.tyre.productId}-${o.tyre.oldDot ? "old" : "new"}`}
                  className="rounded-2xl bg-white p-5 shadow-card"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-extrabold text-ink">
                        {o.tyre.brand ?? "Marca non indicata"} {o.tyre.modelPattern ?? ""}
                      </div>
                      <div className="mt-1 text-sm text-ink-soft">
                        {o.tyre.sizeDisplay ?? "Misura non indicata"} {o.tyre.loadIndex ?? ""}
                        {o.tyre.speedRating ?? ""}
                        {o.tyre.xl ? " XL" : ""}
                        {o.tyre.runFlat ? " Run-flat" : ""}
                      </div>
                      {o.tyre.oldDot && <div className="mt-2 text-xs font-semibold">DOT precedente</div>}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-extrabold text-ink">
                        {money(o.tyreSaleNetCents)}{" "}
                        <span className="text-xs font-medium text-ink-soft">netto</span>
                      </div>
                      <div className="mt-1 text-xs text-ink-soft">
                        {o.pfuStatus === "TO_CONFIRM" ? "PFU da confermare" : "PFU incluso"}
                      </div>
                      <Button
                        className="mt-3"
                        size="md"
                        disabled={!o.priceAvailable}
                        onClick={() => add(o)}
                      >
                        Aggiungi
                      </Button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>

          {total > PAGE_SIZE && (
            <nav className="mt-6 flex items-center justify-between gap-4" aria-label="Paginazione">
              <Button size="md" disabled={page === 0} onClick={() => setPage((x) => Math.max(x - 1, 0))}>
                Precedente
              </Button>
              <span className="text-sm text-ink-soft">
                Pagina {page + 1} di {lastPage + 1}
              </span>
              <Button
                size="md"
                disabled={page >= lastPage}
                onClick={() => setPage((x) => Math.min(x + 1, lastPage))}
              >
                Successiva
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  set,
  values,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  values: number[];
}) {
  return (
    <label className="text-sm font-semibold text-ink">
      {label}
      <select
        value={value}
        onChange={(e) => set(e.target.value)}
        className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-3 font-normal"
      >
        <option value="">Tutte</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}

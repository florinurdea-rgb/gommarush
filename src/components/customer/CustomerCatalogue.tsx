"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { addBasketLine } from "@/lib/customer/basket";
import { BRAND_TIER_LABELS } from "@/lib/catalogue/brand-tiers";
import { catalogueViewState } from "@/lib/customer/catalogue-view";
import { useTr } from "@/lib/i18n/tr";

/**
 * The customer tyre search.
 *
 * DELIBERATE, NOT EAGER. Nothing is fetched until width, aspect ratio and rim
 * are all chosen. A tyre shop buys a size; a catalogue that dumps thousands of
 * unrelated tyres on arrival is slower to use, not faster, and it is also the
 * one query shape the global sort has to refuse. The route enforces the same
 * rule, so this is the pleasant half of the gate rather than the whole of it.
 *
 * NEVER FROZEN. Every fetch — a changed dimension, season, brand, order or page
 * — swaps the results for skeleton cards of the same shape, and the controls
 * stay usable throughout. A stale list sitting under a new filter is worse than
 * a placeholder, because it looks like an answer.
 */

type Offer = {
  tyre: {
    productId: string;
    brand: string | null;
    modelPattern: string | null;
    sizeDisplay: string | null;
    loadIndex: string | null;
    speedRating: string | null;
    loadSpeedRaw: string | null;
    season: string | null;
    xl: boolean | null;
    runFlat: boolean | null;
    oldDot: boolean;
  };
  availability: "unknown" | "in_stock" | "on_request";
  tyreSaleNetCents: number | null;
  pfuStatus: string;
  pfuEstimated: boolean;
  pfuAmountCents: number | null;
  vatAmountCents: number | null;
  customerTotalCents: number | null;
  priceAvailable: boolean;
};
type Facets = { widths: number[]; aspectRatios: number[]; rims: number[]; brands: string[] };
type Refusal = { reason: string; matched: number; maximum: number };

const PAGE_SIZE = 24;
const EMPTY_FACETS: Facets = { widths: [], aspectRatios: [], rims: [], brands: [] };

const money = (c: number | null) =>
  c === null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100);

const SEASON_LABELS: Record<string, string> = {
  summer: "Estive",
  winter: "Invernali",
  all_season: "4 stagioni",
};

const AVAILABILITY_LABELS: Record<Offer["availability"], string> = {
  in_stock: "Disponibile",
  on_request: "Su richiesta",
  unknown: "Da verificare",
};

export function CustomerCatalogue() {
  const tr = useTr();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [refused, setRefused] = useState<Refusal | null>(null);
  const [tiersConfigured, setTiersConfigured] = useState(false);
  const [deliveryDays, setDeliveryDays] = useState(7);

  const [width, setWidth] = useState("");
  const [aspect, setAspect] = useState("");
  const [rim, setRim] = useState("");
  const [season, setSeason] = useState("");
  const [brand, setBrand] = useState("");
  const [tier, setTier] = useState("");
  const [sort, setSort] = useState("price_asc");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dimensions = { widthMm: width, aspectRatio: aspect, rimInch: rim };

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
    // ALWAYS FETCH — including before a size is chosen.
    //
    // The facet lists that FILL these dropdowns come back from this same
    // endpoint. Skipping the request until all three dimensions were set was a
    // deadlock: no request meant no widths, no widths meant nothing to select,
    // and the size could never be completed.
    //
    // The gate that matters is server-side and still in force: with an
    // incomplete size the route returns facets and `awaitingDimensions: true`
    // WITHOUT touching the catalogue read, so this costs a cheap facet query
    // and never the whole-catalogue scan the sort would have to refuse.
    const controller = new AbortController();
    // Debounced so typing a brand does not fire a request per keystroke. The
    // loading state is set immediately, before the debounce, so the UI reacts
    // to the keystroke even though the request has not left yet.
    setLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const qs = `${filters}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
        const r = await fetch(`/api/account/catalogue?${qs}`, { signal: controller.signal });
        const j = await r.json();
        if (!r.ok) throw new Error();
        // Facets always apply; results only once the server actually ran the
        // catalogue read. `awaitingDimensions` says which of the two this was.
        setFacets(j.facets ?? EMPTY_FACETS);
        setOffers(j.awaitingDimensions ? [] : (j.offers ?? []));
        setTotal(j.awaitingDimensions ? 0 : (j.total ?? 0));
        setRefused(j.awaitingDimensions ? null : (j.refused ?? null));
        setTiersConfigured(j.tiersConfigured === true);
        if (typeof j.fulfilment?.maxDays === "number") setDeliveryDays(j.fulfilment.maxDays);
        setLoading(false);
      } catch (e) {
        // An aborted request is superseded, not failed: leave the spinner up
        // for the request that replaced it rather than flashing an error.
        if ((e as Error).name === "AbortError") return;
        setError(tr("Catalogo non disponibile. Riprova."));
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, page]);

  const view = catalogueViewState({
    ...dimensions,
    loading,
    error: error !== null,
    refused: refused !== null,
  });

  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);

  /**
   * Which card was just added, so the button can confirm it.
   *
   * Adding wrote to localStorage and changed nothing on screen, so a working
   * click and a broken one looked identical. The nav badge is the durable
   * signal; this is the immediate one, at the point of the click.
   */
  const [added, setAdded] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const add = useCallback(
    (o: Offer) => {
      const key = `${o.tyre.productId}-${o.tyre.oldDot ? "old" : "new"}`;
      if (addBasketLine(o.tyre.productId, o.tyre.oldDot)) {
        setAddError(null);
        setAdded(key);
        window.setTimeout(() => setAdded((current) => (current === key ? null : current)), 1800);
        return;
      }
      // Storage refused the write — private browsing, blocked site data, or a
      // full quota. Silence here is what made this look broken.
      setAddError(
        tr("Impossibile salvare il carrello: il browser blocca l'archiviazione locale.")
      );
    },
    [tr]
  );

  function reset() {
    setWidth("");
    setAspect("");
    setRim("");
    setSeason("");
    setBrand("");
    setTier("");
  }

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-ink">{tr("Catalogo pneumatici")}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {tr("Scegli la misura per vedere i pneumatici disponibili e il prezzo GommaRush.")}
      </p>

      <div className="mt-6 rounded-2xl bg-white p-4 shadow-card">
        <fieldset>
          <legend className="text-xs font-bold uppercase tracking-wide text-ink-soft">
            {tr("Misura")}{" "}
            <span className="font-semibold text-state-danger">{tr("obbligatoria")}</span>
          </legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <Select label={tr("Larghezza")} value={width} set={setWidth} values={facets.widths} placeholder={tr("Scegli")} />
            <Select label={tr("Spalla")} value={aspect} set={setAspect} values={facets.aspectRatios} placeholder={tr("Scegli")} />
            <Select label={tr("Cerchio")} value={rim} set={setRim} values={facets.rims} placeholder={tr("Scegli")} />
          </div>
        </fieldset>

        <fieldset className="mt-4 border-t border-ink/10 pt-4">
          <legend className="sr-only">{tr("Filtri aggiuntivi")}</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-semibold text-ink">
              {tr("Stagione")}
              <select
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-3 font-normal"
              >
                <option value="">{tr("Tutte le stagioni")}</option>
                <option value="summer">{tr("Estive")}</option>
                <option value="winter">{tr("Invernali")}</option>
                <option value="all_season">{tr("4 stagioni")}</option>
              </select>
            </label>

            <label className="text-sm font-semibold text-ink">
              {tr("Marca")}
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder={tr("Tutte le marche")}
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
              {tr("Ordina per")}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-3 font-normal"
              >
                <option value="price_asc">{tr("Prezzo più basso")}</option>
                <option value="brand_asc">{tr("Marca A–Z")}</option>
              </select>
            </label>

            {/*
              Premium / Fascia media / Economiche appear only once an APPROVED
              brand classification exists. Three filters that all return nothing
              would read as an empty catalogue instead of an unset business rule.
            */}
            {tiersConfigured && (
              <label className="text-sm font-semibold text-ink">
                {tr("Fascia")}
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-3 font-normal"
                >
                  <option value="">{tr("Tutte le fasce")}</option>
                  {BRAND_TIER_LABELS.map((x) => (
                    <option key={x.tier} value={x.tier}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </fieldset>

        {(width || aspect || rim || season || brand || tier) && (
          <button
            type="button"
            onClick={reset}
            className="mt-4 text-sm font-semibold text-ink-soft underline hover:text-ink"
          >
            {tr("Azzera i filtri")}
          </button>
        )}
      </div>

      {addError && (
        <p role="alert" className="mt-4 rounded-xl bg-state-danger-soft p-4 text-sm text-state-danger">
          {addError}
        </p>
      )}

      <div className="mt-6" aria-live="polite" aria-busy={loading}>
        {view === "awaiting_dimensions" ? (
          <PromptForSize tr={tr} />
        ) : view === "loading" ? (
          <ResultsSkeleton tr={tr} />
        ) : view === "error" ? (
          <p className="rounded-xl bg-state-danger-soft p-4 text-state-danger">{error}</p>
        ) : view === "refused" ? (
          <p className="rounded-2xl bg-white p-5 text-sm text-ink-soft shadow-card">
            {tr("La selezione è troppo ampia per essere ordinata correttamente.")}{" "}
            {refused?.matched} {tr("pneumatici")}. {tr("Aggiungi un filtro per restringere la ricerca.")}
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-soft">
              {total === 0 ? tr("Nessun risultato") : `${total} ${tr("pneumatici disponibili")}`}
            </p>

            <div className="mt-3 space-y-3">
              {offers.map((o) => (
                <OfferCard
                  key={`${o.tyre.productId}-${o.tyre.oldDot ? "old" : "new"}`}
                  offer={o}
                  deliveryDays={deliveryDays}
                  onAdd={add}
                  added={added === `${o.tyre.productId}-${o.tyre.oldDot ? "old" : "new"}`}
                  tr={tr}
                />
              ))}
            </div>

            {total > PAGE_SIZE && (
              <nav className="mt-6 flex items-center justify-between gap-4" aria-label={tr("Paginazione")}>
                <Button size="md" variant="secondary" disabled={page === 0} onClick={() => setPage((x) => Math.max(x - 1, 0))}>
                  {tr("Precedente")}
                </Button>
                <span className="text-sm text-ink-soft">
                  {tr("Pagina")} {page + 1} {tr("di")} {lastPage + 1}
                </span>
                <Button
                  size="md"
                  variant="secondary"
                  disabled={page >= lastPage}
                  onClick={() => setPage((x) => Math.min(x + 1, lastPage))}
                >
                  {tr("Successiva")}
                </Button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type Tr = (text: string) => string;

function OfferCard({
  offer,
  deliveryDays,
  onAdd,
  added,
  tr,
}: {
  offer: Offer;
  deliveryDays: number;
  onAdd: (o: Offer) => void;
  added: boolean;
  tr: Tr;
}) {
  const t = offer.tyre;
  const loadSpeed = t.loadSpeedRaw ?? [t.loadIndex, t.speedRating].filter(Boolean).join("");

  return (
    <article className="rounded-2xl bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-extrabold text-ink">
            {t.brand ?? tr("Marca non indicata")} {t.modelPattern ?? ""}
          </div>
          <div className="mt-1 text-sm text-ink-soft">
            {t.sizeDisplay ?? tr("Misura non indicata")}
            {loadSpeed ? ` · ${loadSpeed}` : ""}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {t.season && SEASON_LABELS[t.season] && <Tag>{tr(SEASON_LABELS[t.season])}</Tag>}
            {t.xl && <Tag>XL</Tag>}
            {t.runFlat && <Tag>Run-flat</Tag>}
            {t.oldDot && <Tag>{tr("DOT precedente")}</Tag>}
            <Tag>{tr(AVAILABILITY_LABELS[offer.availability])}</Tag>
          </div>
        </div>

        <div className="text-right">
          <div className="text-lg font-extrabold text-ink">
            {money(offer.tyreSaleNetCents)}{" "}
            <span className="text-xs font-medium text-ink-soft">{tr("netto")}</span>
          </div>
          {/*
            The PFU disclosure. An unqualified price next to an "Add" button
            reads as the price payable, so the card says what is still on top
            of it and — when the PFU is the temporary estimate — that the
            estimate can move.
          */}
          <div className="mt-1 text-xs text-ink-soft">
            {offer.pfuEstimated
              ? `+ ${tr("PFU stimato")} + ${tr("IVA")} 22%`
              : offer.pfuStatus === "TO_CONFIRM"
                ? `+ ${tr("PFU")} ${tr("e")} ${tr("IVA")} ${tr("da confermare")}`
                : `+ ${tr("PFU")} + ${tr("IVA")} 22%`}
          </div>
          {offer.pfuEstimated && (
            <div className="mt-1 max-w-[16rem] text-[11px] leading-snug text-state-warning">
              {tr("PFU stimato — l'importo definitivo può variare.")}
            </div>
          )}
          <div className="mt-1 text-xs font-semibold text-state-success">
            {tr("Consegna entro")} {deliveryDays} {tr("giorni")}
          </div>
          <Button
            className="mt-3"
            size="md"
            variant={added ? "secondary" : "primary"}
            disabled={!offer.priceAvailable}
            onClick={() => onAdd(offer)}
          >
            {added ? `✓ ${tr("Aggiunto")}` : tr("Aggiungi")}
          </Button>
        </div>
      </div>
    </article>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-soft px-2.5 py-1 text-xs font-semibold text-ink-soft">
      {children}
    </span>
  );
}

/** Shown before a size is chosen — an instruction, not an empty result. */
function PromptForSize({ tr }: { tr: Tr }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/20 bg-white/60 p-8 text-center">
      <p className="font-semibold text-ink">{tr("Scegli larghezza, spalla e cerchio")}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
        {tr(
          "Il catalogo mostra i risultati dopo che hai indicato la misura completa, per esempio 205 / 55 / R16."
        )}
      </p>
    </div>
  );
}

/** Placeholders of the same shape as the cards they replace. */
function ResultsSkeleton({ tr }: { tr: Tr }) {
  return (
    <div>
      <div className="h-5 w-40 animate-pulse rounded bg-ink/10" />
      <div className="mt-3 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl bg-white p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-5 w-48 animate-pulse rounded bg-ink/10" />
                <div className="h-4 w-32 animate-pulse rounded bg-ink/10" />
                <div className="flex gap-2 pt-1">
                  <div className="h-6 w-16 animate-pulse rounded-full bg-ink/10" />
                  <div className="h-6 w-20 animate-pulse rounded-full bg-ink/10" />
                </div>
              </div>
              <div className="w-36 space-y-2">
                <div className="ml-auto h-6 w-24 animate-pulse rounded bg-ink/10" />
                <div className="ml-auto h-3 w-28 animate-pulse rounded bg-ink/10" />
                <div className="ml-auto h-11 w-28 animate-pulse rounded-xl bg-ink/10" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">{tr("Ricerca in corso…")}</span>
    </div>
  );
}

function Select({
  label,
  value,
  set,
  values,
  placeholder,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  values: number[];
  placeholder: string;
}) {
  /*
    THE APPLIED VALUE IS ALWAYS AN OPTION.

    These lists are DEPENDENT facets: each one is computed with the other
    filters applied. So a chosen width can legitimately disappear from the
    width list once a season or a rim narrows the catalogue past it — and a
    <select> whose value matches no <option> renders BLANK while the filter is
    still in force. The control said "nothing selected" and the results said
    otherwise, which is what "filters randomly reset" looked like.

    Keeping the value in the list means the control always shows what is
    actually being filtered on, and the customer can see it to clear it.
  */
  const options = values.map(String);
  const missing = value !== "" && !options.includes(value);

  return (
    <label className="text-sm font-semibold text-ink">
      {label}
      <select
        value={value}
        onChange={(e) => set(e.target.value)}
        className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-3 font-normal"
      >
        <option value="">{placeholder}</option>
        {missing && <option value={value}>{value}</option>}
        {options.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}

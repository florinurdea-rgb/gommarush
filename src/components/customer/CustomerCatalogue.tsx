"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { CartIcon } from "@/components/customer/CartIcon";
import { addBasketLine } from "@/lib/customer/basket";
import { BRAND_TIER_LABELS } from "@/lib/catalogue/brand-tiers";
import { catalogueViewState, sameFacets } from "@/lib/customer/catalogue-view";
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
 *
 * ONE STICKY ROW. The filters are a single row of labelled selections pinned to
 * the top of the viewport. A customer comparing tyres scrolls, and a filter bar
 * that scrolls away turns every adjustment into a round trip to the top of the
 * page — which is also when a half-remembered selection gets re-entered wrongly.
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

/** How long the card keeps its confirmed state, and the toast stays up. */
const CONFIRMATION_MS = 2600;

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
        //
        // Replaced only when they actually DIFFER. Handing React a new array of
        // identical values re-renders every <option> in every selector, and a
        // browser rebuilding the options of an OPEN dropdown closes it. See the
        // note in Select: this is half of the "dropdowns reset" fix, and the
        // cheaper half — a response that changes nothing now disturbs nothing.
        setFacets((current) => (sameFacets(current, j.facets) ? current : (j.facets ?? EMPTY_FACETS)));
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
   * signal; this is the immediate one, at the point of the click, and the
   * toast below is the one a customer looking at the card cannot miss.
   */
  const [added, setAdded] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; tyre: string } | null>(null);

  const add = useCallback(
    (o: Offer) => {
      const key = `${o.tyre.productId}-${o.tyre.oldDot ? "old" : "new"}`;
      if (addBasketLine(o.tyre.productId, o.tyre.oldDot)) {
        setAddError(null);
        setAdded(key);
        const id = Date.now();
        setToast({
          id,
          tyre: [o.tyre.brand, o.tyre.modelPattern, o.tyre.sizeDisplay].filter(Boolean).join(" "),
        });
        window.setTimeout(() => setAdded((current) => (current === key ? null : current)), CONFIRMATION_MS);
        window.setTimeout(
          () => setToast((current) => (current?.id === id ? null : current)),
          CONFIRMATION_MS
        );
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

  const hasFilters = Boolean(width || aspect || rim || season || brand || tier);
  // Both literals appear in the source, so Tailwind's scanner emits both.
  const columns = tiersConfigured ? "lg:grid-cols-7" : "lg:grid-cols-6";

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-ink">{tr("Catalogo pneumatici")}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {tr("Scegli la misura per vedere i pneumatici disponibili e il prezzo GommaRush.")}
      </p>

      {/*
        THE STICKY FILTER BAR.

        Pinned to the top of the viewport, full container width (the negative
        gutters cancel the page padding so the backdrop reaches the edges and
        results do not show through beside it).
      */}
      <div className="sticky top-0 z-30 -mx-4 mt-5 border-b border-ink/10 bg-surface-soft/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="rounded-2xl bg-white p-3 shadow-card">
          <p className="sr-only">
            {tr("Larghezza, spalla e cerchio sono obbligatori per vedere i risultati.")}
          </p>

          <div className={`grid grid-cols-3 gap-2 ${columns}`}>
            <Select
              label={tr("Larghezza")}
              required
              value={width}
              set={setWidth}
              facetValues={facets.widths}
              placeholder={tr("Scegli")}
            />
            <Select
              label={tr("Spalla")}
              required
              value={aspect}
              set={setAspect}
              facetValues={facets.aspectRatios}
              placeholder={tr("Scegli")}
            />
            <Select
              label={tr("Cerchio")}
              required
              value={rim}
              set={setRim}
              facetValues={facets.rims}
              placeholder={tr("Scegli")}
            />

            <Field label={tr("Stagione")}>
              <select value={season} onChange={(e) => setSeason(e.target.value)} className={CONTROL}>
                <option value="">{tr("Tutte")}</option>
                <option value="summer">{tr("Estive")}</option>
                <option value="winter">{tr("Invernali")}</option>
                <option value="all_season">{tr("4 stagioni")}</option>
              </select>
            </Field>

            {/*
              A selection, not free text. The brands come from the same
              dependent facet query as the sizes, so every option here is a
              brand that actually exists in the current selection — a typed
              name never matched anything and simply emptied the results.
            */}
            <Select
              label={tr("Marca")}
              value={brand}
              set={setBrand}
              facetValues={facets.brands}
              placeholder={tr("Tutte")}
            />

            <Field label={tr("Ordina per")}>
              <select value={sort} onChange={(e) => setSort(e.target.value)} className={CONTROL}>
                <option value="price_asc">{tr("Prezzo più basso")}</option>
                <option value="brand_asc">{tr("Marca A–Z")}</option>
              </select>
            </Field>

            {/*
              Premium / Fascia media / Economiche appear only once an APPROVED
              brand classification exists. Three filters that all return nothing
              would read as an empty catalogue instead of an unset business rule.
            */}
            {tiersConfigured && (
              <Field label={tr("Fascia")}>
                <select value={tier} onChange={(e) => setTier(e.target.value)} className={CONTROL}>
                  <option value="">{tr("Tutte")}</option>
                  {BRAND_TIER_LABELS.map((x) => (
                    <option key={x.tier} value={x.tier}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          {hasFilters && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={reset}
                className="text-xs font-semibold text-ink-soft underline hover:text-ink"
              >
                {tr("Azzera i filtri")}
              </button>
            </div>
          )}
        </div>
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

      {toast && <AddedToast key={toast.id} tyre={toast.tyre} tr={tr} />}
    </div>
  );
}

type Tr = (text: string) => string;

/** Shared control styling, so every field in the bar is the same object. */
const CONTROL =
  "mt-1 h-11 w-full rounded-xl border border-ink/15 bg-white px-2.5 text-sm font-normal text-ink";

/**
 * Confirms an add where the customer is already looking, then gets out of the
 * way.
 *
 * `role="status"` rather than an alert: it is a confirmation, not a problem,
 * and a screen reader should hear it after the current phrase rather than
 * interrupting. It is announced once and removed on a timer, so nothing
 * accumulates in the corner of a long browse.
 */
function AddedToast({ tyre, tr }: { tyre: string; tr: Tr }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      <div className="gr-toast pointer-events-auto flex max-w-full items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-modal">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-state-success">
          <CartIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold">{tr("Aggiunto al carrello")}</span>
          {tyre && <span className="block truncate text-xs text-white/70">{tyre}</span>}
        </span>
        <Link
          href="/account/basket"
          className="ml-1 shrink-0 rounded-lg px-2 py-1 text-sm font-bold text-white underline underline-offset-2"
        >
          {tr("Vai al carrello")}
        </Link>
      </div>
    </div>
  );
}

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
    <article
      className={`rounded-2xl bg-white p-5 shadow-card transition-shadow ${
        added ? "ring-2 ring-state-success" : ""
      }`}
    >
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
          {/*
            The confirmed state is a DIFFERENT button, not a recoloured one:
            green ground, a tick and a changed word. The previous cue was a
            switch to the secondary variant, which on a white card is close
            enough to the resting state to be missed entirely — which is how
            "I added it and nothing happened" survived the first fix.
          */}
          <button
            type="button"
            disabled={!offer.priceAvailable}
            onClick={() => onAdd(offer)}
            className={`mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:bg-ink/10 disabled:text-ink/40 ${
              added
                ? "bg-state-success text-white"
                : "bg-gr-accent text-white shadow-cta hover:bg-gr-accent-hover"
            }`}
          >
            {added ? (
              <>
                <CheckIcon className="h-4 w-4" />
                {tr("Aggiunto")}
              </>
            ) : (
              <>
                <CartIcon className="h-4 w-4" />
                {tr("Aggiungi")}
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
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

/**
 * One labelled control in the filter bar.
 *
 * The label sits ABOVE the field in small caps rather than beside it, so seven
 * controls fit on one line at a readable size and each one still says what it
 * is. Wrapping the control in the <label> keeps them associated without an id.
 */
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] font-bold uppercase tracking-wide text-ink-soft">
        {label}
        {required && <span className="ml-0.5 text-state-danger">*</span>}
      </span>
      {children}
    </label>
  );
}

function Select({
  label,
  required,
  value,
  set,
  facetValues,
  placeholder,
}: {
  label: string;
  required?: boolean;
  value: string;
  set: (v: string) => void;
  facetValues: (number | string)[];
  placeholder: string;
}) {
  /*
    THE LIST DOES NOT MOVE WHILE THE CUSTOMER IS IN IT.

    REGRESSION: "the dropdowns reset as I browse through them."

    Every keystroke or selection starts a debounced request, and its response
    rewrites all four facet lists. If that response lands while a dropdown is
    OPEN, the browser is rebuilding the options of a live popup — and Chrome,
    Safari and Firefox all close it. From the customer's side the list they
    were scrolling vanishes and the field looks like it reset.

    So the list is frozen for as long as the control has focus: whatever was
    on screen when it was opened stays on screen until the customer picks
    something or leaves. Released on change and on blur, so the next
    interaction gets the current, correctly narrowed facets.

    This is a display freeze only. `facetValues` keeps arriving and the applied
    filter is untouched — nothing here can change what is being searched for.
  */
  const [frozen, setFrozen] = useState<(number | string)[] | null>(null);
  const values = frozen ?? facetValues;

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
    <Field label={label} required={required}>
      <select
        value={value}
        onFocus={() => setFrozen(facetValues)}
        onBlur={() => setFrozen(null)}
        onChange={(e) => {
          setFrozen(null);
          set(e.target.value);
        }}
        className={CONTROL}
      >
        <option value="">{placeholder}</option>
        {missing && <option value={value}>{value}</option>}
        {options.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </Field>
  );
}

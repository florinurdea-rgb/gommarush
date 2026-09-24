"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import {
  CommerceAllSeasonIcon,
  CommerceCartIcon,
  CommerceCheckIcon,
  CommerceSnowflakeIcon,
  CommerceSunIcon,
  CommerceTruckIcon,
} from "@/components/customer/CommerceIcons";
import { QuantityStepper } from "@/components/customer/QuantityStepper";
import { addBasketLine, basketQuantity, BASKET_CHANGED_EVENT } from "@/lib/customer/basket";
import { BRAND_TIER_LABELS } from "@/lib/catalogue/brand-tiers";
import { catalogueViewState, sameValues, shouldQueryCatalogue } from "@/lib/customer/catalogue-view";
import { useTr } from "@/lib/i18n/tr";

/**
 * The customer tyre search.
 *
 * THE SIZE LISTS ARE GIVEN, NOT FETCHED. `widths`, `aspectRatios` and `rims`
 * arrive as props, resolved on the server and rendered with the page, and they
 * are the WHOLE unfiltered set the catalogue holds. They do not change while
 * the customer is here — not when a rim is picked, not when results load,
 * never. See src/lib/server/catalogue-dimensions.ts for why that is both the
 * fast answer and the stable one.
 *
 * DELIBERATE, NOT EAGER. Nothing is requested until width, aspect ratio and
 * rim are all chosen. A tyre shop buys a size; a catalogue that dumps
 * thousands of unrelated tyres on arrival is slower to use, not faster, and it
 * is also the one query shape the global sort has to refuse. This used to be
 * impossible to enforce here, because suppressing the request also suppressed
 * the facets that filled the selectors — with the lists handed in as props
 * that deadlock cannot exist, so the gate is back where it belongs. The route
 * applies the same rule independently.
 *
 * NEVER FROZEN. Every fetch swaps the results for skeleton cards of the same
 * shape while the controls stay usable. A stale list sitting under a new
 * filter is worse than a placeholder, because it looks like an answer.
 *
 * A SIZE WITH NO TYRES IS REACHABLE, and answered plainly. That is the
 * deliberate cost of lists that never narrow, and a better screen than a
 * dimension the customer cannot select and cannot explain the absence of.
 *
 * WHAT THE PRICE BLOCK SHOWS — OWNER DECISION, 2026-09-24. A result shows the
 * GommaRush selling price and the PFU amount, and nothing else: no VAT line,
 * no VAT-inclusive total, and no estimate wording on the PFU. A tyre shop
 * scanning fifty rows is comparing net prices, and four figures per row to
 * compare one of them is noise. VAT and the full total appear in the basket,
 * where the customer is committing rather than browsing.
 *
 * PRESENTATION ONLY. `pfuEstimated` and `pfuEstimateVersion` are untouched on
 * the wire and in every snapshot, the estimate disclosure still appears in the
 * basket and at checkout, and nothing about PFU provenance or auditability
 * changes because of what this screen chooses to draw.
 *
 * IT OPENS ON A SELECTION WHEN ASKED TO. "Vedi alternative" on an unavailable
 * basket line links here with that tyre's size in the query string, and the
 * screen must arrive already showing those results — a link that lands on
 * "choose a size" has sent the customer back to the beginning of the job they
 * were already halfway through.
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
type Refusal = { reason: string; matched: number; maximum: number };

const PAGE_SIZE = 24;
const NO_BRANDS: string[] = [];

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

export function CustomerCatalogue({
  widths,
  aspectRatios,
  rims,
}: {
  widths: number[];
  aspectRatios: number[];
  rims: number[];
}) {
  const tr = useTr();
  const [offers, setOffers] = useState<Offer[]>([]);
  /** The only list that still comes from a response — see the note on Select. */
  const [brands, setBrands] = useState<string[]>(NO_BRANDS);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [refused, setRefused] = useState<Refusal | null>(null);
  const [tiersConfigured, setTiersConfigured] = useState(false);
  const [deliveryDays, setDeliveryDays] = useState(7);

  /*
    INITIAL SELECTION FROM THE URL.

    Read once, as the initial state of each control, and never again: these
    are `useState` initialisers, not an effect that writes back on every
    render. An effect would fight the customer — every change they made would
    be overwritten by the query string that is still in the address bar.

    Only the size and season are honoured, which is exactly what
    alternativesHref puts there. Anything else in the query string is ignored
    rather than trusted, so a hand-written URL cannot drive this screen into a
    state the controls cannot represent.
  */
  const searchParams = useSearchParams();
  const initial = (key: string) => searchParams?.get(key)?.trim() ?? "";
  const initialNumber = (key: string) => {
    const raw = initial(key);
    return /^\d{1,4}$/.test(raw) ? raw : "";
  };

  const [width, setWidth] = useState(() => initialNumber("width"));
  const [aspect, setAspect] = useState(() => initialNumber("aspect"));
  const [rim, setRim] = useState(() => initialNumber("rim"));
  const [season, setSeason] = useState(() =>
    ["summer", "winter", "all_season"].includes(initial("season")) ? initial("season") : ""
  );
  const [brand, setBrand] = useState("");
  const [tier, setTier] = useState("");
  const [sort, setSort] = useState("price_asc");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dimensions = { widthMm: width, aspectRatio: aspect, rimInch: rim };
  const canQuery = shouldQueryCatalogue(dimensions);

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
    /*
      NOTHING IS REQUESTED UNTIL THE SIZE IS COMPLETE.

      Safe to enforce here now. The selectors are filled from props, so an
      unmade request no longer starves them of the values needed to make one —
      which is exactly the deadlock that forced the previous version to fetch
      on every render whether it could use the answer or not.

      The results panel shows the "choose a size" instruction in this state,
      never a spinner: nothing is loading, so a spinner would be a lie.
    */
    if (!canQuery) {
      setLoading(false);
      setOffers([]);
      setTotal(0);
      setRefused(null);
      return;
    }

    const controller = new AbortController();
    // Debounced, and the loading state is set immediately — before the
    // debounce — so the results panel reacts to the change even though the
    // request has not left yet.
    setLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const qs = `${filters}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
        const r = await fetch(`/api/account/catalogue?${qs}`, { signal: controller.signal });
        const j = await r.json();
        if (!r.ok) throw new Error();
        setOffers(j.offers ?? []);
        setTotal(j.total ?? 0);
        setRefused(j.refused ?? null);
        setTiersConfigured(j.tiersConfigured === true);
        // Kept as the SAME array when the values match, so an identical
        // response cannot re-create the options of a brand list the customer
        // may have open. See sameValues.
        setBrands((current) =>
          sameValues(current, j.facets?.brands) ? current : (j.facets?.brands ?? NO_BRANDS)
        );
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
  }, [filters, page, canQuery]);

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
  const [toast, setToast] = useState<{ id: number; tyre: string; quantity: number } | null>(null);

  /**
   * Per-result quantity, before it is committed to the basket.
   *
   * Lives here rather than in each card so the number survives the card
   * re-rendering when a response lands, and so "Aggiungi" adds what the
   * customer set rather than one at a time.
   */
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const quantityOf = (key: string) => quantities[key] ?? 1;
  const setQuantity = (key: string, quantity: number) =>
    setQuantities((current) => ({ ...current, [key]: quantity }));

  const add = useCallback(
    (o: Offer, quantity: number) => {
      const key = `${o.tyre.productId}-${o.tyre.oldDot ? "old" : "new"}`;
      // ONE operation, not `quantity` of them: the store merges by
      // product+condition, so adding 4 is a single write and a single event.
      if (addBasketLine(o.tyre.productId, o.tyre.oldDot, quantity)) {
        setAddError(null);
        setAdded(key);
        const id = Date.now();
        setToast({
          id,
          tyre: [o.tyre.brand, o.tyre.modelPattern, o.tyre.sizeDisplay].filter(Boolean).join(" "),
          quantity,
        });
        window.setTimeout(() => setAdded((current) => (current === key ? null : current)), CONFIRMATION_MS);
        window.setTimeout(
          () => setToast((current) => (current?.id === id ? null : current)),
          CONFIRMATION_MS
        );
        // Reset to 1 so the next add from the same card is not a surprise.
        setQuantity(key, 1);
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

  /** Clears every selection, including the size, and empties the results. */
  function reset() {
    setWidth("");
    setAspect("");
    setRim("");
    setSeason("");
    setBrand("");
    setTier("");
    setBrands(NO_BRANDS);
    setError(null);
  }

  /** Clears only the secondary filters, keeping the size. */
  function resetExtraFilters() {
    setSeason("");
    setBrand("");
    setTier("");
  }

  const hasSelection = Boolean(width || aspect || rim || season || brand || tier);
  const hasExtraFilters = Boolean(season || brand || tier);

  const basketCount = useBasketCount();

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
          {tr("Catalogo pneumatici")}
        </h1>
        {view === "results" && total > 0 && (
          <span className="text-sm font-semibold text-ink-soft">
            {total} {tr("pneumatici disponibili")}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {tr("Scegli la misura per vedere i pneumatici disponibili e il prezzo GommaRush.")}
      </p>

      {/*
        THE SEARCH BAR.

        PRIMARY IS THE SIZE. Width, aspect and rim sit together in their own
        row, visually separated from everything else, because that is the one
        thing a tyre shop always knows and the one thing without which this
        screen cannot answer. Season, brand and sort are secondary and are
        drawn as such.

        Sticky, because a customer comparing tyres scrolls and a filter bar
        that scrolls away turns every adjustment into a trip back to the top.
        It sits below the shell header, which is itself sticky at `top-0`.
      */}
      <div className="sticky top-[57px] z-30 -mx-4 mt-4 border-b border-ink/10 bg-surface-soft/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:top-[65px] sm:px-6">
        <div className="rounded-2xl border border-ink/10 bg-white p-3 shadow-sm">
          <p className="sr-only">
            {tr("Larghezza, spalla e cerchio sono obbligatori per vedere i risultati.")}
          </p>

          {/* PRIMARY — the size. Three equal columns at every width. */}
          <div className="grid grid-cols-3 gap-2">
            <Select
              label={tr("Larghezza")}
              required
              value={width}
              set={setWidth}
              facetValues={widths}
              placeholder={tr("Scegli")}
            />
            <Select
              label={tr("Spalla")}
              required
              value={aspect}
              set={setAspect}
              facetValues={aspectRatios}
              placeholder={tr("Scegli")}
            />
            <Select
              label={tr("Cerchio")}
              required
              value={rim}
              set={setRim}
              facetValues={rims}
              placeholder={tr("Scegli")}
            />
          </div>

          {/* SECONDARY — season, brand, sort. Quieter, and on their own row. */}
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-ink/10 pt-2 sm:grid-cols-3">
            <Field label={tr("Stagione")}>
              <select value={season} onChange={(e) => setSeason(e.target.value)} className={CONTROL}>
                <option value="">{tr("Tutte")}</option>
                <option value="summer">{tr("Estive")}</option>
                <option value="winter">{tr("Invernali")}</option>
                <option value="all_season">{tr("4 stagioni")}</option>
              </select>
            </Field>

            {/*
              Filled from the same request as the results, so every option is a
              brand that exists in the chosen size. Empty until a size is
              picked, because a brand list over the whole catalogue is a scan
              this screen was rebuilt to avoid.
            */}
            <Select
              label={tr("Marca")}
              value={brand}
              set={setBrand}
              facetValues={brands}
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

            {hasSelection && (
              <div className="col-span-2 flex justify-end sm:col-span-3">
                <button
                  type="button"
                  onClick={reset}
                  className="min-h-[36px] text-xs font-bold text-ink-soft underline underline-offset-2 hover:text-ink"
                >
                  {tr("Azzera")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {addError && (
        <p role="alert" className="mt-4 rounded-xl border border-state-danger/30 bg-state-danger-soft p-4 text-sm text-state-danger">
          {addError}
        </p>
      )}

      {/*
        THE RESULTS REGION. Every state of the search renders here and nowhere
        else, so the panel the customer is reading is always the answer to the
        selection currently in the bar above it.
      */}
      <div className="mt-5" aria-live="polite" aria-busy={loading}>
        {view === "awaiting_dimensions" ? (
          <PromptForSize tr={tr} />
        ) : view === "loading" ? (
          <ResultsSkeleton tr={tr} />
        ) : view === "error" ? (
          <p className="rounded-2xl border border-state-danger/30 bg-state-danger-soft p-4 text-state-danger">
            {error}
          </p>
        ) : view === "refused" ? (
          <p className="rounded-2xl border border-ink/10 bg-white p-5 text-sm text-ink-soft">
            {tr("La selezione è troppo ampia per essere ordinata correttamente.")}{" "}
            {refused?.matched} {tr("pneumatici")}. {tr("Aggiungi un filtro per restringere la ricerca.")}
          </p>
        ) : offers.length === 0 ? (
          <NoResults
            tr={tr}
            hasExtraFilters={hasExtraFilters}
            onClearExtraFilters={resetExtraFilters}
            onReset={reset}
          />
        ) : (
          <>
            <div className="space-y-2">
              {offers.map((o) => {
                const key = `${o.tyre.productId}-${o.tyre.oldDot ? "old" : "new"}`;
                return (
                  <OfferCard
                    key={key}
                    offer={o}
                    deliveryDays={deliveryDays}
                    quantity={quantityOf(key)}
                    onQuantityChange={(q) => setQuantity(key, q)}
                    onAdd={add}
                    added={added === key}
                    tr={tr}
                  />
                );
              })}
            </div>

            {total > PAGE_SIZE && (
              <nav className="mt-5 flex items-center justify-between gap-4" aria-label={tr("Paginazione")}>
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

      {toast && <AddedToast key={toast.id} tyre={toast.tyre} quantity={toast.quantity} tr={tr} />}
      {basketCount > 0 && <StickyBasketBar count={basketCount} tr={tr} />}
    </div>
  );
}

type Tr = (text: string) => string;

/** Shared control styling, so every field in the bar is the same object. */
const CONTROL =
  "mt-1 h-11 w-full rounded-xl border border-ink/15 bg-white px-2.5 text-sm font-semibold text-ink";

/**
 * The basket count, live, for the sticky bar.
 *
 * Same three listeners the navigation uses: the basket's own event, `storage`
 * for another tab, and focus for a tab that changed while hidden. Zero until
 * mount, because the basket lives in the browser and a server-rendered count
 * would be a hydration mismatch.
 */
function useBasketCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sync = () => setCount(basketQuantity());
    sync();
    window.addEventListener(BASKET_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(BASKET_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  return count;
}

/**
 * The persistent route to the basket once there is something in it.
 *
 * COUNT AND NAVIGATION, NO TOTAL. A grand total here would be computed from
 * whatever the catalogue happened to show, before any fulfilment check and
 * before VAT — a number that then changes the moment the basket opens. Showing
 * it would be worse than showing nothing, because it would look like a quote.
 *
 * On a phone it sits above the navigation bar and clears the home indicator;
 * above `md` the header already carries a basket link with the same count, so
 * this stays out of the way.
 */
function StickyBasketBar({ count, tr }: { count: number; tr: Tr }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 px-3 pb-2 md:hidden">
      <Link
        href="/account/basket"
        className="mx-auto flex min-h-[52px] max-w-content items-center justify-between gap-3 rounded-2xl bg-ink px-4 text-white shadow-modal"
      >
        <span className="flex items-center gap-2 text-sm font-bold">
          <CommerceCartIcon className="h-5 w-5" />
          {count} {count === 1 ? tr("pneumatico") : tr("pneumatici")}
        </span>
        <span className="text-sm font-bold underline underline-offset-2">{tr("Vai al carrello")}</span>
      </Link>
    </div>
  );
}

function TyreIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="24" cy="24" r="19" />
      <circle cx="24" cy="24" r="10.5" />
      <circle cx="24" cy="24" r="3.5" />
      <path d="M24 5v8.5M24 34.5V43M5 24h8.5M34.5 24H43" />
    </svg>
  );
}

/**
 * No tyre in this size.
 *
 * A real answer, not a failure. The size lists are the whole catalogue and do
 * not narrow, so a combination with nothing behind it IS selectable — this is
 * the screen that makes that honest, and it offers the two ways out: drop the
 * extra filters, or start the size again.
 */
function NoResults({
  tr,
  hasExtraFilters,
  onClearExtraFilters,
  onReset,
}: {
  tr: Tr;
  hasExtraFilters: boolean;
  onClearExtraFilters: () => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/20 bg-white/60 p-10 text-center">
      <TyreIcon className="mx-auto h-14 w-14 text-ink/25" />
      <p className="mt-4 font-bold text-ink">{tr("Nessun pneumatico per questa misura")}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
        {hasExtraFilters
          ? tr("Prova a rimuovere stagione, marca o fascia, oppure scegli un'altra misura.")
          : tr("Prova un'altra misura. Se ti serve questa, contattaci e la cerchiamo per te.")}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {hasExtraFilters && (
          <Button size="md" variant="secondary" onClick={onClearExtraFilters}>
            {tr("Rimuovi i filtri")}
          </Button>
        )}
        <Button size="md" variant="secondary" onClick={onReset}>
          {tr("Azzera")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Confirms an add where the customer is already looking, then gets out of the
 * way.
 *
 * `role="status"` rather than an alert: it is a confirmation, not a problem,
 * and a screen reader should hear it after the current phrase rather than
 * interrupting. It is announced once and removed on a timer, so nothing
 * accumulates in the corner of a long browse.
 */
function AddedToast({ tyre, quantity, tr }: { tyre: string; quantity: number; tr: Tr }) {
  return (
    <div
      role="status"
      aria-live="polite"
      /*
        Above the phone navigation AND the sticky basket bar that sits on top
        of it, so a confirmation never lands under the two things it is telling
        the customer to use. On desktop neither exists, so it returns to the
        bottom of the viewport.
      */
      className="pointer-events-none fixed inset-x-0 bottom-[calc(116px+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-4"
    >
      <div className="gr-toast pointer-events-auto flex max-w-full items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-modal">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-state-success">
          <CommerceCartIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold">
            {quantity} × {tr("Aggiunto al carrello")}
          </span>
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

/** Season pill, drawn with the approved seasonal marks. */
const SEASON_ICONS: Record<string, (props: { className?: string }) => JSX.Element> = {
  summer: CommerceSunIcon,
  winter: CommerceSnowflakeIcon,
  all_season: CommerceAllSeasonIcon,
};

/**
 * One result.
 *
 * MOBILE IS NOT THE DESKTOP ROW SQUEEZED. Under `sm` the card stacks: identity
 * first, then the price block, then a full-width action row with the stepper
 * and Aggiungi side by side and both at 44px. From `sm` it becomes a single
 * scanning row — identity left, price right, action right — so a shop can run
 * down fifty of them and add from several without the eye leaving one column.
 *
 * ONLY WHAT THE PROJECTION ACTUALLY CARRIES is drawn: brand, model, size,
 * load/speed, season, XL, run-flat, older DOT, availability, price, PFU and
 * the GommaRush delivery promise. There is no photograph, no brand mark and no
 * label value, because the catalogue holds none of those and inventing one
 * would be inventing a product claim.
 */
function OfferCard({
  offer,
  deliveryDays,
  quantity,
  onQuantityChange,
  onAdd,
  added,
  tr,
}: {
  offer: Offer;
  deliveryDays: number;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  onAdd: (o: Offer, quantity: number) => void;
  added: boolean;
  tr: Tr;
}) {
  const t = offer.tyre;
  const loadSpeed = t.loadSpeedRaw ?? [t.loadIndex, t.speedRating].filter(Boolean).join("");
  const SeasonIcon = t.season ? SEASON_ICONS[t.season] : undefined;
  const name = [t.brand, t.modelPattern].filter(Boolean).join(" ");

  return (
    <article
      className={`rounded-2xl border bg-white p-3 transition-colors sm:p-4 ${
        added ? "border-state-success" : "border-ink/10"
      }`}
    >
      <div className="sm:flex sm:items-center sm:gap-4">
        {/* ---- IDENTITY ------------------------------------------------ */}
        <div className="min-w-0 sm:flex-1">
          <div className="truncate text-[15px] font-extrabold text-ink">
            {name || tr("Marca non indicata")}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-ink-soft">
            {t.sizeDisplay ?? tr("Misura non indicata")}
            {loadSpeed ? ` · ${loadSpeed}` : ""}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {t.season && SEASON_LABELS[t.season] && (
              <Tag>
                {SeasonIcon && <SeasonIcon className="h-3.5 w-3.5" />}
                {tr(SEASON_LABELS[t.season])}
              </Tag>
            )}
            {t.xl && <Tag>XL</Tag>}
            {t.runFlat && <Tag>Run-flat</Tag>}
            {t.oldDot && <Tag>{tr("DOT precedente")}</Tag>}
            <Tag>{tr(AVAILABILITY_LABELS[offer.availability])}</Tag>
          </div>
        </div>

        {/* ---- PRICE ---------------------------------------------------
            Selling price and PFU. No VAT line and no VAT-inclusive total:
            owner decision, recorded at the top of this file. Nothing about
            PFU provenance changes — this is what is drawn, not what is held.
        */}
        <div className="mt-3 flex items-end justify-between gap-4 border-t border-ink/10 pt-3 sm:mt-0 sm:block sm:w-auto sm:flex-none sm:border-0 sm:pt-0 sm:text-right">
          <div>
            <div className="text-lg font-extrabold leading-none text-ink">
              {money(offer.tyreSaleNetCents)}{" "}
              <span className="text-xs font-semibold text-ink-soft">{tr("netto")}</span>
            </div>
            <div className="mt-1 text-xs font-semibold text-ink-soft">
              {tr("PFU")} {money(offer.pfuAmountCents)}
            </div>
            <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-state-success sm:justify-end">
              <CommerceTruckIcon className="h-3.5 w-3.5" />
              {tr("Consegna entro")} {deliveryDays} {tr("giorni")}
            </div>
          </div>
        </div>

        {/* ---- ACTION --------------------------------------------------- */}
        <div className="mt-3 flex items-center gap-2 sm:mt-0 sm:flex-none">
          <QuantityStepper
            value={quantity}
            onChange={onQuantityChange}
            disabled={!offer.priceAvailable}
            label={`${tr("Quantità")} ${name} ${t.sizeDisplay ?? ""}`.trim()}
          />
          <button
            type="button"
            disabled={!offer.priceAvailable}
            onClick={() => onAdd(offer, quantity)}
            className={`inline-flex h-11 min-w-[7rem] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:bg-ink/10 disabled:text-ink/40 sm:flex-none ${
              added ? "bg-state-success text-white" : "bg-accent text-white hover:bg-accent-dark"
            }`}
          >
            {added ? (
              <>
                <CommerceCheckIcon className="h-4 w-4" />
                {tr("Aggiunto")}
              </>
            ) : (
              <>
                <CommerceCartIcon className="h-4 w-4" />
                {tr("Aggiungi")}
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-soft px-2 py-0.5 text-[11px] font-bold text-ink-soft">
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

/**
 * Placeholders of the same shape as the cards they replace.
 *
 * Inside the results region, never over the filter bar: the controls stay
 * usable while tyres load, and the customer can see exactly which part of the
 * screen is waiting.
 */
function ResultsSkeleton({ tr }: { tr: Tr }) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink-soft">{tr("Ricerca pneumatici in corso…")}</p>
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

    A response landing while a dropdown is OPEN rewrites its options, and every
    browser closes a popup whose options are rebuilt underneath it. The list
    being scrolled vanished and the field looked like it had reset.

    The three size lists can no longer do this at all: they are props, fixed
    for the life of the page. This freeze is what protects the one list that is
    still fetched — the brands in the chosen size — and it costs nothing for
    the constant ones.

    Frozen for as long as the control has focus; released on change and on
    blur, so the next interaction gets the current list. A display freeze only:
    `facetValues` keeps arriving and the applied filter is untouched, so
    nothing here can change what is being searched for.
  */
  const [frozen, setFrozen] = useState<(number | string)[] | null>(null);
  const values = frozen ?? facetValues;

  /*
    THE APPLIED VALUE IS ALWAYS AN OPTION.

    A <select> whose value matches no <option> renders BLANK while the filter
    is still in force: the control says "nothing selected" and the results
    disagree. That cannot arise from narrowing any more, but it still can from
    a brand that leaves the list when the size changes, and from a value
    restored before its list has arrived.
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

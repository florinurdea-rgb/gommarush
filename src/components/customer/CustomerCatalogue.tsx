"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { CartIcon } from "@/components/customer/CartIcon";
import { addBasketLine } from "@/lib/customer/basket";
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
  // Both literals appear in the source, so Tailwind's scanner emits both.
  const columns = tiersConfigured ? "lg:grid-cols-8" : "lg:grid-cols-7";

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

            <Field label={tr("Stagione")}>
              <select value={season} onChange={(e) => setSeason(e.target.value)} className={CONTROL}>
                <option value="">{tr("Tutte")}</option>
                <option value="summer">{tr("Estive")}</option>
                <option value="winter">{tr("Invernali")}</option>
                <option value="all_season">{tr("4 stagioni")}</option>
              </select>
            </Field>

            {/*
              The one list still read from a response, and the only one worth
              narrowing: "which brands exist in 205/55 R16" is a useful
              question. Empty until a size is chosen, because a brand list over
              the whole catalogue is the scan this screen was rebuilt to avoid.
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

            {/*
              Always in the bar, in its own column, so the row does not reflow
              the moment something is selected and the button is where the
              customer last saw it. Disabled rather than hidden when there is
              nothing to clear.
            */}
            <div className="flex flex-col justify-end">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-transparent" aria-hidden="true">
                .
              </span>
              <button
                type="button"
                onClick={reset}
                disabled={!hasSelection}
                className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-2 text-sm font-bold text-ink-soft transition-colors hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:border-ink/10 disabled:text-ink/30"
              >
                {tr("Azzera")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {addError && (
        <p role="alert" className="mt-4 rounded-xl bg-state-danger-soft p-4 text-sm text-state-danger">
          {addError}
        </p>
      )}

      {/*
        THE RESULTS REGION. Every state of the search renders here and nowhere
        else, so the panel the customer is reading is always the answer to the
        selection currently in the bar above it.
      */}
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
        ) : offers.length === 0 ? (
          <NoResults
            tr={tr}
            hasExtraFilters={hasExtraFilters}
            onClearExtraFilters={resetExtraFilters}
            onReset={reset}
          />
        ) : (
          <>
            <p className="text-sm text-ink-soft">
              {`${total} ${tr("pneumatici disponibili")}`}
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
 * A tyre, for the empty result.
 *
 * Carcass, rim and hub. An empty panel of text reads as a page that failed;
 * a drawing of the thing that is missing reads as an answer to the question
 * that was asked.
 */
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

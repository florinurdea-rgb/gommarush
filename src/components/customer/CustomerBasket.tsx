"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { CommerceCartIcon, CommerceTruckIcon, CommerceWarningIcon } from "@/components/customer/CommerceIcons";
import { LineAvailability, type LineState } from "@/components/customer/LineAvailability";
import { QuantityStepper } from "@/components/customer/QuantityStepper";
import { readBasket, writeBasket, type StoredBasketLine } from "@/lib/customer/basket";
import { useTr } from "@/lib/i18n/tr";

/**
 * The customer basket.
 *
 * THE ONE THING THIS SCREEN MUST GET RIGHT: a customer must never mistake a
 * provisional figure for the amount they will be invoiced. Since the owner's
 * 2026-09-23 decision the PFU is a TEMPORARY ESTIMATE, so a total does exist —
 * and it can move. The summary is therefore labelled and carries the estimate
 * disclosure inline, at the exact place the number is read.
 *
 * THIS IS WHERE VAT APPEARS. The catalogue shows the selling price and the PFU
 * and stops there, deliberately; a customer browsing fifty rows is comparing
 * net prices. Here they are committing, so the full chain is shown:
 * Pneumatici → PFU → IVA → Totale.
 *
 * THE BROWSER IS NOT AUTHORITATIVE FOR ANYTHING. It stores product id,
 * condition and quantity; every price, fulfilment state, tax position and
 * total on this screen came back from the server, which re-resolved all of
 * them. A quantity change re-asks rather than recalculating locally.
 *
 * NO SUPPLIER CALL HERE (owner decision, 2026-09-26). A quantity change
 * re-asks the preview route, which re-prices from current catalogue data; the
 * live supplier check runs once, at final order confirmation.
 */

type PreviewLine = {
  productId: string;
  oldDot: boolean;
  quantity: number;
  tyre: {
    brand: string | null;
    modelPattern: string | null;
    sizeDisplay: string | null;
    loadSpeedRaw: string | null;
    season: string | null;
    widthMm: number | null;
    aspectRatio: number | null;
    rimInch: number | null;
  } | null;
  availability: string;
  state: LineState;
  availableQuantity: number | null;
  unavailableReason: string | null;
  unitTyreNetCents: number | null;
  pfuStatus: string;
  unitVatCents: number | null;
  unitTotalCents: number | null;
};

type Preview = {
  lines: PreviewLine[];
  currency: string;
  tyreNetTotalCents: number;
  pfuTotalCents: number | null;
  vatTotalCents: number | null;
  grandTotalCents: number | null;
  monetaryStatus: string;
  vatRatePercent: number;
  pfuInVatBase: boolean;
  pfuEstimated: boolean;
  pfuEstimateVersion: string | null;
  orderable: boolean;
  fulfilment: { class: string; maxDays: number };
};

const money = (c: number | null, fallback = "—") =>
  c === null ? fallback : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100);

const SEASON_LABELS: Record<string, string> = {
  summer: "Estive",
  winter: "Invernali",
  all_season: "4 stagioni",
};

/**
 * How long typing settles before a validation is asked for.
 *
 * Within the 400–600ms the brief specifies. A press of +/- does not wait: the
 * customer has finished expressing the change, and a delay there reads as lag.
 */
const TYPING_DEBOUNCE_MS = 500;

const lineKey = (line: { productId: string; oldDot: boolean }) =>
  `${line.productId}:${line.oldDot ? "1" : "0"}`;

export function CustomerBasket() {
  const tr = useTr();
  const [stored, setStored] = useState<StoredBasketLine[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounce = useRef<number | null>(null);
  const request = useRef(0);

  const load = useCallback(
    async (lines: StoredBasketLine[]) => {
      if (!lines.length) {
        setPreview(null);
        setBusy(false);
        return;
      }
      const ticket = ++request.current;
      setBusy(true);
      setError(null);
      try {
        const r = await fetch("/api/account/basket/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lines }),
        });
        const j = await r.json();
        // A superseded response must not overwrite a newer one.
        if (ticket !== request.current) return;
        if (!r.ok) throw new Error(j.code);
        setPreview(j.basket);
      } catch {
        if (ticket !== request.current) return;
        // A line running short is not an error — the server reports it on the
        // line itself. Anything reaching here is a genuine request failure, so
        // the basket stays exactly as the customer left it.
        setError(tr("Impossibile aggiornare il carrello. Riprova."));
      } finally {
        if (ticket === request.current) setBusy(false);
      }
    },
    [tr]
  );

  useEffect(() => {
    const lines = readBasket();
    setStored(lines);
    void load(lines);
  }, [load]);

  /**
   * Writes the new quantity, then re-validates.
   *
   * The write happens FIRST and unconditionally, so the basket survives a
   * failed or slow validation, a navigation away, or a closed tab. `immediate`
   * separates a +/- press from typing.
   */
  const changeQuantity = useCallback(
    (line: StoredBasketLine, quantity: number, immediate: boolean) => {
      const next = stored
        .map((x) =>
          x.productId === line.productId && x.oldDot === line.oldDot ? { ...x, quantity } : x
        )
        .filter((x) => x.quantity > 0);

      setStored(next);
      if (!writeBasket(next)) {
        setError(tr("Impossibile salvare il carrello: il browser blocca l'archiviazione locale."));
        return;
      }

      // Re-priced from catalogue data only: no supplier call happens here.
      if (debounce.current !== null) window.clearTimeout(debounce.current);
      if (immediate) {
        void load(next);
      } else {
        debounce.current = window.setTimeout(() => void load(next), TYPING_DEBOUNCE_MS);
      }
    },
    [stored, load, tr]
  );

  const remove = (line: StoredBasketLine) => changeQuantity(line, 0, true);

  if (busy && !preview && !stored.length) {
    return (
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">{tr("Carrello")}</h1>
        <BasketSkeleton />
      </div>
    );
  }

  if (!stored.length) {
    return (
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">{tr("Carrello")}</h1>
        <div className="mt-6 rounded-2xl border border-dashed border-ink/20 bg-white p-10 text-center">
          <CommerceCartIcon className="mx-auto h-12 w-12 text-ink/20" />
          <p className="mt-4 font-bold text-ink">{tr("Il carrello è vuoto.")}</p>
          <Link
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-5 text-sm font-bold text-white"
            href="/account/catalogue"
          >
            {tr("Vai al catalogo")}
          </Link>
        </div>
      </div>
    );
  }

  const complete = preview?.monetaryStatus === "complete";
  /*
    TWO SEPARATE CONDITIONS, deliberately not merged.

    `complete` is about MONEY — can a final total be produced at all.
    `orderable` is about FULFILMENT — can every line actually be supplied as
    asked. A basket can be one without the other, and the customer needs to be
    told which of the two is stopping them.
  */
  const orderable = preview?.orderable === true;
  const blocked = preview?.lines.filter((l) => l.state !== "available") ?? [];

  return (
    <div aria-busy={busy}>
      <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">{tr("Carrello")}</h1>

      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-state-danger/30 bg-state-danger-soft p-4">
          <p className="text-sm font-semibold text-state-danger">{error}</p>
          {/* The basket itself is safe in the browser; only the check failed. */}
          <Button className="mt-3" size="md" variant="secondary" disabled={busy} onClick={() => void load(stored)}>
            {tr("Riprova")}
          </Button>
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.7fr_1fr] lg:items-start">
        <div className="space-y-2">
          {preview?.lines.map((line) => {
            const s = stored.find((x) => x.productId === line.productId && x.oldDot === line.oldDot);
            if (!s) return null;
            const key = lineKey(line);
            const name = [line.tyre?.brand, line.tyre?.modelPattern].filter(Boolean).join(" ");
            return (
              <div key={key} className="rounded-2xl border border-ink/10 bg-white p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-extrabold text-ink">
                      {name || tr("Articolo non disponibile")}
                    </div>
                    <div className="mt-0.5 text-sm font-semibold text-ink-soft">
                      {line.tyre?.sizeDisplay ?? ""}
                      {line.tyre?.loadSpeedRaw ? ` · ${line.tyre.loadSpeedRaw}` : ""}
                      {line.tyre?.season && SEASON_LABELS[line.tyre.season]
                        ? ` · ${tr(SEASON_LABELS[line.tyre.season])}`
                        : ""}
                      {line.oldDot ? ` · ${tr("DOT precedente")}` : ""}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-ink-soft">
                      {money(line.unitTyreNetCents)} {tr("netto / pz")}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-extrabold text-ink">
                      {money(
                        line.unitTyreNetCents === null ? null : line.unitTyreNetCents * s.quantity
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <QuantityStepper
                    value={s.quantity}
                    label={`${tr("Quantità")} ${name}`.trim()}
                    /* Typing: debounced. +/-: immediate — the customer has
                       finished expressing the change. */
                    onChange={(q) => changeQuantity(s, q, false)}
                    onCommit={(q) => changeQuantity(s, q, true)}
                  />
                  <button
                    type="button"
                    className="min-h-[44px] px-2 text-sm font-semibold text-ink-soft underline underline-offset-2 hover:text-ink"
                    onClick={() => remove(s)}
                  >
                    {tr("Rimuovi")}
                  </button>
                </div>

                <LineAvailability
                  state={line.state}
                  availableQuantity={line.availableQuantity}
                  unavailableReason={line.unavailableReason}
                  requestedQuantity={s.quantity}
                  tyre={line.tyre}
                  onAcceptAvailable={(q) => changeQuantity(s, q, true)}
                  busy={busy}
                  tr={tr}
                />
              </div>
            );
          })}
        </div>

        {preview && (
          <section className="rounded-2xl border border-ink/10 bg-white p-4 lg:sticky lg:top-24">
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft">
              {tr("Riepilogo")}
            </h2>

            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">{tr("Pneumatici")}</dt>
                <dd className="font-semibold text-ink">{money(preview.tyreNetTotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">
                  {tr("PFU")}
                  {preview.pfuEstimated && <span aria-hidden="true"> *</span>}
                </dt>
                <dd className={`font-semibold ${preview.pfuTotalCents === null ? "text-state-warning" : "text-ink"}`}>
                  {money(preview.pfuTotalCents, tr("Da confermare"))}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">
                  {tr("IVA")} {preview.vatRatePercent}%
                </dt>
                <dd className={`font-semibold ${preview.vatTotalCents === null ? "text-state-warning" : "text-ink"}`}>
                  {money(preview.vatTotalCents, tr("Da confermare"))}
                </dd>
              </div>
            </dl>

            <div className="mt-3 flex items-baseline justify-between border-t border-ink/10 pt-3">
              <span className="text-sm font-bold text-ink">
                {preview.pfuEstimated ? tr("Totale stimato") : tr("Totale da pagare")}
              </span>
              {complete && orderable ? (
                <strong className="text-xl font-extrabold text-ink">
                  {money(preview.grandTotalCents)}
                </strong>
              ) : (
                <strong className="text-sm text-state-warning">{tr("Non ancora disponibile")}</strong>
              )}
            </div>

            {/*
              THE DISCLOSURE, at the exact place the number is read rather than
              in a footnote further down the page.
            */}
            {complete && orderable && preview.pfuEstimated && (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
                * {tr("PFU stimato — l'importo definitivo può variare.")}
              </p>
            )}

            {!complete && (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
                {tr(
                  "Il totale finale non è ancora disponibile. L'importo indicato sopra è il valore dei pneumatici, non la cifra che sarà fatturata."
                )}
              </p>
            )}

            <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-state-success">
              <CommerceTruckIcon className="h-4 w-4" />
              {tr("Consegna entro")} {preview.fulfilment.maxDays} {tr("giorni")} ·{" "}
              {tr("inclusa nel prezzo")}
            </p>

            {blocked.length > 0 && (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-state-danger/30 bg-state-danger-soft p-3 text-xs text-ink">
                <CommerceWarningIcon className="mt-0.5 h-4 w-4 flex-none text-state-danger" />
                <span>
                  {blocked.length === 1
                    ? tr("Un articolo del carrello non è disponibile nella quantità richiesta.")
                    : `${blocked.length} ${tr("articoli del carrello non sono disponibili nella quantità richiesta.")}`}{" "}
                  {tr("Aggiorna o rimuovi gli articoli segnalati per continuare.")}
                </span>
              </p>
            )}

            <Button
              className="mt-4 w-full"
              size="lg"
              disabled={!complete || !orderable || busy}
              onClick={() => {
                window.location.href = "/account/checkout";
              }}
            >
              {tr("Procedi all'ordine")}
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}

function BasketSkeleton() {
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[1.7fr_1fr] lg:items-start">
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border border-ink/10 bg-white p-4">
            <div className="flex justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-5 w-44 animate-pulse rounded bg-ink/10" />
                <div className="h-4 w-32 animate-pulse rounded bg-ink/10" />
              </div>
              <div className="h-5 w-20 animate-pulse rounded bg-ink/10" />
            </div>
            <div className="mt-3 h-10 w-36 animate-pulse rounded-xl bg-ink/10" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-ink/10 bg-white p-4">
        <div className="space-y-3">
          <div className="h-4 w-24 animate-pulse rounded bg-ink/10" />
          <div className="h-5 w-full animate-pulse rounded bg-ink/10" />
          <div className="h-5 w-full animate-pulse rounded bg-ink/10" />
          <div className="h-14 w-full animate-pulse rounded-xl bg-ink/10" />
        </div>
      </div>
    </div>
  );
}

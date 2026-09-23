"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { readBasket, writeBasket, type StoredBasketLine } from "@/lib/customer/basket";

/**
 * The customer basket.
 *
 * THE ONE THING THIS SCREEN MUST GET RIGHT: a customer must never mistake the
 * tyre value for the amount they will be invoiced. While the PFU tariff is
 * unresolved the two are different, and the difference is not a rounding
 * detail — it is a levy plus the VAT on it. So the summary is split into two
 * visually distinct blocks: what is KNOWN, and what the FINAL TOTAL will be
 * once PFU is confirmed. The final block shows no number at all rather than a
 * number with a caveat next to it.
 *
 * The browser is not authoritative for anything. It stores product id,
 * condition and quantity; every price, availability, tax position and total on
 * this screen came back from /api/account/basket/preview, which re-resolved all
 * of them server-side.
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
  };
  availability: string;
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
  fulfilment: { class: string; maxDays: number };
};

const money = (c: number | null) =>
  c === null
    ? "Da confermare"
    : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100);

const SEASON_LABELS: Record<string, string> = {
  summer: "Estive",
  winter: "Invernali",
  all_season: "4 stagioni",
};

const LOAD_ERRORS: Record<string, string> = {
  BASKET_ITEM_UNAVAILABLE: "Uno o più articoli non sono più disponibili. Aggiorna il carrello.",
  BASKET_QUANTITY_UNAVAILABLE:
    "La quantità richiesta non è più disponibile. Riduci la quantità di uno o più articoli.",
};

export function CustomerBasket() {
  const [stored, setStored] = useState<StoredBasketLine[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (lines: StoredBasketLine[]) => {
    setStored(lines);
    if (!lines.length) {
      setPreview(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/account/basket/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.code);
      setPreview(j.basket);
    } catch (e) {
      setError(
        LOAD_ERRORS[e instanceof Error ? e.message : ""] ??
          "Impossibile aggiornare il carrello. Riprova."
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(readBasket());
  }, [load]);

  function setQuantity(line: StoredBasketLine, q: number) {
    const next = stored
      .map((x) => (x.productId === line.productId && x.oldDot === line.oldDot ? { ...x, quantity: q } : x))
      .filter((x) => x.quantity > 0);
    writeBasket(next);
    void load(next);
  }

  if (busy && !preview) {
    return (
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Carrello</h1>
        <BasketSkeleton />
      </div>
    );
  }

  if (!stored.length) {
    return (
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Carrello</h1>
        <div className="mt-6 rounded-2xl bg-white p-8 text-center shadow-card">
          <p className="text-ink-soft">Il carrello è vuoto.</p>
          <Link className="mt-4 inline-block font-semibold text-accent underline" href="/account/catalogue">
            Vai al catalogo
          </Link>
        </div>
      </div>
    );
  }

  const complete = preview?.monetaryStatus === "complete";

  return (
    <div aria-busy={busy}>
      <h1 className="text-2xl font-extrabold text-ink">Carrello</h1>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-state-danger-soft p-4 text-state-danger">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <div className="space-y-3">
          {preview?.lines.map((line) => {
            const s = stored.find((x) => x.productId === line.productId && x.oldDot === line.oldDot);
            if (!s) return null;
            return (
              <div
                key={`${line.productId}-${line.oldDot}`}
                className="rounded-2xl bg-white p-5 shadow-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-ink">
                      {line.tyre.brand} {line.tyre.modelPattern}
                    </div>
                    <div className="mt-1 text-sm text-ink-soft">
                      {line.tyre.sizeDisplay}
                      {line.tyre.loadSpeedRaw ? ` · ${line.tyre.loadSpeedRaw}` : ""}
                      {line.tyre.season && SEASON_LABELS[line.tyre.season]
                        ? ` · ${SEASON_LABELS[line.tyre.season]}`
                        : ""}
                      {line.oldDot ? " · DOT precedente" : ""}
                    </div>
                    <div className="mt-2 text-sm text-ink-soft">
                      {money(line.unitTyreNetCents)} <span className="text-xs">netto / pz</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="sr-only" htmlFor={`qty-${line.productId}-${line.oldDot}`}>
                      Quantità
                    </label>
                    <input
                      id={`qty-${line.productId}-${line.oldDot}`}
                      className="h-11 w-20 rounded-lg border border-ink/15 px-2"
                      type="number"
                      min="1"
                      max="100"
                      value={line.quantity}
                      disabled={busy}
                      onChange={(e) =>
                        setQuantity(s, Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                      }
                    />
                    <div className="w-28 text-right font-bold">
                      {money(
                        line.unitTyreNetCents === null ? null : line.unitTyreNetCents * line.quantity
                      )}
                    </div>
                    <button
                      className="text-sm text-ink-soft underline hover:text-ink"
                      disabled={busy}
                      onClick={() => setQuantity(s, 0)}
                    >
                      Rimuovi
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {preview && (
          <section className="rounded-2xl bg-white p-5 shadow-card lg:sticky lg:top-6">
            {/* ---- KNOWN ------------------------------------------------ */}
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft">
              Valore pneumatici
            </h2>
            <div className="mt-3 flex justify-between text-sm">
              <span>Imponibile pneumatici</span>
              <strong>{money(preview.tyreNetTotalCents)}</strong>
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              Consegna entro {preview.fulfilment.maxDays} giorni · inclusa nel prezzo
            </p>

            {/* ---- OUTSTANDING ------------------------------------------ */}
            <div className="mt-5 border-t border-ink/10 pt-4">
              <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                Da aggiungere
              </h2>
              <div className="mt-3 flex justify-between text-sm">
                <span>PFU</span>
                <strong className={preview.pfuTotalCents === null ? "text-state-warning" : ""}>
                  {money(preview.pfuTotalCents)}
                </strong>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span>IVA {preview.vatRatePercent}%</span>
                <strong className={preview.vatTotalCents === null ? "text-state-warning" : ""}>
                  {money(preview.vatTotalCents)}
                </strong>
              </div>
              {preview.pfuInVatBase && (
                <p className="mt-2 text-xs text-ink-soft">
                  L&apos;IVA al {preview.vatRatePercent}% si applica a pneumatici + PFU.
                </p>
              )}
            </div>

            {/* ---- FINAL ------------------------------------------------ */}
            <div
              className={`mt-5 rounded-xl border-2 p-4 ${
                complete ? "border-accent/30 bg-accent-light/40" : "border-state-warning/40 bg-state-warning-soft"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-bold text-ink">Totale da pagare</span>
                {complete ? (
                  <strong className="text-lg">{money(preview.grandTotalCents)}</strong>
                ) : (
                  <strong className="text-sm text-state-warning">Non ancora disponibile</strong>
                )}
              </div>
              {!complete && (
                <p className="mt-2 text-xs leading-relaxed text-ink">
                  Il totale finale non può essere calcolato perché la tariffa PFU non è ancora
                  confermata. L&apos;importo indicato sopra è il <strong>valore dei pneumatici</strong>,
                  non la cifra che sarà fatturata.
                </p>
              )}
            </div>

            <Button
              className="mt-5 w-full"
              disabled={!complete || busy}
              onClick={() => {
                window.location.href = "/account/checkout";
              }}
            >
              Procedi all&apos;ordine
            </Button>
            {!complete && (
              <p className="mt-2 text-center text-xs text-ink-soft">
                L&apos;ordine si potrà inviare quando il PFU sarà confermato.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function BasketSkeleton() {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-start">
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl bg-white p-5 shadow-card">
            <div className="flex justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-5 w-44 animate-pulse rounded bg-ink/10" />
                <div className="h-4 w-32 animate-pulse rounded bg-ink/10" />
              </div>
              <div className="h-11 w-20 animate-pulse rounded-lg bg-ink/10" />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl bg-white p-5 shadow-card">
        <div className="space-y-3">
          <div className="h-4 w-32 animate-pulse rounded bg-ink/10" />
          <div className="h-5 w-full animate-pulse rounded bg-ink/10" />
          <div className="h-5 w-full animate-pulse rounded bg-ink/10" />
          <div className="h-16 w-full animate-pulse rounded-xl bg-ink/10" />
        </div>
      </div>
      <span className="sr-only">Aggiornamento prezzi e disponibilità…</span>
    </div>
  );
}

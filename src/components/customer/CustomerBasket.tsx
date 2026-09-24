"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { LineAvailability, type LineState, type VerifiedSource } from "@/components/customer/LineAvailability";
import { readBasket, writeBasket, type StoredBasketLine } from "@/lib/customer/basket";
import { useTr } from "@/lib/i18n/tr";

/**
 * The customer basket.
 *
 * THE ONE THING THIS SCREEN MUST GET RIGHT: a customer must never mistake a
 * provisional figure for the amount they will be invoiced.
 *
 * Since the owner's 2026-09-23 decision the PFU is a TEMPORARY ESTIMATE, so a
 * total does exist — and it can move. The summary is therefore split into the
 * settled tyre value, the levies on top of it, and a total block that is
 * labelled "Totale stimato" and carries the estimate disclosure inline, at the
 * exact place the number is read rather than in a footnote.
 *
 * If the PFU ever becomes unresolvable again, the total block shows no number
 * at all rather than a number with a caveat beside it.
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
    widthMm: number | null;
    aspectRatio: number | null;
    rimInch: number | null;
  } | null;
  availability: string;
  /** The per-line verdict. See src/lib/server/customer-basket.ts. */
  state: LineState;
  availableQuantity: number | null;
  unavailableReason: string | null;
  verifiedSource: VerifiedSource;
  verifiedAt: string | null;
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
  /** False when any line is unavailable or short. The single checkout gate. */
  orderable: boolean;
  verifiedSource: VerifiedSource;
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

export function CustomerBasket() {
  const tr = useTr();
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
    } catch {
      // A line running short is no longer an error — the server reports it on
      // the line itself. Anything that reaches here is a genuine failure of
      // the request, so the basket stays exactly as the customer left it.
      setError(tr("Impossibile aggiornare il carrello. Riprova."));
    } finally {
      setBusy(false);
    }
  }, [tr]);

  useEffect(() => {
    void load(readBasket());
  }, [load]);

  function setQuantity(line: StoredBasketLine, q: number) {
    const next = stored
      .map((x) => (x.productId === line.productId && x.oldDot === line.oldDot ? { ...x, quantity: q } : x))
      .filter((x) => x.quantity > 0);

    if (!writeBasket(next)) {
      setError(tr("Impossibile salvare il carrello: il browser blocca l'archiviazione locale."));
      return;
    }
    void load(next);
  }

  if (busy && !preview) {
    return (
      <div>
        <h1 className="text-2xl font-extrabold text-ink">{tr("Carrello")}</h1>
        <BasketSkeleton />
      </div>
    );
  }

  if (!stored.length) {
    return (
      <div>
        <h1 className="text-2xl font-extrabold text-ink">{tr("Carrello")}</h1>
        <div className="mt-6 rounded-2xl bg-white p-8 text-center shadow-card">
          <p className="text-ink-soft">{tr("Il carrello è vuoto.")}</p>
          <Link className="mt-4 inline-block font-semibold text-accent underline" href="/account/catalogue">
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
    `orderable` is about STOCK — can every line actually be supplied as asked.
    A basket can be one without the other, and the customer needs to be told
    which of the two is stopping them.
  */
  const orderable = preview?.orderable === true;
  const blockedLines = preview?.lines.filter((l) => l.state !== "available") ?? [];

  return (
    <div aria-busy={busy}>
      <h1 className="text-2xl font-extrabold text-ink">{tr("Carrello")}</h1>

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
                      {line.tyre?.brand ?? tr("Articolo non disponibile")} {line.tyre?.modelPattern ?? ""}
                    </div>
                    <div className="mt-1 text-sm text-ink-soft">
                      {line.tyre?.sizeDisplay ?? ""}
                      {line.tyre?.loadSpeedRaw ? ` · ${line.tyre.loadSpeedRaw}` : ""}
                      {line.tyre?.season && SEASON_LABELS[line.tyre.season]
                        ? ` · ${SEASON_LABELS[line.tyre.season]}`
                        : ""}
                      {line.oldDot ? ` · ${tr("DOT precedente")}` : ""}
                    </div>
                    <div className="mt-2 text-sm text-ink-soft">
                      {money(line.unitTyreNetCents)} <span className="text-xs">{tr("netto / pz")}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="sr-only" htmlFor={`qty-${line.productId}-${line.oldDot}`}>
                      {tr("Quantità")}
                    </label>
                    <input
                      id={`qty-${line.productId}-${line.oldDot}`}
                      className="h-11 w-20 rounded-lg border border-ink/15 px-2"
                      type="number"
                      min="1"
                      max="100"
                      /*
                        Driven by the LOCAL basket, not by `line` from the
                        server preview. Bound to the preview, the box ignored
                        what was typed until the round trip returned and then
                        snapped back to the old number — a controlled input
                        that appears not to accept input.
                      */
                      value={s.quantity}
                      disabled={busy}
                      onChange={(e) =>
                        setQuantity(s, Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                      }
                    />
                    <div className="w-28 text-right font-bold">
                      {money(
                        line.unitTyreNetCents === null ? null : line.unitTyreNetCents * s.quantity
                      )}
                    </div>
                    <button
                      className="text-sm text-ink-soft underline hover:text-ink"
                      disabled={busy}
                      onClick={() => setQuantity(s, 0)}
                    >
                      {tr("Rimuovi")}
                    </button>
                  </div>
                </div>

                {/*
                  THE PER-LINE VERDICT. Previously a short line failed the
                  whole request and the customer got a banner naming no tyre;
                  now the tyre that is short says so itself, next to the
                  quantity box that caused it.
                */}
                <LineAvailability
                  state={line.state}
                  availableQuantity={line.availableQuantity}
                  unavailableReason={line.unavailableReason}
                  requestedQuantity={s.quantity}
                  verifiedSource={line.verifiedSource}
                  verifiedAt={line.verifiedAt}
                  tyre={line.tyre}
                  onAcceptAvailable={(q) => setQuantity(s, q)}
                  busy={busy}
                  tr={tr}
                />
              </div>
            );
          })}
        </div>

        {preview && (
          <section className="rounded-2xl bg-white p-5 shadow-card lg:sticky lg:top-6">
            {/* ---- THE TYRE VALUE, which is settled --------------------- */}
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft">
              {tr("Valore pneumatici")}
            </h2>
            <div className="mt-3 flex justify-between text-sm">
              <span>{tr("Imponibile pneumatici")}</span>
              <strong>{money(preview.tyreNetTotalCents)}</strong>
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              {tr("Consegna entro")} {preview.fulfilment.maxDays} {tr("giorni")} ·{" "}
              {tr("inclusa nel prezzo")}
            </p>

            {/* ---- LEVIES AND TAX -------------------------------------- */}
            <div className="mt-5 border-t border-ink/10 pt-4">
              <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                {tr("Imposte e contributi")}
              </h2>
              <div className="mt-3 flex justify-between text-sm">
                <span>
                  {preview.pfuEstimated ? tr("PFU stimato") : tr("PFU")}
                  {preview.pfuEstimated && <span aria-hidden="true"> *</span>}
                </span>
                <strong className={preview.pfuTotalCents === null ? "text-state-warning" : ""}>
                  {money(preview.pfuTotalCents)}
                </strong>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span>
                  {tr("IVA")} {preview.vatRatePercent}%
                </span>
                <strong className={preview.vatTotalCents === null ? "text-state-warning" : ""}>
                  {money(preview.vatTotalCents)}
                </strong>
              </div>
              {preview.pfuInVatBase && (
                <p className="mt-2 text-xs text-ink-soft">
                  {tr("L'IVA si applica a pneumatici + PFU.")}
                </p>
              )}
            </div>

            {/* ---- THE TOTAL ------------------------------------------- */}
            <div
              className={`mt-5 rounded-xl border-2 p-4 ${
                !complete
                  ? "border-state-warning/40 bg-state-warning-soft"
                  : preview.pfuEstimated
                    ? "border-state-warning/40 bg-state-warning-soft"
                    : "border-accent/30 bg-accent-light/40"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-bold text-ink">
                  {preview.pfuEstimated ? tr("Totale stimato") : tr("Totale da pagare")}
                </span>
                {complete ? (
                  <strong className="text-lg">{money(preview.grandTotalCents)}</strong>
                ) : (
                  <strong className="text-sm text-state-warning">
                    {tr("Non ancora disponibile")}
                  </strong>
                )}
              </div>

              {/*
                THE DISCLOSURE. A total built on an estimated levy is labelled
                as estimated at the exact place the customer reads the number,
                not in a footnote further down the page.
              */}
              {complete && preview.pfuEstimated && (
                <p className="mt-2 text-xs leading-relaxed text-ink">
                  * {tr("PFU stimato — l'importo definitivo può variare.")}{" "}
                  {tr(
                    "Il PFU indicato è una stima. L'importo definitivo può variare e sarà confermato da GommaRush."
                  )}
                </p>
              )}

              {!complete && (
                <p className="mt-2 text-xs leading-relaxed text-ink">
                  {tr(
                    "Il totale finale non è ancora disponibile. L'importo indicato sopra è il valore dei pneumatici, non la cifra che sarà fatturata."
                  )}
                </p>
              )}
            </div>

            {blockedLines.length > 0 && (
              <p className="mt-5 rounded-xl border border-state-danger/30 bg-state-danger-soft p-3 text-xs text-ink">
                {blockedLines.length === 1
                  ? tr("Un articolo del carrello non è disponibile nella quantità richiesta.")
                  : `${blockedLines.length} ${tr("articoli del carrello non sono disponibili nella quantità richiesta.")}`}{" "}
                {tr("Aggiorna o rimuovi gli articoli segnalati per continuare.")}
              </p>
            )}

            <Button
              className="mt-5 w-full"
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

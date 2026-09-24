"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { LineAvailability, type LineState, type VerifiedSource } from "@/components/customer/LineAvailability";
import { readBasket, writeBasket } from "@/lib/customer/basket";
import { formatSalesOrderNumber } from "@/lib/commerce/order-number";
import { useTr } from "@/lib/i18n/tr";

/**
 * Checkout.
 *
 * The customer chooses a GommaRush SERVICE — where it goes, how fast, how they
 * pay. They never choose a supplier, and no screen here mentions one.
 *
 * THREE GATES, and all three are enforced on the server as well as here:
 *
 *   MONEY        the basket must be monetarily complete. While the PFU tariff
 *                is unresolved that never happens, and this screen says so
 *                plainly instead of offering a button that fails.
 *   STOCK        every line must be available in the quantity asked for.
 *   PRICE        the order carries the total the customer accepted, and the
 *                server refuses to create it at any other figure.
 *
 * THE LIVE SUPPLIER CHECK HAPPENS ON SUBMIT, not here. Pressing the button
 * asks Inter-Sprint for the real quantity behind every line it can (protocol
 * 103, read-only), and the order is created in the same request if nothing
 * moved. If something did move, the request comes back refused WITH the
 * recomputed basket, this screen redraws with the new truth, and the customer
 * confirms again against what is now on the page. That second press is not
 * friction for its own sake: it is the difference between a customer agreeing
 * to a price and a customer being charged one.
 */

type Location = {
  id: string;
  location_name: string | null;
  address_line1: string;
  city: string;
  postal_code: string | null;
  is_primary: boolean;
};

type Line = {
  productId: string;
  oldDot: boolean;
  quantity: number;
  tyre: {
    brand: string | null;
    modelPattern: string | null;
    sizeDisplay: string | null;
    widthMm: number | null;
    aspectRatio: number | null;
    rimInch: number | null;
    season: string | null;
  } | null;
  state: LineState;
  availableQuantity: number | null;
  unavailableReason: string | null;
  verifiedSource: VerifiedSource;
  verifiedAt: string | null;
  unitTyreNetCents: number | null;
  unitTotalCents: number | null;
};

type Basket = {
  lines: Line[];
  grandTotalCents: number | null;
  monetaryStatus: string;
  orderable: boolean;
  pfuEstimated: boolean;
  verifiedSource: VerifiedSource;
};

/** V1 payment methods, owner-confirmed. POS on delivery is not among them. */
const PAYMENT_OPTIONS = [
  { value: "bank_transfer", label: "Bonifico bancario", hint: "Coordinate inviate con la conferma" },
  { value: "cash_on_delivery", label: "Contanti alla consegna", hint: "Pagamento al momento della consegna" },
] as const;

const FULFILMENT_OPTIONS = [
  { value: "standard", label: "Standard · consegna entro 7 giorni" },
  { value: "express", label: "Express · 24–48h, su verifica" },
] as const;

// Codes the API is willing to return. Anything else is deliberately generic:
// the server logs the detail and does not send it to the customer.
const ORDER_ERRORS: Record<string, string> = {
  PRICING_NOT_FINAL: "Il totale finale non è ancora confermato, quindi l'ordine non può essere inviato.",
  BASKET_ITEM_UNAVAILABLE: "Uno o più articoli non sono più disponibili. Aggiorna il carrello.",
  BASKET_QUANTITY_UNAVAILABLE: "La quantità richiesta non è più disponibile. Riduci la quantità.",
  DELIVERY_ADDRESS_INVALID: "L'indirizzo di consegna selezionato non è valido.",
  CUSTOMER_NOT_FOUND: "Account non abilitato. Contatta GommaRush.",
};

const money = (c: number | null) =>
  c === null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100);

export function CustomerCheckout({ locations }: { locations: Location[] }) {
  const tr = useTr();
  const router = useRouter();
  const [locationId, setLocationId] = useState(
    locations.find((x) => x.is_primary)?.id ?? locations[0]?.id ?? ""
  );
  const [paymentMethod, setPayment] = useState<string>(PAYMENT_OPTIONS[0].value);
  const [fulfilmentClass, setFulfilment] = useState<string>(FULFILMENT_OPTIONS[0].value);
  const [note, setNote] = useState("");

  // Generated once per mount and reused by every retry of this same order, so a
  // second click cannot create a second order.
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [checking, setChecking] = useState(true);
  const [basket, setBasket] = useState<Basket | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  /**
   * The total the customer has seen and is confirming.
   *
   * Sent with the order and checked by the server. When a submit comes back
   * refused because the price moved, this is deliberately NOT updated until
   * the customer has been shown the change — that is what makes the second
   * press an agreement rather than a formality.
   */
  const [acceptedTotalCents, setAcceptedTotal] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<{ from: number; to: number | null } | null>(null);

  const verify = useCallback(async () => {
    setChecking(true);
    const lines = readBasket();
    if (!lines.length) {
      router.replace("/account/basket");
      return;
    }
    try {
      const r = await fetch("/api/account/basket/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      const j = await r.json();
      if (!r.ok) {
        setBlockedReason(tr(ORDER_ERRORS[j.code] ?? "Impossibile verificare il carrello."));
        setBasket(null);
        return;
      }
      setBasket(j.basket);
      setAcceptedTotal(j.basket?.grandTotalCents ?? null);
      setPriceChange(null);
      setBlockedReason(
        j.basket?.monetaryStatus === "complete"
          ? null
          : tr(
              "Il totale finale è in attesa della conferma della tariffa PFU. L'ordine non può ancora essere inviato."
            )
      );
    } catch {
      setBlockedReason(tr("Impossibile verificare il carrello."));
      setBasket(null);
    } finally {
      setChecking(false);
    }
  }, [router, tr]);

  /*
    The idempotency key is generated ONCE per visit to this screen, in its own
    effect with no dependencies.

    It used to sit in the verify effect, whose callback identity changes with
    the locale. Switching language — or anything else that re-created `verify`
    — minted a NEW key, and a retry after a failed submit would then be treated
    as a different order rather than the same one. The key's whole job is to be
    the same across retries of one order, and that now includes the retry after
    a price change: the customer confirming a new total is still the SAME
    order, so it deliberately survives that round trip too.
  */
  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  useEffect(() => {
    void verify();
  }, [verify]);

  async function submit() {
    if (acceptedTotalCents === null) return;
    setBusy(true);
    setError(null);
    const submittedTotal = acceptedTotalCents;
    try {
      const r = await fetch("/api/account/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: readBasket(),
          locationId,
          paymentMethod,
          fulfilmentClass,
          note,
          idempotencyKey,
          acceptedTotalCents: submittedTotal,
        }),
      });
      const j = await r.json();

      if (!r.ok) {
        /*
          A refusal carries the recomputed basket. Redraw with it rather than
          sending the customer back to reload: the availability and the prices
          in that payload are the result of the live check that just ran, and
          they are newer than anything this screen currently shows.
        */
        if (j.basket) {
          setBasket(j.basket);
          if (j.code === "PRICE_CHANGED") {
            setPriceChange({ from: submittedTotal, to: j.basket.grandTotalCents ?? null });
            setAcceptedTotal(j.basket.grandTotalCents ?? null);
          }
        }
        throw new Error(j.code);
      }

      writeBasket([]);
      // The allocated order number travels to the confirmation, so the customer
      // sees the same GR-…  reference the operator sees, immediately.
      const reference = formatSalesOrderNumber(j.order?.order_number);
      router.replace(reference ? `/account/orders?created=${encodeURIComponent(reference)}` : "/account/orders");
      router.refresh();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      // PRICE_CHANGED and BASKET_NOT_ORDERABLE are explained by the panels
      // below, which now carry the new figures. A second banner repeating it
      // in worse words would only compete with them.
      if (code !== "PRICE_CHANGED" && code !== "BASKET_NOT_ORDERABLE") {
        setError(tr(ORDER_ERRORS[code] ?? "Ordine non inviato. Riprova."));
      }
      setBusy(false);
    }
  }

  const complete = basket?.monetaryStatus === "complete";
  const orderable = basket?.orderable === true;
  const blockedLines = basket?.lines.filter((l) => l.state !== "available") ?? [];

  const canSubmit =
    complete &&
    orderable &&
    acceptedTotalCents !== null &&
    !!locationId &&
    !!idempotencyKey &&
    !busy &&
    !checking;

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-ink">{tr("Conferma ordine")}</h1>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow-card">
          <h2 className="font-bold text-ink">{tr("Consegna")}</h2>
          {locations.length === 0 ? (
            <p className="mt-3 text-sm text-state-danger">
              {tr("Nessun indirizzo di consegna valido configurato. Contatta GommaRush per aggiungerne uno.")}
            </p>
          ) : (
            <>
              <label className="sr-only" htmlFor="checkout-location">
                {tr("Indirizzo di consegna")}
              </label>
              <select
                id="checkout-location"
                className="mt-3 h-11 w-full rounded-xl border border-ink/15 px-3"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {locations.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.location_name || x.city} — {x.address_line1}, {x.city}
                  </option>
                ))}
              </select>
            </>
          )}

          <h2 className="mt-6 font-bold text-ink">{tr("Servizio")}</h2>
          <label className="sr-only" htmlFor="checkout-fulfilment">
            {tr("Servizio di consegna")}
          </label>
          <select
            id="checkout-fulfilment"
            className="mt-3 h-11 w-full rounded-xl border border-ink/15 px-3"
            value={fulfilmentClass}
            onChange={(e) => setFulfilment(e.target.value)}
          >
            {FULFILMENT_OPTIONS.map((x) => (
              <option key={x.value} value={x.value}>
                {tr(x.label)}
              </option>
            ))}
          </select>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-card">
          <h2 className="font-bold text-ink">{tr("Pagamento")}</h2>
          <fieldset className="mt-3 space-y-2">
            <legend className="sr-only">{tr("Metodo di pagamento")}</legend>
            {PAYMENT_OPTIONS.map((x) => (
              <label
                key={x.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                  paymentMethod === x.value ? "border-accent bg-accent-light/30" : "border-ink/15"
                }`}
              >
                <input
                  type="radio"
                  name="payment-method"
                  className="mt-1"
                  value={x.value}
                  checked={paymentMethod === x.value}
                  onChange={() => setPayment(x.value)}
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">{tr(x.label)}</span>
                  <span className="block text-xs text-ink-soft">{tr(x.hint)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="mt-5 block text-sm font-semibold text-ink">
            {tr("Note")}
            <textarea
              className="mt-2 min-h-24 w-full rounded-xl border border-ink/15 p-3 font-normal"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </section>
      </div>

      {/* ---- WHAT IS BEING ORDERED, with each line's availability ------- */}
      {basket && (
        <section className="mt-5 rounded-2xl bg-white p-5 shadow-card">
          <h2 className="font-bold text-ink">{tr("Articoli")}</h2>
          <div className="mt-3 space-y-3">
            {basket.lines.map((line) => (
              <div
                key={`${line.productId}-${line.oldDot}`}
                className="border-b border-ink/10 pb-3 last:border-0 last:pb-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">
                      {line.tyre?.brand ?? tr("Articolo non disponibile")} {line.tyre?.modelPattern ?? ""}
                    </div>
                    <div className="text-sm text-ink-soft">
                      {line.tyre?.sizeDisplay ?? ""} · {line.quantity} {tr("pz")}
                    </div>
                  </div>
                  <strong>
                    {money(
                      line.unitTotalCents === null ? null : line.unitTotalCents * line.quantity
                    )}
                  </strong>
                </div>
                {/*
                  Quantities are not editable here on purpose: the basket is
                  where a basket is changed. What this screen must do is say
                  exactly which line is blocking the order, and give the same
                  two ways out the basket gives.
                */}
                <LineAvailability
                  state={line.state}
                  availableQuantity={line.availableQuantity}
                  unavailableReason={line.unavailableReason}
                  requestedQuantity={line.quantity}
                  verifiedSource={line.verifiedSource}
                  verifiedAt={line.verifiedAt}
                  tyre={line.tyre}
                  onAcceptAvailable={null}
                  tr={tr}
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-baseline justify-between border-t border-ink/10 pt-4">
            <span className="text-sm font-bold text-ink">
              {basket.pfuEstimated ? tr("Totale stimato") : tr("Totale da pagare")}
            </span>
            <strong className="text-lg">{money(basket.grandTotalCents)}</strong>
          </div>
        </section>
      )}

      {/* ---- THE PRICE MOVED, and the customer has to see it ------------ */}
      {priceChange && (
        <div
          role="alert"
          className="mt-5 rounded-2xl border-2 border-state-warning/50 bg-state-warning-soft p-4"
        >
          <p className="font-bold text-ink">{tr("Il prezzo è cambiato")}</p>
          <p className="mt-1 text-sm text-ink">
            {tr("Al momento della conferma il totale era")} <strong>{money(priceChange.from)}</strong>.{" "}
            {tr("Il prezzo aggiornato dal fornitore è")} <strong>{money(priceChange.to)}</strong>.{" "}
            {tr("Nessun ordine è stato creato. Conferma di nuovo per procedere al nuovo importo.")}
          </p>
        </div>
      )}

      {/* ---- A LINE CANNOT BE SUPPLIED --------------------------------- */}
      {!checking && basket && !orderable && (
        <div className="mt-5 rounded-2xl border border-state-danger/30 bg-state-danger-soft p-4">
          <p className="font-bold text-state-danger">
            {blockedLines.length === 1
              ? tr("Un articolo non è disponibile nella quantità richiesta.")
              : `${blockedLines.length} ${tr("articoli non sono disponibili nella quantità richiesta.")}`}
          </p>
          <p className="mt-1 text-sm text-ink">
            {tr("Torna al carrello per aggiornare le quantità o scegliere un'alternativa.")}
          </p>
          <a
            href="/account/basket"
            className="mt-3 inline-flex min-h-[40px] items-center justify-center rounded-xl bg-ink px-4 text-sm font-bold text-white"
          >
            {tr("Torna al carrello")}
          </a>
        </div>
      )}

      {checking && (
        <p className="mt-5 rounded-xl bg-white p-4 text-sm text-ink-soft shadow-card" aria-live="polite">
          {tr("Verifica di prezzi e disponibilità in corso…")}
        </p>
      )}

      {!checking && !blockedReason && (
        <p className="mt-5 rounded-xl border border-state-warning/40 bg-state-warning-soft p-4 text-sm text-ink">
          {tr("PFU stimato — l'importo definitivo può variare.")}{" "}
          {tr(
            "Il PFU indicato è una stima. L'importo definitivo può variare e sarà confermato da GommaRush."
          )}
        </p>
      )}

      {!checking && blockedReason && (
        <p className="mt-5 rounded-xl border border-state-warning/40 bg-state-warning-soft p-4 text-sm text-ink">
          {blockedReason}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-5 rounded-xl bg-state-danger-soft p-4 text-sm text-state-danger">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end">
        <Button size="lg" disabled={!canSubmit} onClick={submit}>
          {busy ? tr("Verifica con il fornitore…") : tr("Invia ordine a GommaRush")}
        </Button>
      </div>
      <p className="mt-2 text-right text-xs text-ink-soft">
        {tr("Disponibilità e prezzo vengono verificati con il fornitore alla conferma.")}{" "}
        {tr(
          "L'ordine viene inviato a GommaRush per conferma manuale. Non viene inoltrato automaticamente a un fornitore."
        )}
      </p>
    </div>
  );
}

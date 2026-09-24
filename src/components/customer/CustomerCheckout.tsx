"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import {
  CommerceCartIcon,
  CommerceLocationIcon,
  CommerceTruckIcon,
  CommerceWarningIcon,
} from "@/components/customer/CommerceIcons";
import { LineAvailability, type LineState, type VerifiedSource } from "@/components/customer/LineAvailability";
import { QuantityStepper } from "@/components/customer/QuantityStepper";
import { readBasket, writeBasket, type StoredBasketLine } from "@/lib/customer/basket";
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
  /** The local basket, so a quantity change here persists like anywhere else. */
  const [stored, setStored] = useState<StoredBasketLine[]>([]);
  const [validating, setValidating] = useState<Set<string>>(new Set());
  const debounce = useRef<number | null>(null);
  const request = useRef(0);
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

  const verify = useCallback(
    async (lines?: StoredBasketLine[], touched: string[] = []) => {
      const current = lines ?? readBasket();
      setStored(current);
      if (!current.length) {
        router.replace("/account/basket");
        return;
      }
      const ticket = ++request.current;
      setChecking(true);
      setValidating(new Set(touched));
      try {
        const r = await fetch("/api/account/basket/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lines: current }),
        });
        const j = await r.json();
        // A superseded response must not overwrite a newer one.
        if (ticket !== request.current) return;
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
        if (ticket !== request.current) return;
        setBlockedReason(tr("Impossibile verificare il carrello."));
        setBasket(null);
      } finally {
        if (ticket === request.current) {
          setChecking(false);
          setValidating(new Set());
        }
      }
    },
    [router, tr]
  );

  /**
   * A quantity change made from the checkout.
   *
   * Same contract as the basket: the write happens FIRST and unconditionally,
   * so the basket survives a slow or failed validation and every screen agrees
   * about what is in it. Typing is debounced; +/- is immediate.
   */
  const changeQuantity = useCallback(
    (line: StoredBasketLine, quantity: number, immediate: boolean) => {
      const next = stored
        .map((x) =>
          x.productId === line.productId && x.oldDot === line.oldDot ? { ...x, quantity } : x
        )
        .filter((x) => x.quantity > 0);

      setStored(next);
      if (!writeBasket(next)) return;

      if (debounce.current !== null) window.clearTimeout(debounce.current);
      const touched = [`${line.productId}:${line.oldDot ? "1" : "0"}`];
      if (immediate) {
        void verify(next, touched);
      } else {
        setValidating(new Set(touched));
        debounce.current = window.setTimeout(() => void verify(next, touched), 500);
      }
    },
    [stored, verify]
  );

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
    // Deliberately once, on mount. `verify` is re-created whenever the local
    // basket changes, and re-running on that identity would re-check the
    // basket every time a digit was typed into a quantity box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
        {tr("Conferma ordine")}
      </h1>

      {/*
        MOBILE-FIRST ORDER: delivery, payment, then what is being bought, then
        the confirm. A phone reads top to bottom and cannot see a sidebar, so
        the summary sits where it is read last — immediately above the button
        it justifies. From `lg` the two setup sections share a row.
      */}
      <div className="mt-5 space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          {/* ---- 1. DELIVERY -------------------------------------------- */}
          <section className="rounded-2xl border border-ink/10 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-extrabold text-ink">
              <CommerceLocationIcon className="h-[18px] w-[18px] text-ink-soft" />
              {tr("Consegna")}
            </h2>
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
                  className={FIELD}
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

            <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-ink-soft">
              {tr("Servizio")}
            </h3>
            <label className="sr-only" htmlFor="checkout-fulfilment">
              {tr("Servizio di consegna")}
            </label>
            <select
              id="checkout-fulfilment"
              className={FIELD}
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

          {/* ---- 2. PAYMENT --------------------------------------------- */}
          <section className="rounded-2xl border border-ink/10 bg-white p-4">
            <h2 className="text-sm font-extrabold text-ink">{tr("Pagamento")}</h2>
            <fieldset className="mt-3 space-y-2">
              <legend className="sr-only">{tr("Metodo di pagamento")}</legend>
              {PAYMENT_OPTIONS.map((x) => (
                <label
                  key={x.value}
                  className={`flex min-h-[56px] cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                    paymentMethod === x.value
                      ? "border-accent bg-accent-light"
                      : "border-ink/15 hover:bg-surface-soft"
                  }`}
                >
                  <input
                    type="radio"
                    name="payment-method"
                    className="mt-1 h-4 w-4 flex-none accent-accent"
                    value={x.value}
                    checked={paymentMethod === x.value}
                    onChange={() => setPayment(x.value)}
                  />
                  <span>
                    <span className="block text-sm font-bold text-ink">{tr(x.label)}</span>
                    <span className="block text-xs text-ink-soft">{tr(x.hint)}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-ink-soft">
              {tr("Note")}
              <textarea
                className="mt-1 min-h-20 w-full rounded-xl border border-ink/15 p-3 text-sm font-normal normal-case tracking-normal text-ink"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </section>
        </div>

        {/* ---- 3. ORDER SUMMARY ----------------------------------------- */}
        {basket && (
          <section className="rounded-2xl border border-ink/10 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-extrabold text-ink">
              <CommerceCartIcon className="h-[18px] w-[18px] text-ink-soft" />
              {tr("Articoli")}
            </h2>
            <div className="mt-3 space-y-3">
              {basket.lines.map((line) => {
                const key = `${line.productId}:${line.oldDot ? "1" : "0"}`;
                const s = stored.find(
                  (x) => x.productId === line.productId && x.oldDot === line.oldDot
                );
                const name = [line.tyre?.brand, line.tyre?.modelPattern].filter(Boolean).join(" ");
                return (
                  <div key={key} className="border-b border-ink/10 pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-extrabold text-ink">
                          {name || tr("Articolo non disponibile")}
                        </div>
                        <div className="text-xs font-semibold text-ink-soft">
                          {line.tyre?.sizeDisplay ?? ""}
                        </div>
                      </div>
                      <strong className="text-sm">
                        {money(
                          line.unitTotalCents === null ? null : line.unitTotalCents * line.quantity
                        )}
                      </strong>
                    </div>

                    {/*
                      Quantities ARE editable here. A customer who reaches
                      checkout and finds one line short should be able to fix it
                      without going back two screens and losing their place.
                      Each change re-validates that line only.
                    */}
                    {s && (
                      <div className="mt-2">
                        <QuantityStepper
                          value={s.quantity}
                          label={`${tr("Quantità")} ${name}`.trim()}
                          size="sm"
                          onChange={(q) => changeQuantity(s, q, false)}
                          onCommit={(q) => changeQuantity(s, q, true)}
                        />
                      </div>
                    )}

                    <LineAvailability
                      state={line.state}
                      availableQuantity={line.availableQuantity}
                      unavailableReason={line.unavailableReason}
                      requestedQuantity={line.quantity}
                      verifiedSource={line.verifiedSource}
                      verifiedAt={line.verifiedAt}
                      tyre={line.tyre}
                      validating={validating.has(key)}
                      onAcceptAvailable={s ? (q) => changeQuantity(s, q, true) : null}
                      busy={checking}
                      tr={tr}
                    />
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-baseline justify-between border-t border-ink/10 pt-4">
              <span className="text-sm font-bold text-ink">
                {basket.pfuEstimated ? tr("Totale stimato") : tr("Totale da pagare")}
              </span>
              <strong className="text-xl font-extrabold text-ink">
                {money(basket.grandTotalCents)}
              </strong>
            </div>
          </section>
        )}
      </div>

      {/* ---- THE PRICE MOVED, and the customer has to see it ------------ */}
      {priceChange && (
        <div
          role="alert"
          className="mt-4 rounded-2xl border-2 border-state-warning/50 bg-state-warning-soft p-4"
        >
          <p className="flex items-center gap-2 font-bold text-ink">
            <CommerceWarningIcon className="h-4 w-4 flex-none text-state-warning" />
            {tr("Il prezzo è cambiato")}
          </p>
          <p className="mt-1 text-sm text-ink">
            {tr("Al momento della conferma il totale era")} <strong>{money(priceChange.from)}</strong>.{" "}
            {tr("Il prezzo aggiornato è")} <strong>{money(priceChange.to)}</strong>.{" "}
            {tr("Nessun ordine è stato creato. Conferma di nuovo per procedere al nuovo importo.")}
          </p>
        </div>
      )}

      {/* ---- A LINE CANNOT BE SUPPLIED --------------------------------- */}
      {!checking && basket && !orderable && (
        <div className="mt-4 rounded-2xl border border-state-danger/30 bg-state-danger-soft p-4">
          <p className="flex items-center gap-2 font-bold text-state-danger">
            <CommerceWarningIcon className="h-4 w-4 flex-none" />
            {blockedLines.length === 1
              ? tr("Un articolo non è disponibile nella quantità richiesta.")
              : `${blockedLines.length} ${tr("articoli non sono disponibili nella quantità richiesta.")}`}
          </p>
          <p className="mt-1 text-sm text-ink">
            {tr("Torna al carrello per aggiornare le quantità o scegliere un'alternativa.")}
          </p>
          <a
            href="/account/basket"
            className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-ink px-4 text-sm font-bold text-white"
          >
            {tr("Torna al carrello")}
          </a>
        </div>
      )}

      {checking && (
        <p
          className="mt-4 rounded-2xl border border-ink/10 bg-white p-4 text-sm text-ink-soft"
          aria-live="polite"
        >
          {tr("Verifica di prezzi e disponibilità in corso…")}
        </p>
      )}

      {!checking && !blockedReason && (
        <p className="mt-4 rounded-2xl border border-state-warning/40 bg-state-warning-soft p-4 text-sm text-ink">
          {tr("PFU stimato — l'importo definitivo può variare.")}{" "}
          {tr(
            "Il PFU indicato è una stima. L'importo definitivo può variare e sarà confermato da GommaRush."
          )}
        </p>
      )}

      {!checking && blockedReason && (
        <p className="mt-4 rounded-2xl border border-state-warning/40 bg-state-warning-soft p-4 text-sm text-ink">
          {blockedReason}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-2xl border border-state-danger/30 bg-state-danger-soft p-4 text-sm text-state-danger">
          {error}
        </p>
      )}

      {/*
        The confirm is full width on a phone and 44px+ everywhere. It sits in
        normal flow rather than in a sticky footer: the delivery and payment
        choices above it are what it commits to, and a floating button that can
        be pressed while those are still off-screen invites exactly that.
      */}
      <div className="mt-5 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button size="lg" className="w-full sm:w-auto" disabled={!canSubmit} onClick={submit}>
          {busy ? tr("Verifica in corso…") : tr("Invia ordine a GommaRush")}
        </Button>
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-soft sm:justify-end sm:text-right">
        <CommerceTruckIcon className="mt-0.5 h-3.5 w-3.5 flex-none" />
        <span>
          {tr("Disponibilità e prezzo vengono verificati alla conferma.")}{" "}
          {tr(
            "L'ordine viene inviato a GommaRush per conferma manuale. Non viene inoltrato automaticamente a un fornitore."
          )}
        </span>
      </p>
    </div>
  );
}

/** Shared field styling, so delivery and service read as one control group. */
const FIELD =
  "mt-2 h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm font-semibold text-ink";

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import {
  CommerceCartIcon,
  CommerceLocationIcon,
  CommerceRefreshIcon,
  CommerceTruckIcon,
  CommerceWarningIcon,
} from "@/components/customer/CommerceIcons";
import { LineAvailability, type LineState } from "@/components/customer/LineAvailability";
import { QuantityStepper } from "@/components/customer/QuantityStepper";
import { readBasket, writeBasket, type StoredBasketLine } from "@/lib/customer/basket";
import { formatSalesOrderNumber } from "@/lib/commerce/order-number";
import { FULFILMENT_CLASSES, FULFILMENT_LABELS } from "@/lib/commerce/fulfilment";
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
 * THE LIVE SUPPLIER CHECK HAPPENS ONLY ON SUBMIT (owner decision,
 * 2026-09-26). Opening this screen and changing a quantity ask the preview
 * route, which re-prices from current CATALOGUE data only — no supplier call,
 * and nothing about verification is shown. Pressing the button makes the one
 * authoritative check, force-fresh: live quantity and live price, re-derived
 * through the pricing engine. If it cannot complete — configuration missing,
 * timeout, authentication refused, malformed answer — no order is created
 * (LIVE_VERIFICATION_UNAVAILABLE, D27, fail closed; never shown as out of
 * stock). If a price moved, the request comes back refused WITH the
 * recomputed basket, this screen redraws with it, and the customer confirms
 * again against what is now on the page. That second press is the difference
 * between a customer agreeing to a price and a customer being charged one.
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
  unitTyreNetCents: number | null;
  unitTotalCents: number | null;
};

type Basket = {
  lines: Line[];
  tyreNetTotalCents: number;
  pfuTotalCents: number | null;
  vatTotalCents: number | null;
  vatRatePercent: number;
  grandTotalCents: number | null;
  monetaryStatus: string;
  orderable: boolean;
  pfuEstimated: boolean;
};

/** V1 payment methods, owner-confirmed. POS on delivery is not among them. */
const PAYMENT_OPTIONS = [
  { value: "bank_transfer", label: "Bonifico bancario", hint: "Coordinate inviate con la conferma" },
  { value: "cash_on_delivery", label: "Contanti alla consegna", hint: "Pagamento al momento della consegna" },
] as const;

/** Same words the order record shows back — see FULFILMENT_LABELS. */
const FULFILMENT_OPTIONS = FULFILMENT_CLASSES.map((value) => ({ value, label: FULFILMENT_LABELS[value] }));

// Codes the API is willing to return. Anything else is deliberately generic:
// the server logs the detail and does not send it to the customer.
const ORDER_ERRORS: Record<string, string> = {
  PRICING_NOT_FINAL: "Il totale finale non è ancora confermato, quindi l'ordine non può essere inviato.",
  BASKET_ITEM_UNAVAILABLE: "Uno o più articoli non sono più disponibili. Aggiorna il carrello.",
  BASKET_QUANTITY_UNAVAILABLE: "La quantità richiesta non è più disponibile. Riduci la quantità.",
  DELIVERY_ADDRESS_INVALID: "L'indirizzo di consegna selezionato non è valido.",
  CUSTOMER_NOT_FOUND: "Account non abilitato. Contatta GommaRush.",
};

/**
 * The one refusal that is NOT the customer's fault and NOT about stock.
 *
 * Kept out of ORDER_ERRORS on purpose: those render as a red failure banner,
 * and this must never read as "out of stock" or as something the customer did
 * wrong. It gets its own amber panel with a retry, because retrying is the
 * correct response.
 */
const VERIFICATION_UNAVAILABLE = "LIVE_VERIFICATION_UNAVAILABLE";

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
  const [priceChange, setPriceChange] = useState<{
    /** `submit`: the order was refused at this figure. `preview`: a re-check moved it. */
    kind: "submit" | "preview";
    from: number | null;
    to: number | null;
  } | null>(null);
  /** The basket currently on screen, to tell a moved unit price from a quantity edit. */
  const shown = useRef<Basket | null>(null);
  /** Set when the order gate could not confirm current figures. Retryable. */
  const [verificationUnavailable, setVerificationUnavailable] = useState(false);

  const verify = useCallback(
    async (lines?: StoredBasketLine[]) => {
      const current = lines ?? readBasket();
      setStored(current);
      if (!current.length) {
        router.replace("/account/basket");
        return;
      }
      const ticket = ++request.current;
      setChecking(true);
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
        /*
          A PRICE MOVED BY THE CHECK ITSELF is announced, not absorbed. A
          quantity edit changes the total for an obvious reason; a unit price
          changing underneath the customer does not, and the new total must
          not simply appear in place of the one they were reading.
        */
        const moved = unitPriceMoved(shown.current, j.basket);
        shown.current = j.basket;
        setBasket(j.basket);
        setAcceptedTotal(j.basket?.grandTotalCents ?? null);
        setPriceChange(
          moved ? { from: null, to: j.basket?.grandTotalCents ?? null, kind: "preview" } : null
        );
        setVerificationUnavailable(false);
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
        if (ticket === request.current) setChecking(false);
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

      // Re-priced from catalogue data only: no supplier call happens here.
      if (debounce.current !== null) window.clearTimeout(debounce.current);
      if (immediate) {
        void verify(next);
      } else {
        debounce.current = window.setTimeout(() => void verify(next), 500);
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
    setVerificationUnavailable(false);
    // Pressing again IS the confirmation of a changed price; its notice has done its job.
    setPriceChange(null);
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
        if (j.code === VERIFICATION_UNAVAILABLE) setVerificationUnavailable(true);
        if (j.basket) {
          shown.current = j.basket;
          setBasket(j.basket);
          if (j.code === "PRICE_CHANGED") {
            setPriceChange({ from: submittedTotal, to: j.basket.grandTotalCents ?? null, kind: "submit" });
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
      if (
        code !== "PRICE_CHANGED" &&
        code !== "BASKET_NOT_ORDERABLE" &&
        code !== VERIFICATION_UNAVAILABLE
      ) {
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

  /*
    ONE STATUS, CHOSEN IN PRIORITY ORDER, drawn in one place directly above
    the button it qualifies. These used to be up to five stacked panels, some
    of which could appear together and contradict each other.

      validating      the basket is being re-priced          (no banner)
      load_failed     the basket could not be checked      red, retry
      unavailable     a line cannot be supplied as asked   red, blocks
      price_changed   a unit price moved under the order   amber, re-confirm
      verification    the final live check could not run   amber, retry
      pricing         the final total is not yet available amber, blocks
      ready           nothing to say — the button speaks
  */
  const status: "validating" | "load_failed" | "unavailable" | "price_changed" | "verification" | "pricing" | "ready" =
    checking
      ? "validating"
      : !basket
        ? "load_failed"
        : !orderable
          ? "unavailable"
          : priceChange
            ? "price_changed"
            : verificationUnavailable
              ? "verification"
              : blockedReason
                ? "pricing"
                : "ready";

  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
        {tr("Conferma ordine")}
      </h1>

      {/*
        MOBILE-FIRST ORDER: delivery, payment, then what is being bought, then
        the confirm — one column, read top to bottom, the summary sitting
        immediately above the button it justifies.

        From `lg` the choices take the left column and the summary, its status
        and the one button sit on the right, sticky. Both choices are always in
        view beside it there, so the button cannot be pressed with either of
        them off-screen — the reason it is NOT sticky on a phone.
      */}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <div className="space-y-4">
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
                  className={`flex min-h-[56px] cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-accent ${
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
                className="mt-1 min-h-20 w-full rounded-xl border border-ink/15 p-3 text-base font-normal sm:text-sm normal-case tracking-normal text-ink"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </section>
        </div>

        {/* ---- 3. ORDER SUMMARY + 4. THE ONE FINAL ACTION ------------------ */}
        <div className="space-y-4 lg:sticky lg:top-24">
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
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-extrabold text-ink">
                            {name || tr("Articolo non disponibile")}
                          </div>
                          <div className="text-xs font-semibold text-ink-soft">
                            {line.tyre?.sizeDisplay ?? ""}
                          </div>
                        </div>
                        {/* Net, like the basket, so the lines add up to "Pneumatici" below. */}
                        <strong className="flex-none text-sm text-ink">
                          {money(
                            line.unitTyreNetCents === null ? null : line.unitTyreNetCents * line.quantity
                          )}
                        </strong>
                      </div>

                      {/*
                        Quantities ARE editable here. A customer who reaches
                        checkout and finds one line short should be able to fix
                        it without going back two screens and losing their place.
                        Each change re-validates that line only, through the same
                        preview route as the basket.
                      */}
                      {s && (
                        <div className="mt-2">
                          <QuantityStepper
                            value={s.quantity}
                            label={`${tr("Quantità")} ${name}`.trim()}
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
                        tyre={line.tyre}
                        onAcceptAvailable={s ? (q) => changeQuantity(s, q, true) : null}
                        /* No per-line retry here: the one status panel above the button carries it. */
                        busy={checking}
                        tr={tr}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Same chain as the basket: Pneumatici → PFU → IVA → Totale. */}
              <dl className="mt-4 space-y-2 border-t border-ink/10 pt-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-soft">{tr("Pneumatici")}</dt>
                  <dd className="font-semibold text-ink">{money(basket.tyreNetTotalCents)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">
                    {tr("PFU")}
                    {basket.pfuEstimated && <span aria-hidden="true"> *</span>}
                  </dt>
                  <dd className="font-semibold text-ink">{money(basket.pfuTotalCents)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">
                    {tr("IVA")} {basket.vatRatePercent}%
                  </dt>
                  <dd className="font-semibold text-ink">{money(basket.vatTotalCents)}</dd>
                </div>
              </dl>

              <div className="mt-3 flex items-baseline justify-between border-t border-ink/10 pt-3">
                <span className="text-sm font-bold text-ink">
                  {basket.pfuEstimated ? tr("Totale stimato") : tr("Totale da pagare")}
                </span>
                <strong className="text-xl font-extrabold text-ink">
                  {money(basket.grandTotalCents)}
                </strong>
              </div>

              {/* The disclosure, at the place the number is read — as in the basket. */}
              {basket.pfuEstimated && (
                <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
                  * {tr("PFU stimato — l'importo definitivo può variare.")}
                </p>
              )}
            </section>
          )}

          {/* ---- THE STATUS, one at a time ------------------------------ */}
          <div aria-live="polite">
            {status === "load_failed" && (
              <div role="alert" className="rounded-2xl border border-state-danger/30 bg-state-danger-soft p-4">
                <p className="text-sm font-semibold text-state-danger">
                  {blockedReason ?? tr("Impossibile verificare il carrello.")}
                </p>
                <Button className="mt-3" size="md" variant="secondary" onClick={() => void verify()}>
                  {tr("Riprova")}
                </Button>
              </div>
            )}

            {/* ---- A LINE CANNOT BE SUPPLIED ----------------------------- */}
            {status === "unavailable" && (
              <div className="rounded-2xl border border-state-danger/30 bg-state-danger-soft p-4">
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

            {/* ---- THE PRICE MOVED, and the customer has to see it -------- */}
            {status === "price_changed" && priceChange && (
              <div
                role="alert"
                className="rounded-2xl border-2 border-state-warning/50 bg-state-warning-soft p-4"
              >
                <p className="flex items-center gap-2 font-bold text-ink">
                  <CommerceWarningIcon className="h-4 w-4 flex-none text-state-warning" />
                  {tr("Il prezzo è cambiato")}
                </p>
                {priceChange.kind === "submit" ? (
                  <p className="mt-1 text-sm text-ink">
                    {tr("Al momento della conferma il totale era")} <strong>{money(priceChange.from)}</strong>.{" "}
                    {tr("Il prezzo aggiornato è")} <strong>{money(priceChange.to)}</strong>.{" "}
                    {tr("Nessun ordine è stato creato. Conferma di nuovo per procedere al nuovo importo.")}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-ink">
                    {tr("Il prezzo aggiornato è")} <strong>{money(priceChange.to)}</strong>.
                  </p>
                )}
              </div>
            )}

            {/* ---- CURRENT FIGURES COULD NOT BE CONFIRMED -----------------
                Amber, not red, and explicitly NOT out-of-stock. Retrying
                re-runs the check only; it never places the order — the one
                button below is the only thing that does.
            */}
            {status === "verification" && (
              <div
                role="alert"
                className="rounded-2xl border-2 border-state-warning/50 bg-state-warning-soft p-4"
              >
                <p className="flex items-center gap-2 font-bold text-ink">
                  <CommerceRefreshIcon className="h-4 w-4 flex-none text-state-warning" />
                  {tr("Verifica non riuscita")}
                </p>
                {verificationUnavailable && (
                  <p className="mt-1 text-sm text-ink">
                    {tr(
                      "Non siamo riusciti a confermare disponibilità e prezzo aggiornati. Nessun ordine è stato creato. Riprova tra poco."
                    )}
                  </p>
                )}
                <Button className="mt-3" size="md" variant="secondary" disabled={checking} onClick={() => void verify(stored)}>
                  {tr("Riprova")}
                </Button>
              </div>
            )}

            {status === "pricing" && (
              <p className="rounded-2xl border border-state-warning/40 bg-state-warning-soft p-4 text-sm text-ink">
                {blockedReason}
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-2xl border border-state-danger/30 bg-state-danger-soft p-4 text-sm text-state-danger">
              {error}
            </p>
          )}

          {/*
            THE ONE FINAL ACTION. Full width, 56px, in normal flow on a phone:
            the delivery and payment choices above it are what it commits to,
            and a floating button that can be pressed while those are still
            off-screen invites exactly that.
          */}
          <div>
            <Button size="lg" className="w-full" disabled={!canSubmit} onClick={submit}>
              {busy ? tr("Verifica in corso…") : tr("Invia ordine a GommaRush")}
            </Button>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-soft">
              <CommerceTruckIcon className="mt-0.5 h-3.5 w-3.5 flex-none" />
              <span>
                {tr("Disponibilità e prezzo vengono verificati alla conferma.")}{" "}
                {tr(
                  "L'ordine viene inviato a GommaRush per conferma manuale. Non viene inoltrato automaticamente a un fornitore."
                )}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * True when a line present in both baskets now costs a different amount per
 * unit. Quantity is deliberately ignored: a quantity edit changes the total
 * for a reason the customer already knows.
 */
function unitPriceMoved(before: Basket | null, after: Basket | null): boolean {
  if (!before || !after) return false;
  return after.lines.some((line) => {
    const previous = before.lines.find(
      (x) => x.productId === line.productId && x.oldDot === line.oldDot
    );
    return (
      previous !== undefined &&
      previous.unitTotalCents !== null &&
      line.unitTotalCents !== null &&
      previous.unitTotalCents !== line.unitTotalCents
    );
  });
}

/** Shared field styling, so delivery and service read as one control group. */
const FIELD =
  "mt-2 h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-base font-semibold text-ink sm:text-sm";

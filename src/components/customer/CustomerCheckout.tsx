"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { readBasket, writeBasket } from "@/lib/customer/basket";
import { formatSalesOrderNumber } from "@/lib/commerce/order-number";
import { useTr } from "@/lib/i18n/tr";

/**
 * Checkout.
 *
 * The customer chooses a GommaRush SERVICE — where it goes, how fast, how they
 * pay. They never choose a supplier, and no screen here mentions one.
 *
 * The submit button stays disabled until the server has confirmed the basket is
 * monetarily complete. While the PFU tariff is unresolved that never happens,
 * and this screen says so plainly instead of offering a button that fails. The
 * gate is enforced again in createPortalSalesOrder, which refuses with
 * PRICING_NOT_FINAL regardless of what the browser believes.
 */

type Location = {
  id: string;
  location_name: string | null;
  address_line1: string;
  city: string;
  postal_code: string | null;
  is_primary: boolean;
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
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

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
        setReady(false);
        return;
      }
      const complete = j.basket?.monetaryStatus === "complete";
      setReady(complete);
      setBlockedReason(
        complete
          ? null
          : tr(
              "Il totale finale è in attesa della conferma della tariffa PFU. L'ordine non può ancora essere inviato."
            )
      );
    } catch {
      setBlockedReason(tr("Impossibile verificare il carrello."));
      setReady(false);
    } finally {
      setChecking(false);
    }
  }, [router, tr]);

  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
    void verify();
  }, [verify]);

  async function submit() {
    setBusy(true);
    setError(null);
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
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.code);

      writeBasket([]);
      // The allocated order number travels to the confirmation, so the customer
      // sees the same GR-…  reference the operator sees, immediately.
      const reference = formatSalesOrderNumber(j.order?.order_number);
      router.replace(reference ? `/account/orders?created=${encodeURIComponent(reference)}` : "/account/orders");
      router.refresh();
    } catch (e) {
      setError(tr(ORDER_ERRORS[e instanceof Error ? e.message : ""] ?? "Ordine non inviato. Riprova."));
      setBusy(false);
    }
  }

  const canSubmit = ready && !!locationId && !!idempotencyKey && !busy && !checking;

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
          {busy ? tr("Invio…") : tr("Invia ordine a GommaRush")}
        </Button>
      </div>
      <p className="mt-2 text-right text-xs text-ink-soft">
        {tr(
          "L'ordine viene inviato a GommaRush per conferma manuale. Non viene inoltrato automaticamente a un fornitore."
        )}
      </p>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/logistics/AdminShell";
import { Button } from "@/components/Button";
import { getSalesOrderDetail } from "@/lib/server/sales-orders";
import { getTr } from "@/lib/i18n/tr-server";
import { formatSalesOrderNumber } from "@/lib/commerce/order-number";

export const dynamic = "force-dynamic";

type Snapshot = Record<string, unknown>;

const text = (snapshot: Snapshot | null, key: string): string => {
  const value = snapshot?.[key];
  return typeof value === "string" ? value : "";
};

const money = (cents: number | null, currency: string, fallback: string) =>
  cents === null
    ? fallback
    : new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(cents / 100);

/**
 * One customer order, for review.
 *
 * Shows what the customer was quoted and where it goes. It does NOT show which
 * supplier would fill it: sourcing is a later, separate decision, and
 * `source_listing_id` is deliberately not selected by getSalesOrderDetail.
 *
 * The confirm button is disabled here for the same reason as on the inbox —
 * no supplier commitment may originate from a customer order today.
 */
export default async function SalesOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const tr = getTr();
  const { id } = await params;

  let result: Awaited<ReturnType<typeof getSalesOrderDetail>>;
  try {
    result = await getSalesOrderDetail(id);
  } catch {
    return (
      <>
        <PageHeading title={tr("Ordine cliente")} />
        <p className="text-ink-soft">{tr("Il modulo vendite non è ancora attivato nel database.")}</p>
      </>
    );
  }
  if (!result) notFound();

  const { order, items } = result;
  const customer = (order.customer_snapshot ?? {}) as Snapshot;
  const delivery = (order.delivery_snapshot ?? {}) as Snapshot;
  const pending = tr("Da confermare");

  return (
    <>
      <PageHeading
        title={`${tr("Ordine cliente")} ${formatSalesOrderNumber(order.order_number)}`}
        description={tr("Richiesta ricevuta · revisione manuale obbligatoria")}
        action={
          <Button disabled title={tr("Ordinazione fornitore non ancora attiva")}>
            {tr("Conferma e invia ordine")}
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-xl bg-white p-5 shadow-card lg:col-span-2">
          <h2 className="font-bold">{tr("Articoli")}</h2>
          <div className="mt-3 divide-y divide-ink/10">
            {items.map((item) => {
              const tyre = (item.tyre_snapshot ?? {}) as Snapshot;
              return (
                <div key={item.id} className="flex justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <strong>
                      {text(tyre, "brand")} {text(tyre, "modelPattern")}
                    </strong>
                    <div className="text-sm text-ink-soft">
                      {text(tyre, "sizeDisplay")} · {item.quantity} pz
                      {item.condition_snapshot === "older_dot" ? ` · ${tr("DOT precedente")}` : ""}
                    </div>
                  </div>
                  <strong>
                    {money(
                      item.unit_total_cents === null ? null : item.unit_total_cents * item.quantity,
                      order.currency,
                      pending
                    )}
                  </strong>
                </div>
              );
            })}
          </div>
          <div className="mt-4 border-t border-ink/10 pt-4 text-right text-lg font-extrabold">
            {tr("Totale")} {money(order.grand_total_cents, order.currency, pending)}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-xl bg-white p-5 shadow-card">
            <h2 className="font-bold">{tr("Cliente")}</h2>
            <p className="mt-2">{text(customer, "legal_name") || text(customer, "name")}</p>
            {text(customer, "vat_number") && (
              <p className="text-sm text-ink-soft">P. IVA {text(customer, "vat_number")}</p>
            )}
          </section>
          <section className="rounded-xl bg-white p-5 shadow-card">
            <h2 className="font-bold">{tr("Consegna")}</h2>
            <p className="mt-2 text-sm">
              {text(delivery, "recipient_name") || text(delivery, "location_name")}
              <br />
              {text(delivery, "address_line1")}
              <br />
              {text(delivery, "postal_code")} {text(delivery, "city")} {text(delivery, "province")}
            </p>
          </section>
          <section className="rounded-xl bg-white p-5 shadow-card">
            <h2 className="font-bold">{tr("Ordine")}</h2>
            <p className="mt-2 text-sm text-ink-soft">
              {tr("Servizio")}: {order.fulfilment_class}
              <br />
              {tr("Pagamento")}: {order.payment_method}
              <br />
              {tr("Stato")}: {order.status}
            </p>
          </section>
        </aside>
      </div>

      <p className="mt-6 text-sm text-ink-soft">
        <Link className="underline" href="/admin/sales-orders">
          {tr("Torna agli ordini da confermare")}
        </Link>
      </p>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/logistics/AdminShell";
import { SalesOrderActions } from "@/components/logistics/SalesOrderActions";
import { getSalesOrderDetail } from "@/lib/server/sales-orders";
import { getSalesOrderHistory } from "@/lib/server/sales-order-workflow";
import { fulfilmentLabel } from "@/lib/commerce/fulfilment";
import {
  ADMIN_STATUS_LABELS,
  isSalesOrderStatus,
  PAYMENT_METHOD_LABELS,
} from "@/lib/commerce/sales-order-status";
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
  const service = fulfilmentLabel(order.fulfilment_class);
  const payment = PAYMENT_METHOD_LABELS[order.payment_method as string];
  // `order` comes from select("*") and is untyped; narrow the status once.
  const orderStatus: unknown = order.status;
  const knownStatus = isSalesOrderStatus(orderStatus) ? orderStatus : null;
  const statusLabel = knownStatus ? tr(ADMIN_STATUS_LABELS[knownStatus]) : String(order.status);
  const history = await getSalesOrderHistory(order.id).catch(() => null);

  return (
    <>
      <PageHeading
        title={`${tr("Ordine cliente")} ${formatSalesOrderNumber(order.order_number)}`}
        description={statusLabel}
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
              {tr("Servizio")}: {service ? tr(service) : "—"}
              <br />
              {tr("Pagamento")}: {payment ? tr(payment) : "—"}
              <br />
              {tr("Stato")}: {statusLabel}
            </p>
            {typeof order.status_note === "string" && order.status_note && (
              <p className="mt-2 text-sm text-ink">
                {tr("Motivo")}: {order.status_note}
              </p>
            )}
          </section>

          {knownStatus && <SalesOrderActions orderId={order.id} status={knownStatus} />}

          <section className="rounded-xl bg-white p-5 shadow-card">
            <h2 className="font-bold">{tr("Storico")}</h2>
            {history === null ? (
              <p className="mt-2 text-sm text-ink-soft">
                {tr("La gestione stati non è ancora attivata nel database (migrazione 0008).")}
              </p>
            ) : history.length === 0 ? (
              <p className="mt-2 text-sm text-ink-soft">{tr("Nessuna modifica di stato.")}</p>
            ) : (
              <ol className="mt-2 space-y-2 text-sm">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <span className="font-semibold text-ink">
                      {isSalesOrderStatus(entry.to_status) ? tr(ADMIN_STATUS_LABELS[entry.to_status]) : entry.to_status}
                    </span>
                    <span className="text-ink-soft">
                      {" "}· {new Date(entry.created_at).toLocaleString("it-IT")}
                      {entry.actor_label ? ` · ${entry.actor_label}` : ""}
                    </span>
                    {entry.note && <div className="text-ink-soft">{entry.note}</div>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>

      <p className="mt-6 text-sm text-ink-soft">
        <Link className="underline" href="/admin/sales-orders">
          {tr("Torna agli ordini clienti")}
        </Link>
      </p>
    </>
  );
}

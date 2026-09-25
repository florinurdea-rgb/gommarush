import Link from "next/link";
import { notFound } from "next/navigation";
import { CommerceLocationIcon, CommerceTruckIcon } from "@/components/customer/CommerceIcons";
import { OrderStatusTag } from "@/components/customer/OrderStatusTag";
import { getCustomerSession } from "@/lib/auth/customer-session";
import { getCustomerSalesOrderDetail } from "@/lib/server/sales-orders";
import { formatSalesOrderNumber } from "@/lib/commerce/order-number";
import { fulfilmentLabel } from "@/lib/commerce/fulfilment";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";

/**
 * One of the customer's own orders.
 *
 * SCOPED BY THE SESSION, not by the URL. `getCustomerSalesOrderDetail` filters
 * on customer_id as well as order id, so another customer's order id resolves
 * to nothing and is indistinguishable from one that does not exist.
 *
 * It shows the SNAPSHOT the order was created with — the tyres, quantities and
 * amounts as they were agreed — not a re-resolution of current data. An order
 * is a record of what was committed to, and re-pricing it on every read would
 * make a historical document change under the customer.
 *
 * Only existing fields are rendered. There is no tracking number, no invoice
 * link and no delivery date here, because the order model holds none of them.
 */
export default async function CustomerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tr = getTr();
  const { id } = await params;
  const session = await getCustomerSession();
  if (!session) notFound();

  let detail: Awaited<ReturnType<typeof getCustomerSalesOrderDetail>> = null;
  try {
    detail = await getCustomerSalesOrderDetail(id, session.customerId);
  } catch {
    detail = null;
  }
  if (!detail) notFound();

  const { order, items } = detail;
  const money = (cents: number | null, fallback = tr("Da confermare")) =>
    cents === null
      ? fallback
      : new Intl.NumberFormat("it-IT", { style: "currency", currency: order.currency }).format(
          cents / 100
        );

  const service = fulfilmentLabel(order.fulfilment_class);
  const delivery = (order.delivery_snapshot ?? {}) as Record<string, string | null>;
  const addressLine = [delivery.address_line1, delivery.postal_code, delivery.city, delivery.province]
    .filter(Boolean)
    .join(", ");

  return (
    <div>
      <Link
        href="/account/orders"
        className="inline-flex min-h-[44px] items-center text-sm font-semibold text-ink-soft underline underline-offset-2 hover:text-ink"
      >
        {tr("Ordini")}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
          {formatSalesOrderNumber(order.order_number)}
        </h1>
        <OrderStatusTag status={order.status} tr={tr} />
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {new Date(order.requested_at).toLocaleString("it-IT")}
      </p>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.7fr_1fr] lg:items-start">
        <section className="rounded-2xl border border-ink/10 bg-white p-4">
          <h2 className="text-sm font-extrabold text-ink">{tr("Articoli")}</h2>
          <ul className="mt-3 space-y-3">
            {items.map((item) => {
              const tyre = (item.tyre_snapshot ?? {}) as Record<string, string | boolean | null>;
              const name = [tyre.brand, tyre.modelPattern].filter(Boolean).join(" ");
              return (
                <li key={item.id} className="border-b border-ink/10 pb-3 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold text-ink">
                        {name || tr("Articolo non disponibile")}
                      </div>
                      <div className="mt-0.5 text-xs font-semibold text-ink-soft">
                        {String(tyre.sizeDisplay ?? "")}
                        {item.condition_snapshot === "older_dot" ? ` · ${tr("DOT precedente")}` : ""}
                        {` · ${item.quantity} ${tr("pz")}`}
                      </div>
                    </div>
                    <strong className="text-sm text-ink">
                      {money(
                        item.unit_total_cents === null
                          ? null
                          : item.unit_total_cents * item.quantity
                      )}
                    </strong>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="space-y-4">
          <section className="rounded-2xl border border-ink/10 bg-white p-4">
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft">
              {tr("Riepilogo")}
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">{tr("Pneumatici")}</dt>
                <dd className="font-semibold text-ink">{money(order.tyre_net_total_cents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">{tr("PFU")}</dt>
                <dd className="font-semibold text-ink">{money(order.pfu_total_cents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">
                  {tr("IVA")} {order.vat_rate_percent}%
                </dt>
                <dd className="font-semibold text-ink">{money(order.vat_total_cents)}</dd>
              </div>
            </dl>
            <div className="mt-3 flex items-baseline justify-between border-t border-ink/10 pt-3">
              <span className="text-sm font-bold text-ink">{tr("Totale")}</span>
              <strong className="text-lg font-extrabold text-ink">
                {money(order.grand_total_cents)}
              </strong>
            </div>
          </section>

          <section className="rounded-2xl border border-ink/10 bg-white p-4">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
              <CommerceLocationIcon className="h-4 w-4" />
              {tr("Consegna")}
            </h2>
            {delivery.location_name && (
              <p className="mt-2 text-sm font-bold text-ink">{delivery.location_name}</p>
            )}
            {addressLine && <p className="mt-1 text-sm text-ink-soft">{addressLine}</p>}
            {/*
              The service the customer chose, in the words they chose it by.
              `fulfilment_class` is a column value and is never drawn raw; an
              unrecognised one draws nothing rather than leaking it.
            */}
            {service && (
              <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
                <CommerceTruckIcon className="h-4 w-4" />
                {tr(service)}
              </p>
            )}
          </section>

          {order.customer_note && (
            <section className="rounded-2xl border border-ink/10 bg-white p-4">
              <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                {tr("Note")}
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{order.customer_note}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

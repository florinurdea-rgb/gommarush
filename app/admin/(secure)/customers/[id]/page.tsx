import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerWithLocations } from "@/lib/server/customers";
import { listCustomerSalesOrders } from "@/lib/server/sales-orders";
import { PageHeading } from "@/components/logistics/AdminShell";
import { CustomerEditor } from "@/components/logistics/CustomerEditor";
import { CustomerAccountsPanel } from "@/components/logistics/CustomerAccountsPanel";
import { OrderStatusTag } from "@/components/customer/OrderStatusTag";
import { isDeliverableLocation } from "@/lib/commerce/delivery-address";
import { formatSalesOrderNumber } from "@/lib/commerce/order-number";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";

/**
 * One customer company, as an operator runs it.
 *
 * ORDER OF THE PAGE = ORDER OF THE JOB. To put a new customer on the portal
 * an operator needs, in this order: a real delivery address, then a portal
 * login. So the page opens with a checklist of exactly those two facts, then
 * portal access (above the long locations editor — an operator who has to
 * scroll past every branch concludes the feature is missing), then company
 * and locations, then the customer's GommaRush sales orders.
 */
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const tr = getTr();
  const { id } = await params;
  const result = await getCustomerWithLocations(id);
  if (!result) notFound();

  const { customer, locations } = result;
  const deliverable = locations.filter((l) => l.active !== false && isDeliverableLocation(l)).length;

  let orders: Awaited<ReturnType<typeof listCustomerSalesOrders>> = [];
  let ordersUnavailable = false;
  try {
    orders = await listCustomerSalesOrders(customer.id);
  } catch {
    ordersUnavailable = true;
  }

  const money = (cents: number | null, currency: string) =>
    cents === null
      ? tr("Da confermare")
      : new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(cents / 100);

  return (
    <>
      <PageHeading
        title={customer.name}
        description={[customer.legal_name, customer.vat_number ? `P. IVA ${customer.vat_number}` : null]
          .filter(Boolean)
          .join(" · ") || tr("Azienda cliente e i suoi luoghi di consegna.")}
        back
      />

      {/* What this customer still needs before it can order on the portal. */}
      <ol className="mb-5 grid gap-2 sm:grid-cols-2">
        <li
          className={`rounded-xl border p-3 text-sm ${
            deliverable > 0 ? "border-state-success/30 bg-state-success-soft" : "border-state-warning/40 bg-state-warning-soft"
          }`}
        >
          <span className="font-bold text-ink">1. {tr("Luogo di consegna")}</span>
          <span className="block text-ink-soft">
            {deliverable > 0
              ? `${deliverable} ${tr("con indirizzo completo")}`
              : tr("Manca un indirizzo con via e città — aggiungilo qui sotto.")}
          </span>
        </li>
        <li className="rounded-xl border border-ink/10 bg-white p-3 text-sm">
          <span className="font-bold text-ink">2. {tr("Accesso area clienti")}</span>
          <span className="block text-ink-soft">{tr("Crea l'accesso e invia il link di attivazione al cliente.")}</span>
        </li>
      </ol>

      <div className="mb-5">
        <CustomerAccountsPanel customerId={customer.id} deliverableLocationCount={deliverable} />
      </div>

      <CustomerEditor customer={customer} locations={locations} />

      <section className="mt-5 rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink">{tr("Ordini clienti")}</h2>
        {ordersUnavailable ? (
          <p className="mt-2 text-sm text-ink-soft">{tr("Il modulo vendite non è ancora attivato nel database.")}</p>
        ) : orders.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{tr("Nessun ordine dal portale.")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/10">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/admin/sales-orders/${order.id}`}
                  className="flex min-h-[48px] flex-wrap items-center justify-between gap-3 py-2 hover:bg-surface-soft"
                >
                  <span className="flex items-center gap-2">
                    <strong className="text-sm text-ink">{formatSalesOrderNumber(order.order_number)}</strong>
                    <OrderStatusTag status={order.status} tr={tr} />
                    <span className="text-xs text-ink-soft">
                      {new Date(order.requested_at).toLocaleDateString("it-IT")}
                    </span>
                  </span>
                  <strong className="text-sm text-ink">{money(order.grand_total_cents, order.currency)}</strong>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

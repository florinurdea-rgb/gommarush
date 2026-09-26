import Link from "next/link";
import { CommerceCheckIcon, CommerceTruckIcon } from "@/components/customer/CommerceIcons";
import { OrderStatusTag } from "@/components/customer/OrderStatusTag";
import { getCustomerSession } from "@/lib/auth/customer-session";
import { listCustomerSalesOrders } from "@/lib/server/sales-orders";
import { formatSalesOrderNumber } from "@/lib/commerce/order-number";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";

const money = (cents: number | null, currency: string, fallback: string) =>
  cents === null
    ? fallback
    : new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(cents / 100);

/**
 * The customer's own orders.
 *
 * Scoped by the SESSION's customer id — never by a parameter — so one customer
 * cannot read another's history by editing a URL.
 *
 * `?created=GR-…` renders the confirmation for an order just placed. The
 * reference is only echoed back as a heading; the list underneath is read from
 * the database, so a hand-edited query string can announce a number but cannot
 * conjure an order.
 */
export default async function CustomerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const tr = getTr();
  const { created } = await searchParams;
  const session = await getCustomerSession();

  let orders: Awaited<ReturnType<typeof listCustomerSalesOrders>> = [];
  let unavailable = false;
  try {
    orders = session ? await listCustomerSalesOrders(session.customerId) : [];
  } catch {
    unavailable = true;
  }

  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">{tr("Ordini")}</h1>

      {created && (
        <div className="mt-5 rounded-2xl border border-state-success/40 bg-state-success-soft p-4">
          <p className="flex items-center gap-2 font-extrabold text-ink">
            <CommerceCheckIcon className="h-5 w-5 flex-none text-state-success" />
            {tr("Ordine inviato a GommaRush")}
          </p>
          <p className="mt-1 text-sm text-ink">
            {tr("Riferimento")} <strong>{created}</strong>.{" "}
            {tr("Un nostro operatore lo verifica e ti conferma disponibilità e importo finale.")}
          </p>
        </div>
      )}

      {unavailable ? (
        <p className="mt-5 rounded-2xl border border-ink/10 bg-white p-6 text-sm text-ink-soft">
          {tr("La cronologia ordini sarà disponibile dopo l’attivazione del modulo vendite.")}
        </p>
      ) : orders.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-ink/20 bg-white p-10 text-center">
          <CommerceTruckIcon className="mx-auto h-12 w-12 text-ink/20" />
          <p className="mt-4 font-bold text-ink">{tr("Non hai ancora ordini.")}</p>
          <Link
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-5 text-sm font-bold text-white"
            href="/account/catalogue"
          >
            {tr("Vai al catalogo")}
          </Link>
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/account/orders/${order.id}`}
                className="flex min-h-[64px] flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-white p-4 transition-colors hover:border-accent/40 hover:bg-accent-light/30"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-ink">{formatSalesOrderNumber(order.order_number)}</strong>
                    <OrderStatusTag status={order.status} tr={tr} />
                  </div>
                  <div className="mt-1 text-xs font-semibold text-ink-soft">
                    {new Date(order.requested_at).toLocaleDateString("it-IT")}
                  </div>
                </div>
                <strong className="text-ink">
                  {money(order.grand_total_cents, order.currency, tr("Da confermare"))}
                </strong>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

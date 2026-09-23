import Link from "next/link";
import { getCustomerSession } from "@/lib/auth/customer-session";
import { listCustomerSalesOrders } from "@/lib/server/sales-orders";
import { formatSalesOrderNumber } from "@/lib/commerce/order-number";

export const dynamic = "force-dynamic";

const money = (cents: number | null, currency: string) =>
  cents === null
    ? "Da confermare"
    : new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(cents / 100);

const STATUS_LABELS: Record<string, string> = {
  requested: "In attesa di conferma",
  confirmed: "Confermato",
  rejected: "Rifiutato",
  cancelled: "Annullato",
};

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
      <h1 className="text-2xl font-extrabold text-ink">Ordini</h1>

      {created && (
        <div className="mt-6 rounded-2xl border-2 border-accent/30 bg-accent-light/40 p-5">
          <p className="font-bold text-ink">Ordine inviato a GommaRush</p>
          <p className="mt-1 text-sm text-ink">
            Riferimento <strong>{created}</strong>. Un nostro operatore lo verifica e ti conferma
            disponibilità e importo finale.
          </p>
        </div>
      )}

      {unavailable ? (
        <p className="mt-6 rounded-2xl bg-white p-6 text-ink-soft shadow-card">
          La cronologia ordini sarà disponibile dopo l&apos;attivazione del modulo vendite.
        </p>
      ) : orders.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-white p-8 text-center shadow-card">
          <p className="text-ink-soft">Non hai ancora ordini.</p>
          <Link className="mt-4 inline-block font-semibold text-accent underline" href="/account/catalogue">
            Vai al catalogo
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {orders.map((order) => (
            <div
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-5 shadow-card"
            >
              <div className="min-w-0">
                <strong className="text-ink">{formatSalesOrderNumber(order.order_number)}</strong>
                <div className="mt-1 text-sm text-ink-soft">
                  {new Date(order.requested_at).toLocaleDateString("it-IT")} ·{" "}
                  {STATUS_LABELS[order.status] ?? order.status}
                </div>
              </div>
              <strong>{money(order.grand_total_cents, order.currency)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

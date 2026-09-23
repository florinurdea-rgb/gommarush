import Link from "next/link";
import { PageHeading } from "@/components/logistics/AdminShell";
import { Button } from "@/components/Button";
import { listRequestedSalesOrders } from "@/lib/server/sales-orders";
import { getTr } from "@/lib/i18n/tr-server";
import { formatSalesOrderNumber } from "@/lib/commerce/order-number";

export const dynamic = "force-dynamic";

const money = (cents: number | null, currency: string, fallback: string) =>
  cents === null
    ? fallback
    : new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(cents / 100);

/**
 * Customer orders waiting for a human.
 *
 * "Conferma e invia ordine" IS DISABLED AND MUST STAY DISABLED. Supplier
 * ordering is not active: no customer order may reach Inter-Sprint, Protocol
 * 103/104, a supplier email or any other external commitment. The button
 * exists so the workflow is legible, not so it can be pressed.
 */
export default async function SalesOrdersPage() {
  const tr = getTr();
  let orders: Awaited<ReturnType<typeof listRequestedSalesOrders>> = [];
  let unavailable = false;
  try {
    orders = await listRequestedSalesOrders();
  } catch {
    unavailable = true;
  }

  return (
    <>
      <PageHeading
        title={tr("Ordini da confermare")}
        description={tr(
          "Ordini cliente ricevuti da GommaRush. Nessun ordine viene inviato automaticamente ai fornitori."
        )}
      />
      {unavailable ? (
        <div className="rounded-xl border border-ink/10 bg-white p-5 text-ink-soft">
          {tr("Il modulo vendite non è ancora attivato nel database.")}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-ink/10 bg-white p-8 text-center text-ink-soft">
          {tr("Nessun ordine da confermare.")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
          {orders.map((order) => {
            const snapshot = (order.customer_snapshot ?? {}) as Record<string, string | null>;
            return (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 p-4 last:border-0"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/sales-orders/${order.id}`}
                    className="font-bold hover:underline"
                  >
                    {formatSalesOrderNumber(order.order_number)} ·{" "}
                    {snapshot.legal_name || snapshot.name || tr("Cliente")}
                  </Link>
                  <div className="mt-1 text-sm text-ink-soft">
                    {new Date(order.requested_at).toLocaleString("it-IT")} ·{" "}
                    {order.fulfilment_class} · {order.payment_method}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <strong>{money(order.grand_total_cents, order.currency, tr("Da confermare"))}</strong>
                  <Button disabled title={tr("Ordinazione fornitore non ancora attiva")}>
                    {tr("Conferma e invia ordine")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

import Link from "next/link";
import { PageHeading } from "@/components/logistics/AdminShell";
import { listSalesOrders, type SalesOrderListFilter } from "@/lib/server/sales-order-workflow";
import { formatSalesOrderNumber, parseSalesOrderNumber } from "@/lib/commerce/order-number";
import { fulfilmentLabel } from "@/lib/commerce/fulfilment";
import {
  ADMIN_STATUS_LABELS,
  isSalesOrderStatus,
  PAYMENT_METHOD_LABELS,
  SALES_ORDER_STATUSES,
} from "@/lib/commerce/sales-order-status";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";

const money = (cents: number | null, currency: string, fallback: string) =>
  cents === null
    ? fallback
    : new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(cents / 100);

/**
 * Customer orders, by commercial status.
 *
 * "Da rivedere" (requested) is the default view and a queue — oldest first.
 * Every other status is a record, newest first. A GR number search jumps
 * straight to one order whatever its status.
 *
 * Nothing on this screen contacts a supplier.
 */
export default async function SalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const tr = getTr();
  const { status: rawStatus, q } = await searchParams;
  const orderNumber = parseSalesOrderNumber(q ?? null);
  const status: SalesOrderListFilter =
    orderNumber ? "all" : rawStatus === "all" ? "all" : isSalesOrderStatus(rawStatus) ? rawStatus : "requested";

  let orders: Awaited<ReturnType<typeof listSalesOrders>> = [];
  let unavailable = false;
  try {
    orders = await listSalesOrders({ status, orderNumber });
  } catch {
    unavailable = true;
  }

  const tabs: { value: SalesOrderListFilter; label: string }[] = [
    ...SALES_ORDER_STATUSES.map((s) => ({ value: s, label: ADMIN_STATUS_LABELS[s] })),
    { value: "all", label: "Tutti" },
  ];

  return (
    <>
      <PageHeading
        title={tr("Ordini clienti")}
        description={tr(
          "Ordini cliente ricevuti da GommaRush. Nessun ordine viene inviato automaticamente ai fornitori."
        )}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={tr("Stato ordine")} className="flex flex-wrap gap-1">
          {tabs.map((tab) => {
            const active = !orderNumber && tab.value === status;
            return (
              <Link
                key={tab.value}
                href={`/admin/sales-orders?status=${tab.value}`}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-[40px] items-center rounded-lg px-3 text-sm font-semibold ${
                  active ? "bg-accent text-white" : "bg-white text-ink-soft hover:text-ink"
                }`}
              >
                {tr(tab.label)}
              </Link>
            );
          })}
        </nav>
        <form action="/admin/sales-orders" className="flex gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="GR-001001"
            aria-label={tr("Cerca per numero ordine")}
            className="h-10 w-36 rounded-lg border border-ink/15 px-3 text-base outline-none focus:border-accent sm:text-sm"
          />
          <button type="submit" className="h-10 rounded-lg bg-accent px-3 text-sm font-semibold text-white">
            {tr("Cerca")}
          </button>
        </form>
      </div>

      {unavailable ? (
        <div className="rounded-xl border border-ink/10 bg-white p-5 text-ink-soft">
          {tr("Il modulo vendite non è ancora attivato nel database.")}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-ink/10 bg-white p-8 text-center text-ink-soft">
          {orderNumber ? tr("Nessun ordine con questo numero.") : tr("Nessun ordine in questo stato.")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
          {orders.map((order) => {
            const snapshot = (order.customer_snapshot ?? {}) as Record<string, string | null>;
            const service = fulfilmentLabel(order.fulfilment_class);
            const payment = PAYMENT_METHOD_LABELS[order.payment_method];
            return (
              <Link
                key={order.id}
                href={`/admin/sales-orders/${order.id}`}
                className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 p-4 last:border-0 hover:bg-surface-soft"
              >
                <div className="min-w-0">
                  <div className="font-bold">
                    {formatSalesOrderNumber(order.order_number)} ·{" "}
                    {snapshot.legal_name || snapshot.name || tr("Cliente")}
                  </div>
                  <div className="mt-1 text-sm text-ink-soft">
                    {new Date(order.requested_at).toLocaleString("it-IT")}
                    {service ? ` · ${tr(service)}` : ""}
                    {payment ? ` · ${tr(payment)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-md bg-surface-soft px-2 py-0.5 text-xs font-bold text-ink-soft">
                    {isSalesOrderStatus(order.status) ? tr(ADMIN_STATUS_LABELS[order.status]) : order.status}
                  </span>
                  <strong>{money(order.grand_total_cents, order.currency, tr("Da confermare"))}</strong>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

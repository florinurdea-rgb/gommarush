import Link from "next/link";
import { StandBadge } from "@/components/logistics/StandBadge";
import { OrderStatusBadge } from "@/components/logistics/StatusBadge";
import { ProgressBar } from "@/components/logistics/ProgressBar";
import { OrderActionsMenu } from "@/components/logistics/OrderActionsMenu";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { t } from "@/lib/i18n/logistics";
import type { OrderListRow } from "@/lib/server/orders";

/**
 * The active-orders table. The STAND is the key warehouse indicator, so it gets
 * the first column and a large badge — it is what someone is looking for when
 * they glance at this screen.
 *
 * Responsive strategy: a real table on desktop (scannable rows, aligned
 * columns) and stacked cards below `md`, because a horizontally-scrolling table
 * on a tablet is unusable in a warehouse.
 */

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short" }).format(date);
}

interface OrdersTableProps {
  orders: OrderListRow[];
  variant: "active" | "hold";
}

export function OrdersTable({ orders, variant }: OrdersTableProps) {
  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink/20 bg-white px-6 py-14 text-center">
        <p className="text-base font-semibold text-ink">{t("noOrders")}</p>
        <p className="mt-1 text-sm text-ink-soft">
          {variant === "active"
            ? "Adaugă o comandă pentru a începe."
            : "Nicio comandă în așteptare."}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-hidden rounded-xl border border-ink/10 bg-white shadow-card md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-ink/10 bg-surface-soft text-xs uppercase tracking-wide text-ink-soft">
              <th scope="col" className="w-24 px-4 py-3 font-semibold">{t("stand")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("orderNumber")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("customer")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("itemCount")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("driverVehicle")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("status")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("plannedDate")}</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">{t("actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/5">
            {orders.map((order) => (
              <tr key={order.id} className="align-middle hover:bg-surface-soft/60">
                <td className="px-4 py-3">
                  <StandBadge standCode={order.stand_code} size="md" />
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="font-mono text-sm font-bold text-accent hover:underline"
                  >
                    {formatOrderNumber(order.order_number)}
                  </Link>
                  {order.supplier_document_number && (
                    <div className="text-xs text-ink-soft">{order.supplier_document_number}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-ink">{order.customer_name ?? "—"}</div>
                  {order.customer_city && (
                    <div className="text-xs text-ink-soft">{order.customer_city}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <ProgressBar
                    progress={order.progress}
                    metric={order.progress.loaded > 0 ? "loaded" : "stored"}
                    className="w-28"
                  />
                </td>
                <td className="px-4 py-3 text-sm">
                  <div className="text-ink">{order.driver_name ?? "—"}</div>
                  <div className="text-xs text-ink-soft">{order.vehicle_name ?? "—"}</div>
                </td>
                <td className="px-4 py-3">
                  <OrderStatusBadge status={order.status} size="sm" />
                </td>
                <td className="px-4 py-3 text-sm text-ink">
                  {formatDate(order.planned_delivery_date)}
                </td>
                <td className="px-4 py-3 text-right">
                  <OrderActionsMenu
                    orderId={order.id}
                    orderLabel={formatOrderNumber(order.order_number)}
                    variant={variant}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tablet / phone */}
      <div className="space-y-3 md:hidden">
        {orders.map((order) => (
          <div key={order.id} className="rounded-xl border border-ink/10 bg-white p-4 shadow-card">
            <div className="flex items-start gap-3">
              <StandBadge standCode={order.stand_code} size="lg" />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="font-mono text-base font-bold text-accent"
                >
                  {formatOrderNumber(order.order_number)}
                </Link>
                <div className="truncate font-semibold text-ink">
                  {order.customer_name ?? "—"}
                </div>
                <div className="mt-1">
                  <OrderStatusBadge status={order.status} size="sm" />
                </div>
              </div>
              <OrderActionsMenu
                orderId={order.id}
                orderLabel={formatOrderNumber(order.order_number)}
                variant={variant}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs uppercase text-ink-soft">{t("itemCount")}</div>
                <ProgressBar
                  progress={order.progress}
                  metric={order.progress.loaded > 0 ? "loaded" : "stored"}
                />
              </div>
              <div>
                <div className="text-xs uppercase text-ink-soft">{t("driverVehicle")}</div>
                <div className="text-ink">{order.driver_name ?? "—"}</div>
                <div className="text-xs text-ink-soft">{order.vehicle_name ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-ink-soft">{t("plannedDate")}</div>
                <div className="text-ink">{formatDate(order.planned_delivery_date)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

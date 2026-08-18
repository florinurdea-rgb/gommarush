"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OrderStatusBadge } from "@/components/logistics/StatusBadge";
import { PrepareOrderModal } from "@/components/logistics/PrepareOrderModal";
import { TyreIcon } from "@/components/logistics/TyreIcon";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import type { OrderListRow } from "@/lib/server/orders";

export function PrepareOrdersList({ orders }: { orders: OrderListRow[] }) {
  const router = useRouter();
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  if (orders.length === 0) {
    return (
      <p className="rounded-xl border border-ink/10 bg-white p-6 text-center text-sm text-ink-soft">
        Nicio comandă de pregătit — toate sunt fie în așteptarea mărfii, fie deja încărcate.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {orders.map((order) => (
          <div
            key={order.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-ink/10 bg-white px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-ink-soft">
                  {formatOrderNumber(order.order_number)}
                </span>
                <OrderStatusBadge status={order.status} size="sm" />
              </div>
              <div className="truncate text-sm font-bold text-ink">{order.customer_name ?? "—"}</div>
              <div className="truncate text-xs text-ink-soft">
                {order.customer_address ?? "Adresă necunoscută"}
                {order.supplier_name ? ` · ${order.supplier_name}` : ""}
              </div>
            </div>
            <div className="flex flex-none items-center gap-1 text-sm font-semibold text-ink">
              <TyreIcon className="h-4 w-4 text-ink-soft" />
              {order.tyre_count}
            </div>
            <button
              type="button"
              onClick={() => setOpenOrderId(order.id)}
              className="h-10 flex-none rounded-xl bg-accent px-4 text-sm font-bold text-white hover:bg-accent-dark"
            >
              Pregătește comanda
            </button>
          </div>
        ))}
      </div>

      {openOrderId && (
        <PrepareOrderModal
          orderId={openOrderId}
          onClose={() => setOpenOrderId(null)}
          onPrepared={() => router.refresh()}
        />
      )}
    </>
  );
}

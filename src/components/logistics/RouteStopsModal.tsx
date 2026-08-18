"use client";

import { Modal, ModalHeader } from "@/components/ui/Modal";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import type { OrderListRow } from "@/lib/server/orders";

/**
 * "Hartă" — the stop points for one vehicle's route, in delivery order.
 *
 * Honest scope: there is no geocoding/mapping API wired up yet (see the
 * conversation about which provider to use — Google Maps, Mapbox, or a
 * free OpenStreetMap+Nominatim setup), so this shows the actual stop
 * points — address, customer, order — as an ordered list rather than a
 * fabricated or misleading map. It becomes a visual map once that choice
 * is made, with the same ordering.
 */
export function RouteStopsModal({
  vehicleName,
  orders,
  onClose,
}: {
  vehicleName: string;
  orders: OrderListRow[];
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} size="md" label={`Puncte de oprire — ${vehicleName}`}>
      <ModalHeader title={`Puncte de oprire — ${vehicleName}`} onClose={onClose} />
      <div className="p-6">
        <p className="mb-4 text-xs text-ink-soft">
          Ordinea de livrare curentă. Vizualizare hartă în curând — vezi nota de mai jos.
        </p>

        {orders.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-soft">Nicio comandă pe această mașină.</p>
        ) : (
          <ol className="space-y-3">
            {orders.map((order, index) => (
              <li key={order.id} className="flex gap-3 rounded-xl border border-ink/10 bg-white p-3">
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent-light text-xs font-bold text-accent-dark">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-ink-soft">
                      {formatOrderNumber(order.order_number)}
                    </span>
                    <span className="truncate text-sm font-bold text-ink">{order.customer_name ?? "—"}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-soft">
                    {order.customer_address ?? "Adresă necunoscută"}
                    {order.customer_city ? `, ${order.customer_city}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-5 rounded-lg bg-surface-soft p-3 text-xs leading-relaxed text-ink-soft">
          O hartă vizuală cu aceste opriri necesită un API de geocodare/hărți (Google Maps, Mapbox sau
          OpenStreetMap gratuit). Confirmă opțiunea preferată ca să o activăm.
        </div>
      </div>
    </Modal>
  );
}

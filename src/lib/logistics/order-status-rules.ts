import { ACTIVE_ORDER_STATUSES } from "@/lib/types/logistics";
import type { OrderStatus } from "@/lib/types/logistics";

/**
 * Statuses excluded from the generic manual override (the Livrări board's
 * "Schimbă statusul" menu / setOrderStatusManually()) because each one
 * carries a required side effect a plain status write would skip:
 *   - 'loaded' needs a vehicle + loaded_at -> markOrderLoaded()
 *     (gorush_mark_order_loaded)
 *   - 'delivered' / 'partially_delivered' need delivered_at + payment
 *     recording -> deliverOrder() (gorush_deliver_order)
 * 'cancelled' already has its own "Șterge" action; 'draft'/
 * 'review_required' don't apply to an order that already made it onto
 * the board.
 *
 * Shared between the server guard (src/lib/server/orders.ts) and the
 * client menu (VehicleCardActionsMenu.tsx) so the two can never drift —
 * previously each kept its own copy of this list.
 */
export const MANUAL_STATUS_EXCLUDED: readonly OrderStatus[] = ["loaded", "delivered", "partially_delivered"];

export function isManuallySettableStatus(status: OrderStatus): boolean {
  return (ACTIVE_ORDER_STATUSES as readonly OrderStatus[]).includes(status) && !MANUAL_STATUS_EXCLUDED.includes(status);
}

export const MANUALLY_SETTABLE_STATUSES: readonly OrderStatus[] = ACTIVE_ORDER_STATUSES.filter(isManuallySettableStatus);

import type { DriverOrderSummary } from "@/lib/server/loading";

/** "TODAY": aggregate summary across a driver's whole run. Pure — no DB access — so it's directly testable. */
export function summariseDriverDay(orders: readonly DriverOrderSummary[]): {
  orderCount: number;
  tyreCount: number;
  codTotal: number;
  deliveredCount: number;
  remainingCount: number;
} {
  const orderCount = orders.length;
  const tyreCount = orders.reduce((sum, order) => sum + order.tyre_count, 0);
  const codTotal = orders.reduce(
    (sum, order) => sum + (order.cash_on_delivery ? (order.amount_to_collect ?? 0) : 0),
    0
  );
  const deliveredCount = orders.filter((order) => order.status === "delivered").length;
  return { orderCount, tyreCount, codTotal, deliveredCount, remainingCount: orderCount - deliveredCount };
}

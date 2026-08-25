import "server-only";
import { getOrderDetail, markOrderPrepared } from "@/lib/server/orders";
import { logEvent } from "@/lib/logger";

/**
 * "Prepara l'ordine" — the office confirms an order's tyres are ready to
 * leave the warehouse, and the order advances to `ready_for_loading`.
 *
 * This used to also queue one thermal label per physical unit onto a
 * print_jobs table polled by a separate desktop Print Agent. That queue and
 * the agent have been removed; the office prints the order summary from the
 * browser instead, which needs no background service and no extra table.
 */

export interface PrepareOrderResult {
  ok: boolean;
  code: string;
}

export async function prepareOrder(input: {
  orderId: string;
  changedBy: string;
}): Promise<PrepareOrderResult> {
  const detail = await getOrderDetail(input.orderId);
  if (!detail) return { ok: false, code: "ORDER_NOT_FOUND" };

  const statusResult = await markOrderPrepared(input.orderId, input.changedBy);
  if (!statusResult.ok) {
    return { ok: false, code: statusResult.code ?? "STATUS_CHANGE_FAILED" };
  }

  logEvent("order_prepared", { orderId: input.orderId });
  return { ok: true, code: "PREPARED" };
}

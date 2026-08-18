import "server-only";
import { getOrderDetail, markOrderPrepared } from "@/lib/server/orders";
import { createPrintJob } from "@/lib/server/print-jobs";
import { buildLabelData } from "@/lib/logistics/label";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { logError, logEvent } from "@/lib/logger";
import type { LabelData } from "@/lib/types/logistics";

/**
 * "Pregătește comanda" — the office confirms an order's tyres are ready to
 * leave the warehouse. Optionally queues a shipping label per physical
 * unit (reusing the same print_jobs queue the GoRush Print Agent already
 * polls, just with a richer payload — see the deliberate supplier/
 * delivery_address exception in src/lib/logistics/label.ts), then advances
 * the order to `ready_for_loading` either way.
 */

export interface PrepareOrderResult {
  ok: boolean;
  code: string;
  labelsQueued: number;
  labelsFailed: number;
}

export async function prepareOrder(input: {
  orderId: string;
  changedBy: string;
  printLabels: boolean;
}): Promise<PrepareOrderResult> {
  const detail = await getOrderDetail(input.orderId);
  if (!detail) return { ok: false, code: "ORDER_NOT_FOUND", labelsQueued: 0, labelsFailed: 0 };

  let labelsQueued = 0;
  let labelsFailed = 0;

  if (input.printLabels) {
    const itemsById = new Map(detail.items.map((item) => [item.id, item]));
    const customerName = detail.customer?.name ?? detail.order.delivery_name ?? null;
    const supplierName = detail.supplier?.name ?? null;
    const addressLine = [
      detail.order.delivery_address_line1 ?? detail.location?.address_line1,
      detail.order.delivery_city ?? detail.location?.city,
    ]
      .filter(Boolean)
      .join(", ");

    for (const unit of detail.units) {
      const item = itemsById.get(unit.order_item_id);
      if (!item) continue;

      try {
        const baseLabel = buildLabelData({
          inventoryUnitId: unit.id,
          unitToken: unit.qr_token,
          unitIndex: unit.unit_sequence,
          orderNumber: formatOrderNumber(detail.order.order_number),
          standCode: detail.order.stand_code,
          customerName,
          item,
        });
        const label: LabelData = {
          ...baseLabel,
          supplier: supplierName ?? undefined,
          delivery_address: addressLine || undefined,
        };

        await createPrintJob({ inventoryUnitId: unit.id, orderId: detail.order.id, labelData: label });
        labelsQueued += 1;
      } catch (error) {
        labelsFailed += 1;
        logError("prepare_order_label_failed", error, { orderId: input.orderId, unitId: unit.id });
      }
    }
  }

  const statusResult = await markOrderPrepared(input.orderId, input.changedBy);
  if (!statusResult.ok) {
    return { ok: false, code: statusResult.code ?? "STATUS_CHANGE_FAILED", labelsQueued, labelsFailed };
  }

  logEvent("order_prepared", {
    orderId: input.orderId,
    labelsQueued,
    labelsFailed,
    printed: input.printLabels,
  });

  return { ok: true, code: "PREPARED", labelsQueued, labelsFailed };
}

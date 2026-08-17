import { NextRequest } from "next/server";
import { updateOrderItemSchema } from "@/lib/validation/logistics";
import { updateOrderItem } from "@/lib/server/orders";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; itemId: string }>;
}

/**
 * PATCH an order line. Quantity is deliberately NOT editable here: inventory
 * units already exist and may have been scanned, so changing the count needs a
 * reconciliation path of its own (Phase 2). raw_description is likewise never
 * overwritten — the document's own text stays as extracted.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  return runAdminRoute(async () => {
    const { itemId } = await context.params;
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = updateOrderItemSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    await updateOrderItem(itemId, parsed.data);
    return ok({ itemId });
  });
}

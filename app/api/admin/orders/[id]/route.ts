import { NextRequest } from "next/server";
import { orderActionSchema, updateOrderSchema } from "@/lib/validation/logistics";
import {
  assignStand,
  cancelOrder,
  holdOrder,
  reactivateOrder,
  updateOrder,
} from "@/lib/server/orders";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** PATCH — edit the order's editable fields. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  return runAdminRoute(async () => {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = updateOrderSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    await updateOrder(id, parsed.data);
    return ok({ orderId: id });
  });
}

/**
 * POST — lifecycle actions: hold, reactivate, cancel, assign stand.
 *
 * These are separate from PATCH because each one is a state transition with its
 * own rules and its own history entry, not a field edit.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  return runAdminRoute(async (session) => {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = orderActionSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));
    const { action, reason, stand_code, planned_delivery_date } = parsed.data;

    switch (action) {
      case "hold": {
        const result = await holdOrder(id, reason ?? null, session.subject);
        if (!result.ok) return fail(400, result.code ?? "UNKNOWN");
        return ok({ orderId: id, status: "on_hold" });
      }
      case "reactivate": {
        const result = await reactivateOrder(id, {
          plannedDeliveryDate: planned_delivery_date ?? null,
          changedBy: session.subject,
        });
        if (!result.ok) return fail(400, result.code ?? "UNKNOWN");
        // A reactivated order may not get its old stand back — say so.
        return ok({ orderId: id, standWarning: result.standWarning ?? null });
      }
      case "cancel": {
        const result = await cancelOrder(id, reason ?? null, session.subject);
        if (!result.ok) return fail(400, result.code ?? "UNKNOWN");
        return ok({ orderId: id, status: "cancelled" });
      }
      case "assign_stand": {
        const result = await assignStand(id, stand_code ?? null, session.subject);
        if (!result.ok) return fail(409, result.code ?? "STAND_OCCUPIED");
        return ok({ orderId: id, standCode: stand_code ?? null });
      }
      default:
        return fail(400, "VALIDATION_FAILED");
    }
  });
}

/**
 * DELETE — "Șterge" in the Admin UI.
 *
 * Phase 1 makes this a SAFE CANCELLATION, never a SQL DELETE: the order leaves
 * the active dashboard but its items, inventory units, scan history and status
 * history are all preserved. A true delete needs an explicit future decision.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  return runAdminRoute(async (session) => {
    const { id } = await context.params;
    const reason = new URL(request.url).searchParams.get("reason");

    const result = await cancelOrder(id, reason, session.subject);
    if (!result.ok) return fail(400, result.code ?? "UNKNOWN");
    return ok({ orderId: id, status: "cancelled", softDeleted: true });
  });
}

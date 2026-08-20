import { NextRequest } from "next/server";
import { deliveryFailedSchema } from "@/lib/validation/logistics";
import { markDeliveryFailed } from "@/lib/server/loading";
import { fail, ok, readJsonBody, runDriverRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST /api/driver/delivery-failed — the delivery exception path.
 *
 * A reason is mandatory. The order returns to an explicit attention state
 * (on_hold) rather than a new status — see the Phase 1 stabilisation
 * brief §21.
 */
export async function POST(request: NextRequest) {
  return runDriverRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = deliveryFailedSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const result = await markDeliveryFailed({
      orderId: parsed.data.order_id,
      driverId: session.driverId,
      operator: `driver:${session.driverName}`,
      reason: parsed.data.reason,
    });

    if (!result.ok) return fail(409, result.code);
    return ok({ result });
  });
}

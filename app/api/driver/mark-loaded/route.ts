import { NextRequest } from "next/server";
import { markLoadedSchema } from "@/lib/validation/logistics";
import { markOrderLoaded } from "@/lib/server/loading";
import { fail, ok, readJsonBody, runDriverRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST /api/driver/mark-loaded — "MARK AS LOADED", one tap per order.
 *
 * Order-level, transactional, idempotent — no tyre scanning. The vehicle
 * comes from the driver's own session unless the order already has one.
 */
export async function POST(request: NextRequest) {
  return runDriverRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = markLoadedSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const result = await markOrderLoaded({
      orderId: parsed.data.order_id,
      vehicleId: parsed.data.vehicle_id ?? session.vehicleId,
      operator: `driver:${session.driverName}`,
    });

    if (!result.ok) return fail(409, result.code);
    return ok({ result });
  });
}

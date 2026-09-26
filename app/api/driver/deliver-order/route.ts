import { NextRequest } from "next/server";
import { deliverOrderSchema } from "@/lib/validation/logistics";
import { deliverOrder } from "@/lib/server/loading";
import { fail, ok, readJsonBody, runDriverRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST /api/driver/deliver-order — "Marchează comanda ca livrată".
 *
 * The driver identity comes from the server-side session, never the
 * request body — same rule as every other driver route — so a phone can
 * only deliver its own assigned orders. Optionally records the COD amount
 * collected in the same transactional call.
 */
export async function POST(request: NextRequest) {
  return runDriverRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = deliverOrderSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const result = await deliverOrder({
      orderId: parsed.data.order_id,
      driverId: session.driverId,
      operator: `driver:${session.driverName}`,
      amountCollected: parsed.data.amount_collected ?? null,
      paymentMethod: parsed.data.payment_method ?? null,
    });

    if (!result.ok) return fail(409, result.code);
    return ok({ result });
  });
}

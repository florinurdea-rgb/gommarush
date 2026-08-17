import { NextRequest } from "next/server";
import { barcodeScanSchema } from "@/lib/validation/logistics";
import { loadUnitByToken } from "@/lib/server/loading";
import { fail, ok, readJsonBody, runDriverRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST /api/driver/load — loading scan into the van.
 *
 * The driver identity comes from the signed session cookie, never the body, so
 * the wrong-item protection cannot be bypassed by a crafted request.
 *
 * A wrong-driver scan returns HTTP 200 with `ok: false` and code WRONG_DRIVER:
 * the client needs the order/customer context to render the red
 * "OBIECT GREȘIT — Acest produs aparține altei livrări" screen, and the attempt
 * is recorded as a rejected scan either way.
 */
export async function POST(request: NextRequest) {
  return runDriverRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = barcodeScanSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const result = await loadUnitByToken({
      unitToken: parsed.data.unit_token,
      driverId: session.driverId,
      vehicleId: session.vehicleId,
      operator: `driver:${session.driverName}`,
      idempotencyKey: parsed.data.idempotency_key ?? null,
    });

    if (result.code === "UNIT_NOT_FOUND") return fail(404, "UNIT_NOT_FOUND");
    return ok({ result });
  });
}

import { NextRequest } from "next/server";
import { barcodeScanSchema } from "@/lib/validation/logistics";
import { storeUnitByToken } from "@/lib/server/receiving";
import { fail, ok, readJsonBody, runWarehouseRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST /api/warehouse/store — the printed GoRush barcode scan that confirms
 * physical storage.
 *
 * Returns HTTP 200 for duplicates rather than an error: rescanning an item is a
 * normal warehouse event, and the operator needs a clear
 * "Obiect deja înregistrat ca depozitat" message, not a failure. The `ok` flag
 * in the body is what tells the client whether to play the success sound.
 */
export async function POST(request: NextRequest) {
  return runWarehouseRoute(async (operator) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = barcodeScanSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const result = await storeUnitByToken({
      unitToken: parsed.data.unit_token,
      operator,
      zoneId: parsed.data.zone_id ?? null,
      idempotencyKey: parsed.data.idempotency_key ?? null,
    });

    if (result.code === "UNIT_NOT_FOUND") return fail(404, "UNIT_NOT_FOUND");
    return ok({ result });
  });
}

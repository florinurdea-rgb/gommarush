import { NextRequest } from "next/server";
import { manualLoadSchema } from "@/lib/validation/logistics";
import { manualLoadUnit } from "@/lib/server/loading";
import { fail, ok, readJsonBody, runDriverRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST /api/driver/manual-load — "Adaugă manual ca încărcat".
 *
 * Exception path only (damaged label, dead scanner). The reason is mandatory,
 * and the resulting scan is stored as `manual_loading` with `manual = true`, so
 * it is never indistinguishable from a real barcode scan.
 */
export async function POST(request: NextRequest) {
  return runDriverRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = manualLoadSchema.safeParse(body);
    if (!parsed.success) return fail(400, "REASON_REQUIRED", zodDetails(parsed.error));

    const result = await manualLoadUnit({
      inventoryUnitId: parsed.data.inventory_unit_id,
      driverId: session.driverId,
      vehicleId: session.vehicleId,
      reason: parsed.data.reason,
      operator: `driver:${session.driverName}`,
    });

    if (!result.ok) return fail(409, result.code);
    return ok({ result });
  });
}

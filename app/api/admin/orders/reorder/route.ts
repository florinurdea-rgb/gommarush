import { NextRequest } from "next/server";
import { reorderOrdersSchema } from "@/lib/validation/logistics";
import { reorderVehicleColumn } from "@/lib/server/orders";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST — the vehicle board's drag-and-drop write path. Body is always the
 * TARGET column's full new order (see reorderVehicleColumn for why this one
 * shape covers both "reordered within a column" and "moved to another
 * column").
 */
export async function POST(request: NextRequest) {
  return runAdminRoute(async () => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = reorderOrdersSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    await reorderVehicleColumn(parsed.data.vehicleId, parsed.data.orderedOrderIds);
    return ok({});
  });
}

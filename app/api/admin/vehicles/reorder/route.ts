import { NextRequest } from "next/server";
import { reorderVehiclesSchema } from "@/lib/validation/logistics";
import { reorderVehicles } from "@/lib/server/reference";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return runAdminRoute(async () => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = reorderVehiclesSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    await reorderVehicles(parsed.data.orderedVehicleIds);
    return ok({});
  });
}

import { NextRequest } from "next/server";
import { renameVehicleSchema } from "@/lib/validation/logistics";
import { renameVehicle } from "@/lib/server/reference";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return runAdminRoute(async () => {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = renameVehicleSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    await renameVehicle(id, parsed.data.name);
    return ok({ vehicleId: id });
  });
}

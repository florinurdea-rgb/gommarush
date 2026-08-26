import { NextRequest } from "next/server";
import { driverVehicleSchema } from "@/lib/validation/logistics";
import { setDriverVehicle } from "@/lib/auth/driver-session";
import { getVehicle } from "@/lib/server/reference";
import { fail, ok, readJsonBody, runDriverRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST /api/driver/session — pick today's van.
 *
 * Identity is never in the body: runDriverRoute() already resolved it
 * from the authenticated Supabase session, so this can only ever change
 * the vehicle for the driver making the request.
 */
export async function POST(request: NextRequest) {
  return runDriverRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = driverVehicleSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const vehicle = parsed.data.vehicle_id ? await getVehicle(parsed.data.vehicle_id) : null;
    if (parsed.data.vehicle_id && !vehicle) return fail(404, "VEHICLE_NOT_FOUND");

    await setDriverVehicle(session.driverId, vehicle?.id ?? null);

    return ok({ vehicle: vehicle ? { id: vehicle.id, name: vehicle.name } : null });
  });
}

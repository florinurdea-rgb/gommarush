import { NextRequest, NextResponse } from "next/server";
import { driverSessionSchema } from "@/lib/validation/logistics";
import {
  clearedDriverSessionCookie,
  createDriverSession,
  driverSessionCookie,
  isDriverSigningSecretMissingInProduction,
} from "@/lib/auth/driver-session";
import { getDriver, getVehicle } from "@/lib/server/reference";
import { fail, handleRouteError, readJsonBody } from "@/lib/server/route-helpers";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Phase 1 driver session: the operator picks who they are and which van they
 * are driving. Simplified by design (see src/lib/auth/driver-session.ts), but
 * still issued as a signed server-side cookie so every scan endpoint reads the
 * driver identity from one trusted place instead of the request body.
 */
export async function POST(request: NextRequest) {
  try {
    // Same concern as /api/admin/login: an unstable per-instance secret would
    // make the session silently fail verification on the next request.
    if (isDriverSigningSecretMissingInProduction()) {
      logEvent("driver_session_blocked_missing_secret", {});
      return fail(500, "ADMIN_SESSION_SECRET_MISSING");
    }

    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = driverSessionSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED");

    // Both are verified against the database: a made-up id must not produce a
    // usable session.
    const driver = await getDriver(parsed.data.driver_id);
    if (!driver || !driver.active) return fail(404, "DRIVER_NOT_FOUND");

    const vehicle = parsed.data.vehicle_id ? await getVehicle(parsed.data.vehicle_id) : null;
    if (parsed.data.vehicle_id && !vehicle) return fail(404, "VEHICLE_NOT_FOUND");

    const session = createDriverSession({
      driverId: driver.id,
      driverName: driver.name,
      vehicleId: vehicle?.id ?? null,
      vehicleName: vehicle?.name ?? null,
    });

    logEvent("driver_session_started", { driverId: driver.id, vehicleId: vehicle?.id ?? "none" });

    const response = NextResponse.json({
      ok: true,
      driver: { id: driver.id, name: driver.name },
      vehicle: vehicle ? { id: vehicle.id, name: vehicle.name } : null,
    });
    response.cookies.set(driverSessionCookie(session));
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(clearedDriverSessionCookie());
  return response;
}

import { removeVehicle } from "@/lib/server/reference";
import { fail, ok, runAdminRoute } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Safe removal (redesign brief §17-19): every active order on this vehicle
 * is reassigned to Neasignate and the vehicle is soft-deactivated — see
 * gorush_remove_vehicle. No confirmation payload needed: the confirmation
 * itself already happened client-side (the fleet sheet shows "Van 4 are 6
 * ordini asignate" before this request ever fires).
 */
export async function POST(_request: Request, context: RouteContext) {
  return runAdminRoute(async (session) => {
    const { id } = await context.params;
    const result = await removeVehicle(id, session.subject);

    if (!result.ok) {
      if (result.code === "VEHICLE_NOT_FOUND") return fail(404, "VEHICLE_NOT_FOUND");
      if (result.code === "ALREADY_REMOVED") return fail(409, "ALREADY_REMOVED");
      return fail(500, result.code || "VEHICLE_REMOVE_FAILED");
    }

    return ok({ vehicleId: id, reassignedOrders: result.reassignedOrders });
  });
}

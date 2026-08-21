import { NextRequest } from "next/server";
import { routeMapSchema } from "@/lib/validation/logistics";
import { geocodeAddresses } from "@/lib/server/geocoding";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST — geocodes one vehicle's stops (in delivery order) for the "Hartă"
 * modal. A stop whose address can't be geocoded comes back with point: null
 * so the map can still show the rest and the modal's list can flag it,
 * instead of the whole request failing.
 */
export async function POST(request: NextRequest) {
  return runAdminRoute(async () => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = routeMapSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const geocoded = await geocodeAddresses(parsed.data.stops.map((stop) => stop.address));

    const points = parsed.data.stops.map((stop) => {
      const point = geocoded.get(stop.address.trim()) ?? null;
      return { orderId: stop.orderId, lat: point?.lat ?? null, lng: point?.lng ?? null };
    });

    return ok({ points });
  });
}

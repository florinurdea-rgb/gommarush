import { NextRequest } from "next/server";
import { createVehicleSchema } from "@/lib/validation/logistics";
import { createVehicle, listVehicles } from "@/lib/server/reference";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fleet management sheet reads every vehicle (including deactivated ones) so past removals stay visible there. */
export async function GET() {
  return runAdminRoute(async () => {
    return ok({ vehicles: await listVehicles(false) });
  });
}

export async function POST(request: NextRequest) {
  return runAdminRoute(async () => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = createVehicleSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const vehicle = await createVehicle({ name: parsed.data.name, registration: parsed.data.registration ?? null });
    return ok({ vehicle }, 201);
  });
}

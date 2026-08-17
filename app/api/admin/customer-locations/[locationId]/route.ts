import { NextRequest } from "next/server";
import { customerLocationSchema } from "@/lib/validation/logistics";
import { updateCustomerLocation } from "@/lib/server/customers";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ locationId: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return runAdminRoute(async () => {
    const { locationId } = await context.params;
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = customerLocationSchema.partial().safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    await updateCustomerLocation(locationId, parsed.data);
    return ok({ locationId });
  });
}

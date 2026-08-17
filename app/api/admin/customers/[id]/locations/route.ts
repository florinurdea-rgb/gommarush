import { NextRequest } from "next/server";
import { customerLocationSchema } from "@/lib/validation/logistics";
import { createCustomerLocation } from "@/lib/server/customers";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Adds a delivery branch. One company can have many locations. */
export async function POST(request: NextRequest, context: RouteContext) {
  return runAdminRoute(async () => {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = customerLocationSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const location = await createCustomerLocation(id, parsed.data);
    return ok({ location }, 201);
  });
}

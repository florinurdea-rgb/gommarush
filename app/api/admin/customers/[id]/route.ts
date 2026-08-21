import { NextRequest } from "next/server";
import { customerSchema } from "@/lib/validation/logistics";
import { getCustomerWithLocations, updateCustomer } from "@/lib/server/customers";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  return runAdminRoute(async () => {
    const { id } = await context.params;
    const result = await getCustomerWithLocations(id);
    if (!result) return fail(404, "CUSTOMER_NOT_FOUND");
    return ok(result);
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return runAdminRoute(async () => {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = customerSchema.partial().safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    await updateCustomer(id, parsed.data);
    return ok({ customerId: id });
  });
}

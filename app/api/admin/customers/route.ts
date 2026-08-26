import { NextRequest } from "next/server";
import { customerSchema } from "@/lib/validation/logistics";
import { createCustomer, listCustomers } from "@/lib/server/customers";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
// Reads the session cookie, so it can never be statically rendered.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runAdminRoute(async () => {
    const search = new URL(request.url).searchParams.get("q") ?? undefined;
    return ok({ customers: await listCustomers(search) });
  });
}

export async function POST(request: NextRequest) {
  return runAdminRoute(async () => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = customerSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const customer = await createCustomer(parsed.data);
    return ok({ customer }, 201);
  });
}

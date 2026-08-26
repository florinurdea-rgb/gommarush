import { NextRequest } from "next/server";
import { supplierSchema } from "@/lib/validation/logistics";
import { createSupplier, listSuppliersWithCounts } from "@/lib/server/suppliers";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runAdminRoute(async () => {
    const search = new URL(request.url).searchParams.get("q") ?? undefined;
    return ok({ suppliers: await listSuppliersWithCounts(search) });
  });
}

export async function POST(request: NextRequest) {
  return runAdminRoute(async () => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = supplierSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const supplier = await createSupplier(parsed.data);
    return ok({ supplier }, 201);
  });
}

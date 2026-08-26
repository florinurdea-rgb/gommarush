import { NextRequest } from "next/server";
import { supplierSchema } from "@/lib/validation/logistics";
import { getSupplier, updateSupplier } from "@/lib/server/suppliers";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  return runAdminRoute(async () => {
    const { id } = await context.params;
    const supplier = await getSupplier(id);
    if (!supplier) return fail(404, "SUPPLIER_NOT_FOUND");
    return ok({ supplier });
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return runAdminRoute(async () => {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = supplierSchema.partial().safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    await updateSupplier(id, parsed.data);
    return ok({ supplierId: id });
  });
}

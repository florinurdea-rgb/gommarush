import { NextRequest } from "next/server";
import { searchExpected } from "@/lib/server/receiving";
import { fail, ok, runDriverRoute } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
// Reads the session cookie, so it can never be statically rendered.
export const dynamic = "force-dynamic";

/**
 * Manual search fallback for an uncertain scan. Matches on order number,
 * customer name, brand, model, tyre size and supplier SKU across ACTIVE
 * expected orders only — never arbitrary history.
 */
export async function GET(request: NextRequest) {
  return runDriverRoute(async () => {
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 1 || query.length > 100) return fail(400, "VALIDATION_FAILED");

    const lines = await searchExpected(query);
    return ok({
      lines: lines.map((line) => ({
        orderItemId: line.orderItemId,
        orderNumber: line.orderNumber,
        customerName: line.customerName,
        supplierName: line.supplierName,
        standCode: line.standCode,
        description: line.item.description ?? line.item.raw_description,
        brand: line.item.brand,
        supplierSku: line.item.supplier_sku,
        unitsExpected: line.unitsExpected,
        plannedDeliveryDate: line.plannedDeliveryDate,
      })),
    });
  });
}

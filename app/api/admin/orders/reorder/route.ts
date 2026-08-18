import { NextRequest } from "next/server";
import { reorderOrdersSchema } from "@/lib/validation/logistics";
import { reorderVehicleColumn } from "@/lib/server/orders";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST — the vehicle board's drag-and-drop write path. Body is always the
 * TARGET column's full new order (see reorderVehicleColumn for why this one
 * shape covers both "reordered within a column" and "moved to another
 * column").
 */
export async function POST(request: NextRequest) {
  return runAdminRoute(async () => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = reorderOrdersSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    try {
      await reorderVehicleColumn(parsed.data.vehicleId, parsed.data.orderedOrderIds);
    } catch (error) {
      // Surface the actual Postgres error instead of a blanket "UNKNOWN" —
      // this write has already failed the "Mutarea nu a putut fi salvată"
      // way once before (missing delivery_sequence column) and the generic
      // 500 gave no way to tell that apart from a genuinely new failure.
      logError("orders_reorder_failed", error);
      const pgError = error as { code?: string; message?: string } | null;
      return fail(500, "REORDER_FAILED", [
        pgError?.code ? `Postgres ${pgError.code}` : "eroare necunoscută",
        pgError?.message ?? "",
      ].filter(Boolean));
    }

    return ok({});
  });
}

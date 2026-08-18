import { getOrderDetail } from "@/lib/server/orders";
import { fail, ok, runAdminRoute } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET — the order-detail modal's data source (see OrderDetailModal.tsx).
 * Same data as the full /admin/orders/[id] page's server fetch, just
 * reachable from a client component so a dashboard card can open a quick
 * read-only view without a full page navigation.
 */
export async function GET(_request: Request, context: RouteContext) {
  return runAdminRoute(async () => {
    const { id } = await context.params;
    const detail = await getOrderDetail(id);
    if (!detail) return fail(404, "ORDER_NOT_FOUND");
    return ok({ detail });
  });
}

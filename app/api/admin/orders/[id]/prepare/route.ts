import { NextRequest } from "next/server";
import { prepareOrder } from "@/lib/server/prepare-order";
import { fail, ok, runAdminRoute } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST — "Prepara l'ordine": the order advances to `ready_for_loading`.
 *
 * Previously took a `printLabels` flag that decided whether to queue
 * thermal labels. The label queue is gone, so the request has no body: the
 * office prints the summary from the browser, which is a client-side
 * concern this endpoint never needed to know about.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  return runAdminRoute(async (session) => {
    const { id } = await context.params;

    const result = await prepareOrder({ orderId: id, changedBy: session.subject });

    if (!result.ok) return fail(409, result.code);
    return ok({ result });
  });
}

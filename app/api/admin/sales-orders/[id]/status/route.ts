import { NextRequest } from "next/server";
import { fail, ok, readJsonBody, runAdminRoute } from "@/lib/server/route-helpers";
import { TransitionError, transitionSalesOrder } from "@/lib/server/sales-order-workflow";

export const runtime = "nodejs";

/**
 * Moves one sales order along its commercial lifecycle.
 *
 * Body: `{ from, to, note? }`. `from` is the status the operator was looking
 * at; the database compare-and-sets on it, so a stale screen gets
 * STATUS_CONFLICT instead of overwriting someone else's decision.
 *
 * Admin-only (runAdminRoute). The actor recorded in the history is the
 * signed-in operator. Nothing here contacts a supplier.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return runAdminRoute(async (session) => {
    const { id } = await params;
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object") return fail(400, "VALIDATION_FAILED");
    const { from, to, note } = body as Record<string, unknown>;

    try {
      const result = await transitionSalesOrder({
        orderId: id,
        from,
        to,
        note,
        actorUserId: session.subject,
        actorLabel: session.displayName,
      });
      return ok(result);
    } catch (error) {
      if (error instanceof TransitionError) return fail(error.status, error.code);
      throw error;
    }
  });
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { prepareOrder } from "@/lib/server/prepare-order";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({ printLabels: z.boolean() }).strict();

/**
 * POST — "Tipărește și mută în progres" / "Mută fără tipărit". Either way
 * the order advances to `ready_for_loading`; printLabels controls whether
 * a shipping label is queued per physical unit first.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  return runAdminRoute(async (session) => {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const result = await prepareOrder({
      orderId: id,
      changedBy: session.subject,
      printLabels: parsed.data.printLabels,
    });

    if (!result.ok) return fail(409, result.code);
    return ok({ result });
  });
}

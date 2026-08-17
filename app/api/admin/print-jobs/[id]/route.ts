import { NextRequest } from "next/server";
import { printJobActionSchema } from "@/lib/validation/logistics";
import { retryPrintJob } from "@/lib/server/print-jobs";
import { fail, ok, readJsonBody, runAdminRoute } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Re-queues a failed (or stuck) print job. The label was never lost — the job
 * simply needs another attempt once the printer or agent is back.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  return runAdminRoute(async () => {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = printJobActionSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED");

    const result = await retryPrintJob(id);
    if (!result.ok) return fail(400, result.code);
    return ok({ jobId: id, code: result.code });
  });
}

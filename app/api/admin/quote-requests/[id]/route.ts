import { NextRequest } from "next/server";
import { z } from "zod";
import { updateQuoteStatusSchema } from "@/lib/validation/quote-request";
import { getQuoteRequest, updateQuoteRequestStatus } from "@/lib/server/quote-requests";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();

/**
 * PATCH /api/admin/quote-requests/[id] — change a request's status.
 *
 * Wrapped in runAdminRoute, which is the project's existing server-side
 * admin gate (real Supabase session + the ADMIN_ALLOWED_EMAILS allowlist) —
 * not a client-side isAdmin flag.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return runAdminRoute(async (session) => {
    if (!uuid.safeParse(params.id).success) return fail(400, "VALIDATION_FAILED");

    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = updateQuoteStatusSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const existing = await getQuoteRequest(params.id);
    if (!existing) return fail(404, "NOT_FOUND");

    await updateQuoteRequestStatus(params.id, parsed.data.status, session.displayName);
    return ok({ id: params.id, status: parsed.data.status });
  });
}

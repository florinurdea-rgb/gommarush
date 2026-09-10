import { NextRequest } from "next/server";
import { z } from "zod";
import { updateQuoteStatusSchema } from "@/lib/validation/quote-request";
import {
  deleteQuoteRequest,
  getQuoteRequest,
  updateQuoteRequestStatus,
} from "@/lib/server/quote-requests";
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

/**
 * DELETE /api/admin/quote-requests/[id] — remove a request permanently.
 *
 * A real hard delete: items and events go with it via ON DELETE CASCADE.
 * The lifecycle already has an `archived` status for "keep but hide", so a
 * soft delete here would be a second way to do the same thing; when someone
 * asks to delete a customer's data, the honest implementation removes it.
 *
 * Admin-gated through runAdminRoute. deleteQuoteRequest writes an audit
 * event with a NULL request id first, so the record that this reference
 * existed survives the cascade without keeping the contact details.
 */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  return runAdminRoute(async (session) => {
    if (!uuid.safeParse(params.id).success) return fail(400, "VALIDATION_FAILED");

    const result = await deleteQuoteRequest(params.id, session.displayName);
    if (!result.deleted) return fail(404, "NOT_FOUND");

    return ok({ deleted: true, reference: result.reference });
  });
}

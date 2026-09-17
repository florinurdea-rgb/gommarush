import { NextRequest } from "next/server";
import { z } from "zod";
import { getQuoteRequest } from "@/lib/server/quote-requests";
import { notifyQuoteRequest } from "@/lib/server/quote-request-notify";
import { describeEmailConfig } from "@/lib/email/send-quote-request";
import { fail, ok, runAdminRoute } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();

/**
 * POST /api/admin/quote-requests/[id]/resend-email — retry the internal
 * sales notification for one request.
 *
 * This exists because the notification is deliberately not the system of
 * record: when Resend is misconfigured or has a bad minute, the request is
 * still saved and the failure is recorded on the row. Without a retry, the
 * only way to get that notification out after fixing the configuration was
 * to ask the customer to submit again.
 *
 * Admin-gated through runAdminRoute (real Supabase session + allowlist) —
 * it sends mail and reveals the configured addresses, so it must never be
 * reachable by anyone holding a request UUID.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  return runAdminRoute(async (session) => {
    if (!uuid.safeParse(params.id).success) return fail(400, "VALIDATION_FAILED");

    const existing = await getQuoteRequest(params.id);
    if (!existing) return fail(404, "NOT_FOUND");

    const result = await notifyQuoteRequest(params.id, {
      manual: true,
      actor: session.displayName,
    });
    const config = describeEmailConfig();

    // A failed send is a successful API call that reports a failure: the
    // admin needs the reason rendered, not a generic 500.
    return ok({
      sent: result.sent,
      error: result.error,
      attempts: result.attempts,
      config,
    });
  });
}

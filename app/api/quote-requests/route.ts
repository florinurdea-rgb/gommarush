import { NextRequest, NextResponse } from "next/server";
import { createQuoteRequestSchema, toRpcItem } from "@/lib/validation/quote-request";
import {
  createQuoteRequest,
  getQuoteRequest,
  recordNotificationOutcome,
} from "@/lib/server/quote-requests";
import { sendQuoteRequestEmail } from "@/lib/email/send-quote-request";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { logError, logEvent } from "@/lib/logger";
import type { CreateQuoteRequestResponse } from "@/lib/types/quote-request";

export const runtime = "nodejs";
// Never serve a cached response for a mutation.
export const dynamic = "force-dynamic";

/**
 * POST /api/quote-requests — the public submission endpoint.
 *
 * THE ORDERING GUARANTEE, which is the whole point of this route:
 *
 *   validate → PERSIST (request + items, one transaction) → attempt e-mail
 *   → respond success
 *
 * The e-mail is a notification, never the system of record. If Resend is
 * down, the request is already committed and already visible to staff in the
 * admin dashboard; the customer still gets a success response, because from
 * their point of view the request genuinely did reach the business. The
 * failure is recorded on the row so staff can see the notification didn't
 * go out.
 *
 * The reverse order — mail first, save second — is what loses a customer's
 * request when a provider has a bad minute, and is specifically avoided.
 */

// Enough for a large multi-item request, small enough to reject a blob.
const MAX_BODY_BYTES = 40_000;

function fail(status: number, error: string, fieldErrors?: string[]) {
  return NextResponse.json<CreateQuoteRequestResponse>(
    { success: false, error, ...(fieldErrors ? { fieldErrors } : {}) },
    { status }
  );
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);

  if (isRateLimited(`quote-request:${ip}`)) {
    logEvent("quote_request_rate_limited", { ip });
    return fail(429, "RATE_LIMITED");
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, "PAYLOAD_TOO_LARGE");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return fail(400, "INVALID_JSON");
  }

  const parsed = createQuoteRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    // Field paths only — never the raw Zod dump, and never anything the
    // customer typed echoed back into logs.
    const fieldErrors = parsed.error.issues.map((issue) => issue.path.join("."));
    logEvent("quote_request_validation_failed", { ip, fields: fieldErrors.join(",") });
    return fail(400, "VALIDATION_FAILED", fieldErrors);
  }

  const input = parsed.data;

  // Honeypot: a real customer never sees this field. Respond as though it
  // worked so a bot learns nothing, but persist nothing.
  if (input.website && input.website.trim().length > 0) {
    logEvent("quote_request_honeypot_tripped", { ip });
    return NextResponse.json<CreateQuoteRequestResponse>({
      success: true,
      requestId: "00000000-0000-0000-0000-000000000000",
      requestNumber: "GR-0000",
      itemCount: 0,
      emailSent: false,
    });
  }

  // ---- 1. PERSIST FIRST -------------------------------------------------
  let created;
  try {
    created = await createQuoteRequest({
      company_name: input.companyName,
      contact_email: input.email,
      whatsapp: input.whatsapp,
      language: input.language,
      idempotency_key: input.idempotencyKey,
      items: input.items.map(toRpcItem),
    });
  } catch (error) {
    // The customer's data was NOT saved — this is the one case where we tell
    // them it failed, so they can retry with everything still in the form.
    logError("quote_request_persist_failed", error, { ip });
    return fail(500, "SAVE_FAILED");
  }

  // A replayed idempotency key means this exact submission already landed.
  // Return the original request rather than creating or notifying twice.
  if (created.replayed) {
    logEvent("quote_request_replayed", { requestId: created.requestId });
    return NextResponse.json<CreateQuoteRequestResponse>(
      {
        success: true,
        requestId: created.requestId,
        requestNumber: created.requestNumber,
        itemCount: created.itemCount,
        emailSent: true,
      },
      { status: 200 }
    );
  }

  // ---- 2. NOTIFY SECOND — failure here never fails the request ----------
  let emailSent = false;
  try {
    const detail = await getQuoteRequest(created.requestId);
    if (detail) {
      const result = await sendQuoteRequestEmail(detail);
      emailSent = result.success;
      await recordNotificationOutcome(created.requestId, {
        sent: result.success,
        error: result.success ? null : result.error,
      });
    }
  } catch (error) {
    // Swallowed on purpose. The row exists; staff will see it in the admin
    // list regardless of what the mail provider did.
    logError("quote_request_notify_failed", error, { requestId: created.requestId });
    await recordNotificationOutcome(created.requestId, {
      sent: false,
      error: error instanceof Error ? error.message : "UNKNOWN",
    });
  }

  return NextResponse.json<CreateQuoteRequestResponse>(
    {
      success: true,
      requestId: created.requestId,
      requestNumber: created.requestNumber,
      itemCount: created.itemCount,
      emailSent,
    },
    { status: 201 }
  );
}

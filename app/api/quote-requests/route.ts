import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createQuoteRequestSchema, toRpcItem } from "@/lib/validation/quote-request";
import { createQuoteRequest, getQuoteRequest, logQuoteEvent } from "@/lib/server/quote-requests";
import { notifyQuoteRequest } from "@/lib/server/quote-request-notify";
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
 * go out, and can retry it without the customer resubmitting.
 *
 * The reverse order — mail first, save second — is what loses a customer's
 * request when a provider has a bad minute, and is specifically avoided.
 *
 * Every log line and every event row carries the same `traceId`, so one
 * submission can be followed end to end without correlating timestamps.
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
  const startedAt = Date.now();
  const traceId = randomUUID();
  const ip = getClientIp(request.headers);

  if (isRateLimited(`quote-request:${ip}`)) {
    logEvent("quote_request_rate_limited", { traceId, ip });
    return fail(429, "RATE_LIMITED");
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    logEvent("quote_request_payload_too_large", { traceId, bytes: raw.length });
    return fail(413, "PAYLOAD_TOO_LARGE");
  }

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
    logEvent("quote_request_validation_failed", { traceId, ip, fields: fieldErrors.join(",") });
    void logQuoteEvent("validation_failed", { meta: { traceId, fields: fieldErrors.join(",") } });
    return fail(400, "VALIDATION_FAILED", fieldErrors);
  }

  const input = parsed.data;
  const validationMs = Date.now() - startedAt;

  // Honeypot: a real customer never sees this field. Respond as though it
  // worked so a bot learns nothing, but persist nothing.
  if (input.website && input.website.trim().length > 0) {
    logEvent("quote_request_honeypot_tripped", { traceId, ip });
    return NextResponse.json<CreateQuoteRequestResponse>({
      success: true,
      reference: "GR-000000-0000",
      itemCount: 0,
      emailSent: false,
    });
  }

  logEvent("quote_request_submission_received", {
    traceId,
    ip,
    itemCount: input.items.length,
    language: input.language,
  });

  // ---- 1. PERSIST FIRST -------------------------------------------------
  const persistStartedAt = Date.now();
  let created;
  try {
    created = await createQuoteRequest({
      company_name: input.companyName,
      contact_email: input.email,
      whatsapp: input.whatsapp,
      notes: input.notes,
      language: input.language,
      idempotency_key: input.idempotencyKey,
      validation_ms: Date.now() - persistStartedAt,
      items: input.items.map(toRpcItem),
    });
  } catch (error) {
    // The customer's data was NOT saved — this is the one case where we tell
    // them it failed, so they can retry with everything still in the form.
    logError("quote_request_persist_failed", error, { traceId, ip });
    void logQuoteEvent("persist_failed", { meta: { traceId } });
    return fail(500, "SAVE_FAILED");
  }

  const persistMs = Date.now() - persistStartedAt;
  logEvent("quote_request_persisted", {
    traceId,
    requestId: created.requestId,
    reference: created.reference,
    itemCount: created.itemCount,
    replayed: created.replayed,
    persistMs,
  });

  // A replayed idempotency key means this exact submission already landed.
  // Don't create it again — but DO re-attempt the notification if the stored
  // row shows it never went out. A customer who resubmits after a mail
  // outage is exactly the case where staff still need to hear about it, and
  // reporting the persisted state (rather than assuming success) keeps the
  // response honest about what actually happened.
  if (created.replayed) {
    let emailSent = false;
    try {
      const existing = await getQuoteRequest(created.requestId);
      const status = existing?.request.notification_status;
      emailSent = status === "sent" || status === "delivered";
      if (existing && !emailSent) {
        emailSent = (await notifyQuoteRequest(created.requestId)).sent;
      }
    } catch (error) {
      // The request is saved; its notification state is a detail.
      logError("quote_request_replay_status_read_failed", error, {
        traceId,
        requestId: created.requestId,
      });
    }

    void logQuoteEvent("submission_completed", {
      requestId: created.requestId,
      meta: { traceId, replayed: true },
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json<CreateQuoteRequestResponse>(
      {
        success: true,
        reference: created.reference,
        itemCount: created.itemCount,
        emailSent,
      },
      { status: 200 }
    );
  }

  // ---- 2. NOTIFY SECOND — failure here never fails the request ----------
  // notifyQuoteRequest never throws and records its own outcome on the row.
  const { sent: emailSent } = await notifyQuoteRequest(created.requestId);

  const totalMs = Date.now() - startedAt;
  void logQuoteEvent("submission_completed", {
    requestId: created.requestId,
    meta: { traceId, emailSent, validationMs, persistMs },
    durationMs: totalMs,
  });

  return NextResponse.json<CreateQuoteRequestResponse>(
    {
      success: true,
      reference: created.reference,
      itemCount: created.itemCount,
      emailSent,
    },
    { status: 201 }
  );
}

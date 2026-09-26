import { NextRequest, NextResponse } from "next/server";
import { mapResendEventType, verifyResendWebhook } from "@/lib/email/verify-webhook";
import {
  claimWebhookEvent,
  getQuoteRequestByMessageId,
  recordNotificationOutcome,
} from "@/lib/server/quote-requests";
import { logError, logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/resend — delivery reports from the mail provider.
 *
 * This is what makes "delivered" mean delivered. Without it the system can
 * only ever know that Resend accepted the message, which is not the same
 * thing as the sales inbox receiving it — a request whose notification
 * bounced would otherwise show a confident green "sent" forever.
 *
 * Three properties this endpoint must have, because it is public:
 *
 *   1. AUTHENTIC — the Svix signature is verified against
 *      RESEND_WEBHOOK_SECRET before anything is read from the body. An
 *      unsigned or mis-signed request is rejected with 401 and changes
 *      nothing.
 *   2. IDEMPOTENT — providers redeliver. The (provider, event_id) primary
 *      key means processing the same event twice is a no-op, so a
 *      redelivered bounce cannot double-count.
 *   3. TOLERANT — an event for a message we don't recognise, or of a type we
 *      don't model, returns 200. Returning an error would make the provider
 *      retry forever over something we are deliberately ignoring.
 */

const MAX_BODY_BYTES = 100_000;

export async function POST(request: NextRequest) {
  // The exact bytes: re-serialising parsed JSON changes key order and every
  // signature then fails.
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  const verification = verifyResendWebhook({
    rawBody,
    secret: process.env.RESEND_WEBHOOK_SECRET,
    headers: {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
  });

  if (!verification.valid) {
    // The reason is logged, never returned — an attacker probing the
    // endpoint learns nothing about why their forgery was rejected.
    logEvent("resend_webhook_rejected", { reason: verification.reason });
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  let payload: { type?: string; data?: { email_id?: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_JSON" }, { status: 400 });
  }

  const eventType = typeof payload.type === "string" ? payload.type : "unknown";

  try {
    // Claim before acting: if this returns false we have already processed
    // this exact event and must not apply it again.
    const isNew = await claimWebhookEvent("resend", verification.eventId, eventType);
    if (!isNew) {
      logEvent("resend_webhook_duplicate", { eventId: verification.eventId, eventType });
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const mapped = mapResendEventType(eventType);
    const messageId = payload.data?.email_id;

    if (!mapped || !messageId) {
      logEvent("resend_webhook_ignored", { eventType, hasMessageId: Boolean(messageId) });
      return NextResponse.json({ ok: true, ignored: true });
    }

    const match = await getQuoteRequestByMessageId(messageId);
    if (!match) {
      // Mail we sent for some other reason, or a request since deleted.
      logEvent("resend_webhook_unmatched", { eventType });
      return NextResponse.json({ ok: true, matched: false });
    }

    await recordNotificationOutcome(match.id, {
      status: mapped.status,
      provider: "resend",
      messageId,
      error: mapped.error ?? null,
      // A delivery report is the provider telling us about an attempt we
      // already made — counting it again would inflate the retry count.
      countAttempt: false,
    });

    logEvent("resend_webhook_applied", {
      requestId: match.id,
      eventType,
      status: mapped.status,
    });

    return NextResponse.json({ ok: true, applied: true });
  } catch (error) {
    logError("resend_webhook_failed", error, { eventType });
    // 500 so the provider retries — the claim row is inside the same failure
    // window, and a genuinely duplicate retry is already safe.
    return NextResponse.json({ ok: false, code: "PROCESSING_FAILED" }, { status: 500 });
  }
}

import "server-only";
import { getQuoteRequest, logQuoteEvent, recordNotificationOutcome } from "@/lib/server/quote-requests";
import { sendQuoteRequestEmail } from "@/lib/email/send-quote-request";
import { logError, logEvent } from "@/lib/logger";

/**
 * The single place a quote-request notification is attempted.
 *
 * Every caller — the public submit route, the idempotent-replay path and the
 * admin retry action — goes through here, so a fix to the notification path
 * can never apply to one and not the others, and all of them record the
 * outcome the same way.
 *
 * IT NEVER THROWS. By the time this runs the request is already committed;
 * a mail outage must not turn a saved request into an error for the
 * customer, and must not 500 the admin screen either.
 *
 * IT NEVER CREATES A REQUEST. Retrying a notification touches only the
 * notification columns of an existing row — the "retry duplicated the
 * customer's request" failure is structurally impossible here.
 */

/** Hard ceiling per invocation. Two attempts, not an unbounded loop. */
const MAX_ATTEMPTS_PER_CALL = 2;
/** Short, because the customer's HTTP request is waiting behind this. */
const RETRY_DELAY_MS = 400;

/**
 * Total attempts a single request will ever accumulate automatically.
 * Past this, only an explicit admin retry proceeds — otherwise a permanently
 * misconfigured sender turns every submission into a retry storm against
 * the provider.
 */
const MAX_AUTOMATIC_ATTEMPTS = 6;

export interface NotifyResult {
  sent: boolean;
  /** Why it failed, already persisted to last_notification_error. */
  error: string | null;
  attempts: number | null;
  /** True when the ceiling stopped us before contacting the provider. */
  throttled?: boolean;
}

/** Errors that will fail identically however many times they are retried. */
function isPermanent(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.startsWith("email_not_configured") ||
    lower.includes("invalid_access_token") ||
    lower.includes("api key is invalid") ||
    lower.includes("not verified") ||
    lower.includes("validation_error")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function notifyQuoteRequest(
  requestId: string,
  options: { manual?: boolean; actor?: string } = {}
): Promise<NotifyResult> {
  const manual = options.manual ?? false;

  try {
    const detail = await getQuoteRequest(requestId);
    if (!detail) {
      logEvent("quote_request_notify_missing_row", { requestId });
      return { sent: false, error: "REQUEST_NOT_FOUND", attempts: null };
    }

    const alreadyAttempted = detail.request.notification_attempts ?? 0;
    if (!manual && alreadyAttempted >= MAX_AUTOMATIC_ATTEMPTS) {
      // Not an error — a deliberate stop. The admin retry button still works.
      logEvent("quote_request_notify_throttled", { requestId, attempts: alreadyAttempted });
      await logQuoteEvent("notification_throttled", {
        requestId,
        meta: { attempts: alreadyAttempted },
      });
      return {
        sent: false,
        error: detail.request.last_notification_error,
        attempts: alreadyAttempted,
        throttled: true,
      };
    }

    if (manual) {
      logEvent("quote_request_notify_retry_requested", {
        requestId,
        actor: options.actor ?? "admin",
      });
    }

    // Mark in-flight without counting it as an attempt, so a function that
    // dies mid-send leaves a visible 'sending' rather than a silent 'pending'.
    await recordNotificationOutcome(requestId, {
      status: "sending",
      provider: "resend",
      countAttempt: false,
    });

    let lastError = "UNKNOWN";
    let attempts: number | null = alreadyAttempted;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CALL; attempt += 1) {
      const startedAt = Date.now();
      const result = await sendQuoteRequestEmail(detail);
      const durationMs = Date.now() - startedAt;

      if (result.success) {
        const recorded = await recordNotificationOutcome(requestId, {
          status: "sent",
          provider: "resend",
          messageId: result.messageId ?? null,
          durationMs,
        });
        logEvent("quote_request_notification_sent", {
          requestId,
          reference: detail.request.public_reference,
          attempt,
          durationMs,
        });
        return { sent: true, error: null, attempts: recorded.attempts };
      }

      lastError = result.error;
      const recorded = await recordNotificationOutcome(requestId, {
        status: "failed",
        provider: "resend",
        error: result.error,
        durationMs,
      });
      attempts = recorded.attempts;

      logEvent("quote_request_notification_failed", {
        requestId,
        reference: detail.request.public_reference,
        attempt,
        durationMs,
        reason: result.error.slice(0, 200),
      });

      // Retrying a misconfiguration just burns time the customer is waiting
      // through and tells us nothing new.
      if (isPermanent(result.error)) break;
      if (attempt < MAX_ATTEMPTS_PER_CALL) await delay(RETRY_DELAY_MS);
    }

    return { sent: false, error: lastError, attempts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    logError("quote_request_notify_failed", error, { requestId });
    const recorded = await recordNotificationOutcome(requestId, {
      status: "failed",
      provider: "resend",
      error: message,
    });
    return { sent: false, error: message, attempts: recorded.attempts };
  }
}

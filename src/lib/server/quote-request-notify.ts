import "server-only";
import { getQuoteRequest, recordNotificationOutcome } from "@/lib/server/quote-requests";
import { sendQuoteRequestEmail } from "@/lib/email/send-quote-request";
import { logError, logEvent } from "@/lib/logger";

/**
 * The single place a quote-request notification is attempted.
 *
 * Both callers — the public submit route and the admin "retry" action — go
 * through here, so a fix to the notification path can never apply to one and
 * not the other, and both record the outcome on the row the same way.
 *
 * IT NEVER THROWS. By the time this runs the request is already committed;
 * a mail outage must not turn a saved request into an error for the customer,
 * and must not 500 the admin screen either.
 */
export interface NotifyResult {
  sent: boolean;
  /** Why it failed, already persisted to notification_email_error. */
  error: string | null;
}

export async function notifyQuoteRequest(requestId: string): Promise<NotifyResult> {
  try {
    const detail = await getQuoteRequest(requestId);
    if (!detail) {
      // Nothing to notify about — and nothing to record it against.
      logEvent("quote_request_notify_missing_row", { requestId });
      return { sent: false, error: "REQUEST_NOT_FOUND" };
    }

    const result = await sendQuoteRequestEmail(detail);
    const error = result.success ? null : result.error;

    await recordNotificationOutcome(requestId, { sent: result.success, error });

    logEvent("quote_request_notify_attempted", {
      requestId,
      sent: result.success,
      // The reason is operational, not customer data — safe to log and the
      // only thing that makes a failed send diagnosable from the logs alone.
      reason: error,
    });

    return { sent: result.success, error };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    logError("quote_request_notify_failed", error, { requestId });
    await recordNotificationOutcome(requestId, { sent: false, error: message });
    return { sent: false, error: message };
  }
}

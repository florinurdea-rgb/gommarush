import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError, logEvent } from "@/lib/logger";
import type {
  QuoteRequestDetail,
  QuoteRequestItemRow,
  QuoteRequestListRow,
  QuoteRequestRow,
  QuoteRequestStatus,
} from "@/lib/types/quote-request";

/**
 * Server-side data access for quote requests.
 *
 * Everything here uses the service-role client, which only ever exists
 * server-side (`import "server-only"` makes importing this from a client
 * component a build error). The tables have RLS on with no policies, so this
 * is the only path to them — a browser holding the anon key can neither read
 * customer e-mails nor list requests.
 */

const REQUEST_COLUMNS =
  "id, request_number, company_name, contact_email, whatsapp, language, status, " +
  "notification_email_sent, notification_email_error, notification_email_sent_at, " +
  "idempotency_key, source, created_at, updated_at";

const ITEM_COLUMNS =
  "id, quote_request_id, product_type, description, width, profile, rim, " +
  "load_speed_index, quantity, preference_type, preferred_brand, delivery_speed, " +
  "sort_order, created_at";

export interface CreateQuoteRequestResult {
  requestId: string;
  requestNumber: string;
  itemCount: number;
  /** True when an existing request was returned for a replayed idempotency key. */
  replayed: boolean;
}

/**
 * Creates the request and every item in ONE database transaction via
 * gorush_create_quote_request. A partial request — header saved, some items
 * missing — is not a state this can produce.
 */
export async function createQuoteRequest(payload: {
  company_name: string;
  contact_email: string;
  whatsapp: string | null;
  language: string;
  idempotency_key: string;
  items: Record<string, unknown>[];
}): Promise<CreateQuoteRequestResult> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc("gorush_create_quote_request", { payload });

  if (error) {
    logError("quote_request_create_failed", error, {
      itemCount: payload.items.length,
    });
    throw error;
  }

  const result = data as {
    request_id: string;
    request_number: string;
    item_count: number;
    replayed: boolean;
  };

  logEvent("quote_request_created", {
    requestId: result.request_id,
    requestNumber: result.request_number,
    itemCount: result.item_count,
    replayed: result.replayed,
  });

  return {
    requestId: result.request_id,
    requestNumber: result.request_number,
    itemCount: result.item_count,
    replayed: result.replayed,
  };
}

/** Records the outcome of the notification e-mail. Never throws: the request row is already safe. */
export async function recordNotificationOutcome(
  requestId: string,
  outcome: { sent: boolean; error?: string | null }
): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("quote_requests")
      .update({
        notification_email_sent: outcome.sent,
        notification_email_sent_at: outcome.sent ? new Date().toISOString() : null,
        // Never persist raw provider internals beyond a short, safe message.
        notification_email_error: outcome.sent ? null : (outcome.error ?? "unknown").slice(0, 500),
      })
      .eq("id", requestId);
  } catch (error) {
    // Even this failing must not affect the customer's result.
    logError("quote_request_notification_status_update_failed", error, { requestId });
  }
}

export interface ListQuoteRequestsOptions {
  limit?: number;
  offset?: number;
  status?: QuoteRequestStatus | null;
}

/**
 * Admin list, newest first. Item counts come from a single grouped follow-up
 * query rather than N per-row queries.
 */
export async function listQuoteRequests(
  options: ListQuoteRequestsOptions = {}
): Promise<{ rows: QuoteRequestListRow[]; total: number }> {
  const supabase = createSupabaseAdminClient();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  let query = supabase
    .from("quote_requests")
    .select(REQUEST_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.status) query = query.eq("status", options.status);

  const { data, error, count } = await query;
  if (error) throw error;

  const requests = (data ?? []) as unknown as QuoteRequestRow[];
  if (requests.length === 0) return { rows: [], total: count ?? 0 };

  const { data: itemRows, error: itemError } = await supabase
    .from("quote_request_items")
    .select("quote_request_id")
    .in(
      "quote_request_id",
      requests.map((request) => request.id)
    );
  if (itemError) throw itemError;

  const counts = new Map<string, number>();
  for (const row of (itemRows ?? []) as { quote_request_id: string }[]) {
    counts.set(row.quote_request_id, (counts.get(row.quote_request_id) ?? 0) + 1);
  }

  return {
    rows: requests.map((request) => ({
      ...request,
      item_count: counts.get(request.id) ?? 0,
    })),
    total: count ?? requests.length,
  };
}

/** How many requests are still untouched — drives the nav badge. */
export async function countNewQuoteRequests(): Promise<number> {
  const supabase = createSupabaseAdminClient();
  const { count, error } = await supabase
    .from("quote_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  if (error) throw error;
  return count ?? 0;
}

export async function getQuoteRequest(requestId: string): Promise<QuoteRequestDetail | null> {
  const supabase = createSupabaseAdminClient();

  const { data: request, error } = await supabase
    .from("quote_requests")
    .select(REQUEST_COLUMNS)
    .eq("id", requestId)
    .maybeSingle();

  if (error) throw error;
  if (!request) return null;

  const { data: items, error: itemError } = await supabase
    .from("quote_request_items")
    .select(ITEM_COLUMNS)
    .eq("quote_request_id", requestId)
    .order("sort_order", { ascending: true });

  if (itemError) throw itemError;

  return {
    request: request as unknown as QuoteRequestRow,
    items: (items ?? []) as unknown as QuoteRequestItemRow[],
  };
}

export async function updateQuoteRequestStatus(
  requestId: string,
  status: QuoteRequestStatus
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("quote_requests")
    .update({ status })
    .eq("id", requestId);
  if (error) throw error;
  logEvent("quote_request_status_changed", { requestId, status });
}

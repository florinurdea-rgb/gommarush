import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError, logEvent } from "@/lib/logger";
import type {
  DeliverySpeed,
  NotificationStatus,
  QuoteRequestDetail,
  QuoteRequestEventRow,
  QuoteRequestItemRow,
  QuoteRequestListRow,
  QuoteRequestRow,
  QuoteRequestStatus,
} from "@/lib/types/quote-request";
import {
  OPEN_QUOTE_STATUSES,
  QUOTE_GROUPS,
  QUOTE_GROUP_STATUSES,
  type QuoteRequestGroup,
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
  "id, public_reference, company_name, contact_email, whatsapp, notes, language, " +
  "status, delivery_preference, notification_status, notification_provider, " +
  "provider_message_id, notification_attempts, last_notification_attempt_at, " +
  "notification_sent_at, notification_delivered_at, notification_failed_at, " +
  "last_notification_error, source, submitted_at, created_at, updated_at";

const ITEM_COLUMNS =
  "id, quote_request_id, product_type, description, width, profile, rim, " +
  "load_speed_index, season, quantity, preference_type, preferred_brand, " +
  "delivery_speed, sort_order, created_at";

export interface CreateQuoteRequestResult {
  requestId: string;
  reference: string;
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
  notes: string | null;
  language: string;
  idempotency_key: string;
  validation_ms?: number;
  items: Record<string, unknown>[];
}): Promise<CreateQuoteRequestResult> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc("gorush_create_quote_request", { payload });

  if (error) {
    logError("quote_request_create_failed", error, { itemCount: payload.items.length });
    throw error;
  }

  const result = data as {
    request_id: string;
    public_reference: string;
    item_count: number;
    replayed: boolean;
  };

  return {
    requestId: result.request_id,
    reference: result.public_reference,
    itemCount: result.item_count,
    replayed: result.replayed,
  };
}

// ---------------------------------------------------------------------------
// Notification state
// ---------------------------------------------------------------------------

export interface RecordNotificationInput {
  status: NotificationStatus;
  provider?: string | null;
  messageId?: string | null;
  error?: string | null;
  /** False for webhook-driven transitions — a delivery report is not a new attempt. */
  countAttempt?: boolean;
  durationMs?: number | null;
}

/**
 * Records one notification outcome. Never throws: the request row is already
 * safe, and failing to record that mail failed must not itself become an
 * error the customer or the admin screen sees.
 *
 * Delegates to the RPC so incrementing the attempt counter and writing the
 * outcome happen in one statement — two concurrent retries must not both
 * read 3 and both write 4.
 */
export async function recordNotificationOutcome(
  requestId: string,
  input: RecordNotificationInput
): Promise<{ attempts: number | null }> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.rpc("gorush_record_notification", {
      p_request_id: requestId,
      p_status: input.status,
      p_provider: input.provider ?? null,
      p_message_id: input.messageId ?? null,
      p_error: input.error ?? null,
      p_count_attempt: input.countAttempt ?? true,
      p_duration_ms: input.durationMs ?? null,
    });
    if (error) throw error;
    const result = data as { updated: boolean; attempts?: number };
    return { attempts: result?.attempts ?? null };
  } catch (error) {
    logError("quote_request_notification_status_update_failed", error, { requestId });
    return { attempts: null };
  }
}

/**
 * Appends an operational event. Fire-and-forget by design: observability
 * must never be able to break the thing it observes.
 */
export async function logQuoteEvent(
  eventType: string,
  options: {
    requestId?: string | null;
    meta?: Record<string, string | number | boolean | null>;
    durationMs?: number | null;
  } = {}
): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.rpc("gorush_log_quote_event", {
      p_event_type: eventType,
      p_request_id: options.requestId ?? null,
      p_meta: options.meta ?? {},
      p_duration_ms: options.durationMs ?? null,
    });
  } catch (error) {
    logError("quote_event_log_failed", error, { eventType });
  }
}

// ---------------------------------------------------------------------------
// Admin queries
// ---------------------------------------------------------------------------

export interface ListQuoteRequestsOptions {
  page?: number;
  perPage?: number;
  /** Which tab. Narrows to that group's statuses. */
  group?: QuoteRequestGroup | null;
  status?: QuoteRequestStatus | null;
  notification?: NotificationStatus | null;
  delivery?: DeliverySpeed | null;
  /** Matched against reference, company name and contact e-mail. */
  search?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface ListQuoteRequestsResult {
  rows: QuoteRequestListRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
}

/** PostgREST `or=` values are comma/parenthesis delimited — neutralise both. */
function escapeForOrFilter(value: string): string {
  return value.replace(/[,()*\\]/g, " ").trim();
}

/**
 * Admin list, newest first, filtered and paginated SERVER-side.
 *
 * Item counts come from one grouped follow-up query over just the page's
 * ids, not a per-row query — the N+1 this replaces was 25 extra round trips
 * per page render.
 */
export async function listQuoteRequests(
  options: ListQuoteRequestsOptions = {}
): Promise<ListQuoteRequestsResult> {
  const supabase = createSupabaseAdminClient();
  const perPage = Math.min(Math.max(options.perPage ?? 25, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  const offset = (page - 1) * perPage;

  let query = supabase
    .from("quote_requests")
    .select(REQUEST_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + perPage - 1);

  // The explicit status filter wins: picking one inside a tab should show
  // exactly that status, not the tab's whole set.
  if (options.status) {
    query = query.eq("status", options.status);
  } else if (options.group) {
    query = query.in("status", QUOTE_GROUP_STATUSES[options.group] as unknown as string[]);
  }
  if (options.notification) query = query.eq("notification_status", options.notification);
  if (options.delivery) query = query.eq("delivery_preference", options.delivery);
  if (options.from) query = query.gte("created_at", `${options.from}T00:00:00Z`);
  if (options.to) query = query.lte("created_at", `${options.to}T23:59:59.999Z`);

  const search = options.search?.trim();
  if (search) {
    const safe = escapeForOrFilter(search);
    if (safe) {
      // ilike on the two lower() indexed columns plus the reference. Anchored
      // with a trailing % only where it can use the index; the leading % on
      // company is a deliberate trade — a sales user searches for a fragment
      // of a company name far more often than a prefix.
      query = query.or(
        `public_reference.ilike.%${safe}%,company_name.ilike.%${safe}%,contact_email.ilike.%${safe}%`
      );
    }
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const requests = (data ?? []) as unknown as QuoteRequestRow[];
  const total = count ?? requests.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));

  if (requests.length === 0) return { rows: [], total, page, perPage, pageCount };

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
    total,
    page,
    perPage,
    pageCount,
  };
}

/**
 * How many requests sit in each tab.
 *
 * Three head-only counting queries rather than loading rows: the tab bar
 * needs numbers, not data, and this runs on every list render.
 */
export async function countQuoteRequestsByGroup(): Promise<Record<QuoteRequestGroup, number>> {
  const supabase = createSupabaseAdminClient();

  const counts = await Promise.all(
    QUOTE_GROUPS.map(async (group) => {
      const { count, error } = await supabase
        .from("quote_requests")
        .select("id", { count: "exact", head: true })
        .in("status", QUOTE_GROUP_STATUSES[group] as unknown as string[]);
      if (error) throw error;
      return [group, count ?? 0] as const;
    })
  );

  return Object.fromEntries(counts) as Record<QuoteRequestGroup, number>;
}

/**
 * Deletes a request and everything attached to it, permanently.
 *
 * This is a genuine hard delete, not an archive: the lifecycle already has
 * an `archived` status for "keep it but hide it", so a separate soft delete
 * would just be a second way to do the same thing. Items and events are
 * removed by ON DELETE CASCADE.
 *
 * Before deleting, a summary is written to quote_request_events with a NULL
 * request id — the row therefore survives the cascade, so the audit trail
 * records that this reference existed and who removed it, without keeping
 * the customer's contact details.
 */
export async function deleteQuoteRequest(
  requestId: string,
  actor: string
): Promise<{ deleted: boolean; reference: string | null }> {
  const supabase = createSupabaseAdminClient();

  const { data: existing, error: readError } = await supabase
    .from("quote_requests")
    .select("id, public_reference, company_name, status")
    .eq("id", requestId)
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) return { deleted: false, reference: null };

  const row = existing as {
    public_reference: string;
    company_name: string;
    status: string;
  };

  await logQuoteEvent("request_deleted", {
    requestId: null,
    meta: {
      reference: row.public_reference,
      status: row.status,
      actor,
      // Deliberately no contact e-mail or notes: the point of deleting is
      // that the customer's data goes away.
      company: row.company_name,
    },
  });

  const { error } = await supabase.from("quote_requests").delete().eq("id", requestId);
  if (error) throw error;

  logEvent("quote_request_deleted", { requestId, reference: row.public_reference, actor });
  return { deleted: true, reference: row.public_reference };
}

/** How many requests still need action — drives the nav badge. */
export async function countOpenQuoteRequests(): Promise<number> {
  const supabase = createSupabaseAdminClient();
  const { count, error } = await supabase
    .from("quote_requests")
    .select("id", { count: "exact", head: true })
    .in("status", OPEN_QUOTE_STATUSES as unknown as string[]);
  if (error) throw error;
  return count ?? 0;
}

export async function getQuoteRequest(
  requestId: string,
  options: { withEvents?: boolean } = {}
): Promise<QuoteRequestDetail | null> {
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

  const detail: QuoteRequestDetail = {
    request: request as unknown as QuoteRequestRow,
    items: (items ?? []) as unknown as QuoteRequestItemRow[],
  };

  if (options.withEvents) {
    const { data: events } = await supabase
      .from("quote_request_events")
      .select("id, quote_request_id, event_type, meta, duration_ms, created_at")
      .eq("quote_request_id", requestId)
      .order("created_at", { ascending: false })
      .limit(50);
    detail.events = (events ?? []) as unknown as QuoteRequestEventRow[];
  }

  return detail;
}

/** Looks a request up by its customer-facing reference. Admin-side only. */
export async function getQuoteRequestByReference(
  reference: string
): Promise<QuoteRequestRow | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("quote_requests")
    .select(REQUEST_COLUMNS)
    .eq("public_reference", reference)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as QuoteRequestRow) ?? null;
}

/** Finds the request a provider webhook refers to, by its message id. */
export async function getQuoteRequestByMessageId(
  messageId: string
): Promise<{ id: string } | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("quote_requests")
    .select("id")
    .eq("provider_message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null) ?? null;
}

export async function updateQuoteRequestStatus(
  requestId: string,
  status: QuoteRequestStatus,
  actor: string
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("quote_requests").update({ status }).eq("id", requestId);
  if (error) throw error;

  logEvent("quote_request_status_changed", { requestId, status, actor });
  await logQuoteEvent("status_changed", { requestId, meta: { status, actor } });
}

/**
 * Records a webhook event once. Returns false if this exact provider event
 * has already been processed, which is how redelivery becomes a no-op
 * instead of a double-counted delivery.
 */
export async function claimWebhookEvent(
  provider: string,
  eventId: string,
  eventType: string
): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("quote_request_webhook_events")
    .insert({ provider, event_id: eventId, event_type: eventType });

  if (!error) return true;
  // 23505 = unique_violation: we've seen this event before.
  if ((error as { code?: string }).code === "23505") return false;
  throw error;
}

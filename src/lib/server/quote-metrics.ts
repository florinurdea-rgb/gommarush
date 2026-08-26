import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError } from "@/lib/logger";
import type { QuoteRequestStatus } from "@/lib/types/quote-request";

/**
 * Operational metrics for the quote pipeline.
 *
 * Two separate audiences, deliberately kept apart:
 *   * getBusinessMetrics — what a sales lead needs (how much work is in the
 *     pipe, how much went out, how much was won)
 *   * getSystemHealth — what an operator needs when something is wrong
 *     (did submissions persist, is mail going out, how slow is it)
 *
 * Everything is computed with counting queries (`head: true`) or over a
 * bounded window of event rows. Nothing loads a full table.
 *
 * A deliberate refusal: percentiles are only returned once there are enough
 * samples to mean anything. A "p95" over four requests is a number that
 * invites the wrong decision, so it comes back null instead.
 */

export type MetricPeriod = "today" | "7d" | "30d";

const PERIOD_DAYS: Record<MetricPeriod, number> = { today: 1, "7d": 7, "30d": 30 };

export const PERIOD_LABELS: Record<MetricPeriod, string> = {
  today: "Oggi",
  "7d": "Ultimi 7 giorni",
  "30d": "Ultimi 30 giorni",
};

/** Below this, a percentile is noise dressed up as a measurement. */
const MIN_SAMPLES_FOR_PERCENTILES = 20;

export function periodStart(period: MetricPeriod): string {
  const now = new Date();
  if (period === "today") {
    // Local Italian midnight, expressed as an instant.
    const rome = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
    rome.setHours(0, 0, 0, 0);
    const offset = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "Europe/Rome" })).getTime();
    return new Date(rome.getTime() + offset).toISOString();
  }
  const start = new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);
  return start.toISOString();
}

export interface BusinessMetrics {
  period: MetricPeriod;
  /** Arrived in the period. */
  newRequests: number;
  /** Open right now, regardless of when they arrived — this is the backlog. */
  toProcess: number;
  offersSent: number;
  accepted: number;
  rejected: number;
}

async function countRequests(
  filter: (query: ReturnType<typeof buildCountQuery>) => ReturnType<typeof buildCountQuery>
): Promise<number> {
  const { count, error } = await filter(buildCountQuery());
  if (error) throw error;
  return count ?? 0;
}

function buildCountQuery() {
  return createSupabaseAdminClient()
    .from("quote_requests")
    .select("id", { count: "exact", head: true });
}

export async function getBusinessMetrics(period: MetricPeriod): Promise<BusinessMetrics> {
  const since = periodStart(period);

  const [newRequests, toProcess, offersSent, accepted, rejected] = await Promise.all([
    countRequests((q) => q.gte("created_at", since)),
    countRequests((q) =>
      q.in("status", ["submitted", "reviewing", "quote_preparing", "quote_ready"])
    ),
    countRequests((q) => q.eq("status", "sent").gte("updated_at", since)),
    countRequests((q) => q.eq("status", "accepted").gte("updated_at", since)),
    countRequests((q) => q.eq("status", "rejected").gte("updated_at", since)),
  ]);

  return { period, newRequests, toProcess, offersSent, accepted, rejected };
}

/** Requests grouped by status, for the pipeline breakdown. */
export async function getStatusBreakdown(): Promise<Record<QuoteRequestStatus, number>> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("quote_requests").select("status").limit(5000);
  if (error) throw error;

  const counts = {} as Record<QuoteRequestStatus, number>;
  for (const row of (data ?? []) as { status: QuoteRequestStatus }[]) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

export interface Percentiles {
  p50: number | null;
  p95: number | null;
  samples: number;
}

function percentiles(values: number[]): Percentiles {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length < MIN_SAMPLES_FOR_PERCENTILES) {
    return { p50: null, p95: null, samples: sorted.length };
  }
  const at = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  return { p50: at(0.5), p95: at(0.95), samples: sorted.length };
}

export interface SystemHealth {
  period: MetricPeriod;
  submissions: {
    attempted: number;
    persisted: number;
    persistFailed: number;
    validationFailed: number;
    duplicatesPrevented: number;
    /** Persisted ÷ attempted, or null when nothing was attempted. */
    successRate: number | null;
  };
  notifications: {
    pending: number;
    sent: number;
    delivered: number;
    failed: number;
    totalAttempts: number;
    /** (sent + delivered) ÷ (sent + delivered + failed), or null. */
    successRate: number | null;
    recentErrors: { error: string; count: number }[];
  };
  timings: {
    persist: Percentiles;
    email: Percentiles;
    total: Percentiles;
  };
}

const EMPTY_PERCENTILES: Percentiles = { p50: null, p95: null, samples: 0 };

/**
 * Reads the event log for the period. Bounded at 5000 rows: past that the
 * percentile is already stable and the point is a fast admin page, not a
 * complete audit — the events themselves remain queryable in Supabase.
 */
export async function getSystemHealth(period: MetricPeriod): Promise<SystemHealth> {
  const since = periodStart(period);
  const supabase = createSupabaseAdminClient();

  const empty: SystemHealth = {
    period,
    submissions: {
      attempted: 0,
      persisted: 0,
      persistFailed: 0,
      validationFailed: 0,
      duplicatesPrevented: 0,
      successRate: null,
    },
    notifications: {
      pending: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      totalAttempts: 0,
      successRate: null,
      recentErrors: [],
    },
    timings: { persist: EMPTY_PERCENTILES, email: EMPTY_PERCENTILES, total: EMPTY_PERCENTILES },
  };

  try {
    const [{ data: events, error: eventError }, { data: rows, error: rowError }] =
      await Promise.all([
        supabase
          .from("quote_request_events")
          .select("event_type, duration_ms, meta, created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(5000),
        supabase
          .from("quote_requests")
          .select("notification_status, notification_attempts, last_notification_error")
          .gte("created_at", since)
          .limit(5000),
      ]);

    if (eventError) throw eventError;
    if (rowError) throw rowError;

    const eventRows = (events ?? []) as {
      event_type: string;
      duration_ms: number | null;
      meta: Record<string, unknown> | null;
    }[];

    const byType = new Map<string, number>();
    const persistTimes: number[] = [];
    const emailTimes: number[] = [];
    const totalTimes: number[] = [];

    for (const event of eventRows) {
      byType.set(event.event_type, (byType.get(event.event_type) ?? 0) + 1);
      const ms = event.duration_ms;
      if (ms == null) continue;
      if (event.event_type === "request_persisted") persistTimes.push(ms);
      else if (event.event_type.startsWith("notification_")) emailTimes.push(ms);
      else if (event.event_type === "submission_completed") totalTimes.push(ms);
    }

    const persisted = byType.get("request_persisted") ?? 0;
    const persistFailed = byType.get("persist_failed") ?? 0;
    const validationFailed = byType.get("validation_failed") ?? 0;
    const duplicatesPrevented = byType.get("duplicate_submission_prevented") ?? 0;
    const attempted = persisted + persistFailed + validationFailed + duplicatesPrevented;

    const requestRows = (rows ?? []) as {
      notification_status: string;
      notification_attempts: number;
      last_notification_error: string | null;
    }[];

    let pending = 0;
    let sent = 0;
    let delivered = 0;
    let failed = 0;
    let totalAttempts = 0;
    const errorCounts = new Map<string, number>();

    for (const row of requestRows) {
      totalAttempts += row.notification_attempts ?? 0;
      switch (row.notification_status) {
        case "sent":
          sent += 1;
          break;
        case "delivered":
          delivered += 1;
          break;
        case "failed":
          failed += 1;
          if (row.last_notification_error) {
            // Group by the leading code, not the whole string — otherwise
            // every failure looks unique and the list is useless.
            const key = row.last_notification_error.split(":")[0].slice(0, 80);
            errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
          }
          break;
        default:
          pending += 1;
      }
    }

    const notificationTotal = sent + delivered + failed;

    return {
      period,
      submissions: {
        attempted,
        persisted,
        persistFailed,
        validationFailed,
        duplicatesPrevented,
        successRate: attempted > 0 ? persisted / attempted : null,
      },
      notifications: {
        pending,
        sent,
        delivered,
        failed,
        totalAttempts,
        successRate: notificationTotal > 0 ? (sent + delivered) / notificationTotal : null,
        recentErrors: [...errorCounts.entries()]
          .map(([error, count]) => ({ error, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
      },
      timings: {
        persist: percentiles(persistTimes),
        email: percentiles(emailTimes),
        total: percentiles(totalTimes),
      },
    };
  } catch (error) {
    // A diagnostics page that 500s when the system is unhealthy is worse
    // than useless. Return the empty shape and let the page say so.
    logError("quote_system_health_failed", error);
    return empty;
  }
}

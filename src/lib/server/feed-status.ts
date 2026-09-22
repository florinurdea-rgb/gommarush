import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { isMissingSchemaError } from "@/lib/server/schema-errors";
import { logError } from "@/lib/logger";
import { FEED_CATEGORY_NOTE_PREFIX } from "@/lib/server/feed-ingestion";
import { intersprintFeedAdapter } from "@/lib/catalogue/intersprint-feed-adapter";

// Operational status of the Inter-Sprint feed.
//
// One question, asked often: is the catalogue's commercial data still being
// refreshed, and if not, since when? Everything here is derived from the
// import runs that already exist — no new bookkeeping, and nothing that could
// disagree with what actually happened.
//
// INTERNAL ONLY. It names the supplier, the supplier's filenames and the
// import machinery, none of which may reach a customer.

export type FeedCategory = "pcr" | "truck";
export const FEED_CATEGORIES: readonly FeedCategory[] = ["pcr", "truck"];

/**
 * How long a feed may go unrefreshed before it is called stale.
 *
 * A GOMMARUSH OPERATIONAL THRESHOLD, not a supplier promise. Inter-Sprint was
 * asked for three deliveries a day and has been observed at roughly 06:27,
 * 10:27, 12:2x and 14:27 — but an observed pattern is not a commitment, so
 * this is set generously at 24 hours. It answers "has the feed stopped?",
 * which is a different and much safer question than "is this price current?".
 * Commercial freshness stays with the observation layer.
 */
export const FEED_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface FeedImportView {
  runId: string;
  category: FeedCategory | null;
  fileName: string | null;
  /** First 12 hex characters. Enough to compare deliveries, not a secret. */
  checksumShort: string | null;
  status: string;
  rowsReceived: number;
  rowsAccepted: number;
  rowsRejected: number;
  conflicts: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface FeedCategoryStatus {
  category: FeedCategory;
  /** The most recent run that reached 'committed'. */
  lastSuccess: FeedImportView | null;
  /** The most recent run of any status, so a failure is visible immediately. */
  lastAttempt: FeedImportView | null;
  ageMs: number | null;
  stale: boolean;
}

export interface IntersprintFeedStatus {
  byCategory: FeedCategoryStatus[];
  recent: FeedImportView[];
  schemaAvailable: boolean;
  staleAfterMs: number;
}

interface RunRow {
  id: string;
  original_filename: string | null;
  file_checksum: string | null;
  status: string;
  notes: string | null;
  source_row_count: number | null;
  committed_row_count: number | null;
  rejected_rows: number | null;
  conflict_count: number | null;
  started_at: string | null;
  finished_at: string | null;
  error_summary: string | null;
}

function categoryOf(row: RunRow): FeedCategory | null {
  const notes = row.notes ?? "";
  if (!notes.startsWith(FEED_CATEGORY_NOTE_PREFIX)) return null;
  const value = notes.slice(FEED_CATEGORY_NOTE_PREFIX.length).trim();
  return value === "pcr" || value === "truck" ? value : null;
}

function toView(row: RunRow): FeedImportView {
  return {
    runId: row.id,
    category: categoryOf(row),
    fileName: row.original_filename,
    checksumShort: row.file_checksum ? row.file_checksum.slice(0, 12) : null,
    status: row.status,
    rowsReceived: row.source_row_count ?? 0,
    rowsAccepted: row.committed_row_count ?? 0,
    rowsRejected: row.rejected_rows ?? 0,
    conflicts: row.conflict_count ?? 0,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error_summary,
  };
}

const RUN_COLUMNS = [
  "id",
  "original_filename",
  "file_checksum",
  "status",
  "notes",
  "source_row_count",
  "committed_row_count",
  "rejected_rows",
  "conflict_count",
  "started_at",
  "finished_at",
  "error_summary",
].join(", ");

/**
 * Reads the feed's operational state.
 *
 * Per category it reports the last SUCCESS and the last ATTEMPT separately.
 * Collapsing them would hide the case that matters most: a feed that imported
 * cleanly yesterday and has failed on every delivery since still has a recent
 * success, and only the attempt reveals the breakage.
 */
export async function getIntersprintFeedStatus(
  now: Date = new Date()
): Promise<IntersprintFeedStatus> {
  const empty: IntersprintFeedStatus = {
    byCategory: FEED_CATEGORIES.map((category) => ({
      category,
      lastSuccess: null,
      lastAttempt: null,
      ageMs: null,
      stale: false,
    })),
    recent: [],
    schemaAvailable: true,
    staleAfterMs: FEED_STALE_AFTER_MS,
  };

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("catalogue_import_runs")
      .select(RUN_COLUMNS)
      .eq("adapter", intersprintFeedAdapter.id)
      .order("started_at", { ascending: false })
      .limit(50);

    if (error) {
      if (isMissingSchemaError(error)) {
        logError("feed_status_schema_missing", error);
        return { ...empty, schemaAvailable: false };
      }
      throw error;
    }

    const rows = (data ?? []) as unknown as RunRow[];
    const views = rows.map(toView);

    const byCategory = FEED_CATEGORIES.map((category) => {
      const mine = views.filter((view) => view.category === category);
      const lastSuccess = mine.find((view) => view.status === "committed") ?? null;
      const lastAttempt = mine[0] ?? null;

      const reference = lastSuccess?.finishedAt ?? lastSuccess?.startedAt ?? null;
      const ageMs = reference ? now.getTime() - new Date(reference).getTime() : null;

      return {
        category,
        lastSuccess,
        lastAttempt,
        ageMs,
        // Never having imported at all counts as stale: "we have no data" is
        // not a healthy state to render as a blank.
        stale: ageMs === null || ageMs > FEED_STALE_AFTER_MS,
      };
    });

    return { byCategory, recent: views.slice(0, 10), schemaAvailable: true, staleAfterMs: FEED_STALE_AFTER_MS };
  } catch (error) {
    logError("feed_status_failed", error);
    throw error;
  }
}

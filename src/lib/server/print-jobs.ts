import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logEvent } from "@/lib/logger";
import { assertLabelDataIsSafe } from "@/lib/logistics/label";
import type { LabelData, PrintJobRow, PrintJobStatus } from "@/lib/types/logistics";

/**
 * Print job queue operations.
 *
 * The web app NEVER prints. It inserts a row here and returns; the GoRush Print
 * Agent on the Windows machine claims and prints it. If the agent or printer is
 * offline the job simply stays `pending` — the label is never lost, and the web
 * app is unaffected.
 */

// NOTE: the column is `print_type`, not `job_type` — aliased here so the
// PrintJobRow shape stays readable in the UI.
const PRINT_JOB_COLUMNS =
  "id, inventory_unit_id, order_id, print_type, status, label_data, printer_name, claimed_by, claimed_at, attempts, printed_at, requested_at, error_message, created_at";

export async function listPrintJobs(options: { status?: PrintJobStatus; limit?: number } = {}) {
  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from("print_jobs")
    .select(`${PRINT_JOB_COLUMNS}, orders ( order_number )`)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (options.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as unknown as (PrintJobRow & { orders: { order_number: number } | null })[];
}

export async function countPendingPrintJobs(): Promise<number> {
  const supabase = createSupabaseAdminClient();
  const { count, error } = await supabase
    .from("print_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "processing"]);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Queues a label outside the receiving RPC (e.g. an Admin reprint).
 *
 * `print_jobs_open_unit_key` — a partial unique index on (inventory_unit_id)
 * where status in ('pending','processing') — makes this idempotent at the
 * database level: a second call while a job is still open returns the existing
 * job rather than queueing a duplicate label.
 */
export async function createPrintJob(input: {
  inventoryUnitId: string;
  orderId: string;
  labelData: LabelData;
}): Promise<{ jobId: string; created: boolean }> {
  const supabase = createSupabaseAdminClient();

  // Fails loudly if a refactor ever widens label_data to include something
  // sensitive.
  assertLabelDataIsSafe(input.labelData as unknown as Record<string, unknown>);

  const { data, error } = await supabase
    .from("print_jobs")
    .insert({
      inventory_unit_id: input.inventoryUnitId,
      order_id: input.orderId,
      print_type: "inventory_unit_label",
      label_data: input.labelData,
      status: "pending",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation: an open job already exists for this unit.
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("print_jobs")
        .select("id")
        .eq("inventory_unit_id", input.inventoryUnitId)
        .in("status", ["pending", "processing"])
        .maybeSingle();
      if (existing) {
        logEvent("print_job_already_queued", { inventoryUnitId: input.inventoryUnitId });
        return { jobId: (existing as { id: string }).id, created: false };
      }
    }
    throw error;
  }

  const jobId = (data as { id: string }).id;
  logEvent("print_job_created", { jobId, inventoryUnitId: input.inventoryUnitId });
  return { jobId, created: true };
}

/**
 * Re-queues a failed (or stuck `processing`) job. This is the recovery path for
 * "the printer was off" — the job was never lost, it just needs another go.
 */
export async function retryPrintJob(jobId: string): Promise<{ ok: boolean; code: string }> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("gorush_retry_print_job", { p_job_id: jobId });
  if (error) throw error;

  const result = data as { ok: boolean; code: string };
  logEvent("print_job_retry", { jobId, code: result.code });
  return result;
}

/**
 * Re-queues jobs an agent claimed but never finished — the crashed-agent
 * recovery path. Safe to call routinely.
 */
export async function requeueStalePrintJobs(staleAfter = "5 minutes"): Promise<number> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("gorush_requeue_stale_print_jobs", {
    p_stale_after: staleAfter,
  });
  if (error) throw error;
  const count = Number(data ?? 0);
  if (count > 0) logEvent("print_jobs_requeued", { count });
  return count;
}

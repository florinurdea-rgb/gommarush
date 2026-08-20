import { renderLabelPdf } from "./label-renderer.js";

/**
 * The claim → render → print → report cycle.
 *
 * Extracted from the process entry point so it can be driven with a mock
 * Supabase client and a mock printer in tests, which is the only way to verify
 * the idempotency and failure behaviour without a printer.
 *
 * Correctness properties this loop relies on:
 *   * `gorush_claim_print_job` uses FOR UPDATE SKIP LOCKED, so two agents on two
 *     machines can never claim the same job
 *   * a claimed job moves to 'processing' immediately, so a crash leaves it in a
 *     recoverable state rather than lost
 *   * `gorush_requeue_stale_print_jobs` returns those crashed jobs to 'pending'
 *   * a print failure sets 'failed' WITH the reason — the label is never lost
 *     and can be retried from the Admin UI
 */

export function createJobLoop({ supabase, printer, config, logger = console }) {
  let running = false;
  let stopped = false;

  async function claimOne() {
    const { data, error } = await supabase.rpc("gorush_claim_print_job", {
      p_agent_id: config.agentId,
      p_printer_name: config.printerName || null,
    });

    if (error) throw error;
    if (!data || data.code !== "CLAIMED") return null;
    return data.job;
  }

  async function complete(jobId, success, detail) {
    const { error } = await supabase.rpc("gorush_complete_print_job", {
      p_job_id: jobId,
      p_success: success,
      p_error: success ? null : String(detail ?? "").slice(0, 1000),
    });
    if (error) throw error;
  }

  /** Processes at most one job. Returns true if it did any work. */
  async function processOne() {
    const job = await claimOne();
    if (!job) return false;

    const labelData = job.label_data ?? {};
    logger.log(
      JSON.stringify({
        event: "print_job_claimed",
        jobId: job.id,
        unitToken: labelData.unit_token,
        attempts: job.attempts,
      })
    );

    let pdf;
    try {
      pdf = await renderLabelPdf(labelData, {
        widthMm: config.label.widthMm,
        heightMm: config.label.heightMm,
        marginMm: config.label.marginMm,
        qrPayload: config.appBaseUrl
          ? `${config.appBaseUrl.replace(/\/+$/, "")}/u/${encodeURIComponent(labelData.unit_token ?? "")}`
          : labelData.unit_token,
      });
    } catch (error) {
      // A malformed job must not wedge the queue: mark it failed with the
      // reason and move on to the next one.
      await complete(job.id, false, `render failed: ${error?.message ?? error}`);
      logger.error(JSON.stringify({ event: "print_job_render_failed", jobId: job.id }));
      return true;
    }

    const result = await printer.print({ pdf, job });
    await complete(job.id, result.ok, result.detail);

    logger.log(
      JSON.stringify({
        event: result.ok ? "print_job_printed" : "print_job_failed",
        jobId: job.id,
        adapter: printer.name,
        detail: result.detail,
      })
    );

    return true;
  }

  /** Drains the queue, then reports how many jobs were handled. */
  async function drain(maxJobs = 25) {
    let processed = 0;
    while (processed < maxJobs && !stopped) {
      const didWork = await processOne();
      if (!didWork) break;
      processed += 1;
    }
    return processed;
  }

  async function requeueStale() {
    const { data, error } = await supabase.rpc("gorush_requeue_stale_print_jobs", {
      p_stale_after: `${config.staleJobMinutes} minutes`,
    });
    if (error) throw error;
    const count = Number(data ?? 0);
    if (count > 0) {
      logger.log(JSON.stringify({ event: "print_jobs_requeued", count }));
    }
    return count;
  }

  async function tick() {
    // Overlapping ticks would let one agent double-claim; skip instead.
    if (running || stopped) return;
    running = true;
    try {
      await requeueStale();
      await drain();
    } catch (error) {
      // Network blips and Supabase hiccups are expected on a warehouse LAN.
      // Log and keep polling — the queue is durable, so nothing is lost.
      logger.error(
        JSON.stringify({ event: "print_agent_tick_failed", message: error?.message ?? String(error) })
      );
    } finally {
      running = false;
    }
  }

  function start() {
    stopped = false;
    void tick();
    const timer = setInterval(() => void tick(), config.pollIntervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  return { start, tick, drain, processOne, requeueStale };
}

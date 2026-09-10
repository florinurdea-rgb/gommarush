import { NextRequest, NextResponse } from "next/server";
import { runNextAnalysisJob } from "@/lib/server/document-analysis-jobs";
import { logError, logEvent } from "@/lib/logger";

export const runtime = "nodejs";
// Under Vercel's ceiling, and the job's own lease (300s) outlives this, so a
// killed invocation cannot leave a row locked for longer than it ran.
export const maxDuration = 170;
export const dynamic = "force-dynamic";

/**
 * The scheduled analysis worker.
 *
 * Drains a bounded number of jobs per invocation rather than looping until
 * empty: an unbounded loop would be killed mid-job by the function timeout,
 * which is the exact failure this queue exists to remove.
 *
 * AUTHORIZATION. This route mutates data and calls a paid provider, so it is
 * not open. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; anything
 * without it is refused. When CRON_SECRET is unset the route refuses
 * everything rather than defaulting open — an unauthenticated endpoint that
 * spends money is worse than a worker that does not run.
 */

const MAX_JOBS_PER_INVOCATION = 3;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    // Deliberately indistinguishable from a missing route: an unauthenticated
    // caller learns nothing about whether the worker exists or is configured.
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const started = Date.now();
  const outcomes: { analysisId: string | null; status: string | null; willRetry: boolean }[] = [];

  try {
    for (let index = 0; index < MAX_JOBS_PER_INVOCATION; index++) {
      const outcome = await runNextAnalysisJob("vercel-cron");
      if (!outcome.ran) break;
      outcomes.push({
        analysisId: outcome.analysisId,
        status: outcome.status,
        willRetry: outcome.willRetry,
      });
      // Leave room for the next job to finish rather than being cut off.
      if (Date.now() - started > 120_000) break;
    }

    logEvent("document_analysis_worker_tick", {
      processed: outcomes.length,
      durationMs: Date.now() - started,
    });

    return NextResponse.json({ ok: true, processed: outcomes.length, outcomes });
  } catch (error) {
    logError("document_analysis_worker_failed", error);
    // 200 on purpose: the individual job already persisted its own failure,
    // and a non-2xx would make Vercel retry the whole tick and re-lease work
    // that is already being handled.
    return NextResponse.json({ ok: false, processed: outcomes.length }, { status: 200 });
  }
}

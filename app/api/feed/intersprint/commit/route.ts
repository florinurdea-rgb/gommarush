import { NextRequest, NextResponse } from "next/server";
import {
  authenticateFeedWorker,
  statusForFeedAuthFailure,
} from "@/lib/auth/feed-worker-auth";
import { continueIntersprintFeedCommit } from "@/lib/server/feed-ingestion";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 170;

/**
 * POST /api/feed/intersprint/commit — applies more of a run already analysed.
 *
 * The worker calls this until `finished` is true. That loop is what keeps an
 * 11,000-row feed inside the serverless time limit WITHOUT ever leaving a
 * half-applied run looking successful: the run reaches 'committed' only when
 * no staged row remains, and until then the file stays in `processing` on the
 * VM and is never archived.
 */
export async function POST(request: NextRequest) {
  const auth = authenticateFeedWorker(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.reason === "not_configured" ? "NOT_CONFIGURED" : "UNAUTHORIZED" },
      { status: statusForFeedAuthFailure(auth.reason) }
    );
  }

  let runId: unknown;
  try {
    const text = await request.text();
    if (text.length > 2_000) {
      return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
    }
    runId = (JSON.parse(text) as { runId?: unknown }).runId;
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
  }

  if (typeof runId !== "string" || !/^[0-9a-f-]{36}$/i.test(runId)) {
    return NextResponse.json({ ok: false, code: "INVALID_RUN_ID" }, { status: 400 });
  }

  try {
    const result = await continueIntersprintFeedCommit(runId, "intersprint-feed-worker");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logError("intersprint_feed_commit_route_failed", error, { runId });
    return NextResponse.json({ ok: false, code: "COMMIT_FAILED" }, { status: 500 });
  }
}

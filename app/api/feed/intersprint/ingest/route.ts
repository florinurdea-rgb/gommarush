import { NextRequest, NextResponse } from "next/server";
import {
  authenticateFeedWorker,
  statusForFeedAuthFailure,
} from "@/lib/auth/feed-worker-auth";
import {
  FeedIngestionError,
  MAX_FEED_BYTES,
  submitIntersprintFeed,
} from "@/lib/server/feed-ingestion";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Analysing 11,000 rows against the whole catalogue and applying the first
// commit batches is well past the default serverless limit.
export const maxDuration = 170;

/**
 * POST /api/feed/intersprint/ingest — the FTP VM hands over a supplier feed.
 *
 * MACHINE ENDPOINT, not an admin one. It is authenticated by a single-purpose
 * bearer token rather than an operator session, because the caller is a cron
 * job on a small VM. That token can submit a supplier feed and nothing else;
 * in particular the VM never holds the Supabase service-role key, which would
 * give a plain-FTP-exposed box RLS-bypassing access to customers and orders.
 *
 * The body is the raw CSV, gzipped (`Content-Encoding: gzip`). Compressing it
 * keeps a 3 MB feed comfortably inside the serverless body limit; the feed
 * compresses roughly tenfold.
 *
 * Identity travels in headers:
 *   x-feed-filename   the supplier's own name, for provenance only
 *   x-feed-checksum   SHA-256 of the UNCOMPRESSED file, verified here
 */

const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const auth = authenticateFeedWorker(request.headers.get("authorization"));
  if (!auth.ok) {
    // Deliberately terse. A machine caller needs a status, not a description
    // of how the secret is configured.
    return NextResponse.json(
      { ok: false, code: auth.reason === "not_configured" ? "NOT_CONFIGURED" : "UNAUTHORIZED" },
      { status: statusForFeedAuthFailure(auth.reason) }
    );
  }

  const fileName = request.headers.get("x-feed-filename")?.trim();
  const checksum = request.headers.get("x-feed-checksum")?.trim();

  if (!fileName || fileName.length > 255 || fileName.includes("/") || fileName.includes("..")) {
    return NextResponse.json({ ok: false, code: "BAD_FILENAME" }, { status: 400 });
  }
  if (!checksum) {
    return NextResponse.json({ ok: false, code: "MISSING_CHECKSUM" }, { status: 400 });
  }

  let body: Buffer;
  try {
    body = Buffer.from(await request.arrayBuffer());
  } catch {
    return NextResponse.json({ ok: false, code: "BODY_UNREADABLE" }, { status: 400 });
  }

  if (body.length > MAX_COMPRESSED_BYTES) {
    return NextResponse.json({ ok: false, code: "BODY_TOO_LARGE" }, { status: 413 });
  }

  const encoding = request.headers.get("content-encoding")?.toLowerCase() ?? "";

  try {
    const result = await submitIntersprintFeed({
      body,
      gzipped: encoding.includes("gzip"),
      fileName,
      expectedChecksum: checksum,
      submittedBy: "intersprint-feed-worker",
    });
    return NextResponse.json({ ok: true, ...result, maxFeedBytes: MAX_FEED_BYTES });
  } catch (error) {
    if (error instanceof FeedIngestionError) {
      return NextResponse.json(
        { ok: false, code: error.code, detail: error.message },
        { status: error.status }
      );
    }
    logError("intersprint_feed_ingest_route_failed", error, { fileName });
    return NextResponse.json({ ok: false, code: "INGESTION_FAILED" }, { status: 500 });
  }
}

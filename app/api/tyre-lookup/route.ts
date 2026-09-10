import { NextRequest, NextResponse } from "next/server";
import { publicTyreLookup } from "@/lib/server/catalogue-lookup";
import { getClientIp, isTyreLookupRateLimited } from "@/lib/rate-limit";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tyre-lookup — public tyre identification by code.
 *
 * Unauthenticated by design: this backs the homepage finder, and a tyre
 * shop should not need an account to check what a barcode is.
 *
 * Everything the response may contain is fixed in publicTyreLookup's
 * projection, which is the actual security boundary — this handler adds
 * rate limiting and refuses to leak internals through its error path.
 */

const MAX_BODY_BYTES = 2_000;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (isTyreLookupRateLimited(ip)) {
    return NextResponse.json({ ok: false, code: "RATE_LIMITED" }, { status: 429 });
  }

  let code: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
    }
    code = (JSON.parse(text) as { code?: unknown }).code;
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
  }

  if (typeof code !== "string") {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
  }

  try {
    const result = await publicTyreLookup(code);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // Deliberately opaque. A database or configuration message on a public
    // endpoint tells an attacker about our schema and tells the customer
    // nothing they can act on.
    logError("tyre_lookup_route_failed", error);
    return NextResponse.json({ ok: false, code: "LOOKUP_FAILED" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AnthropicTyreLookup } from "@/lib/tyre-lookup/anthropic-lookup";
import { getCachedLookup, setCachedLookup } from "@/lib/tyre-lookup/cache";
import { isPlausibleBarcode, normaliseBarcode } from "@/lib/tyre-lookup/normalise";
import { getClientIp, isBarcodeLookupRateLimited } from "@/lib/rate-limit";
import { fail, readJsonBody } from "@/lib/server/route-helpers";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

const bodySchema = z.object({ barcode: z.string().min(1).max(128) }).strict();

const lookup = new AnthropicTyreLookup();

/**
 * Public endpoint (see app/cauta-cauciuc — no login, matches its "entry
 * point on the homepage" requirement). Deliberately isolated from every
 * other logistics route/table: this feature's only job is barcode → tyre
 * identification.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (isBarcodeLookupRateLimited(`tyre-lookup:${ip}`)) {
    logEvent("tyre_lookup_rate_limited", { ip });
    return fail(429, "RATE_LIMITED");
  }

  const body = await readJsonBody(request);
  if (body === null) return fail(400, "VALIDATION_FAILED");

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_FAILED");

  const barcode = normaliseBarcode(parsed.data.barcode);
  if (!isPlausibleBarcode(barcode)) return fail(400, "INVALID_BARCODE");

  const cached = getCachedLookup(barcode);
  if (cached) {
    logEvent("tyre_lookup_cache_hit", { barcode_length: barcode.length });
    return NextResponse.json({ ok: true, result: cached });
  }

  const result = await lookup.lookup(barcode);
  setCachedLookup(barcode, result);
  logEvent("tyre_lookup", { status: result.status, source_count: result.sources.length, ip });

  return NextResponse.json({ ok: true, result });
}

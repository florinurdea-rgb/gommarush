import { NextRequest, NextResponse } from "next/server";
import { adminLoginSchema } from "@/lib/validation/logistics";
import {
  adminSessionCookie,
  isSigningSecretMissingInProduction,
  verifyAdminCredentials,
} from "@/lib/auth/admin-session";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { fail, readJsonBody } from "@/lib/server/route-helpers";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Phase 1 development login (test/test by default, overridable via
 * ADMIN_USERNAME / ADMIN_PASSWORD).
 *
 * The session is a signed, httpOnly server-side cookie — not a client-side
 * flag — so the Admin screens are genuinely gated rather than merely hidden.
 * See src/lib/auth/admin-session.ts for how to swap this for Supabase Auth
 * without touching any page.
 */
export async function POST(request: NextRequest) {
  // Without a stable secret, a cookie signed on this serverless instance can
  // fail to verify on the very next request if it lands on a different
  // instance — the login appears to silently do nothing. Fail loudly instead.
  if (isSigningSecretMissingInProduction()) {
    logEvent("admin_login_blocked_missing_secret", {});
    return fail(500, "ADMIN_SESSION_SECRET_MISSING");
  }

  const ip = getClientIp(request.headers);

  // Reuses the existing limiter, so a shared dev password can't be brute-forced
  // from one address at speed.
  if (isRateLimited(`admin-login:${ip}`)) {
    logEvent("admin_login_rate_limited", { ip });
    return fail(429, "RATE_LIMITED");
  }

  const body = await readJsonBody(request);
  if (body === null) return fail(400, "VALIDATION_FAILED");

  const parsed = adminLoginSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_FAILED");

  const session = verifyAdminCredentials(parsed.data.username, parsed.data.password);
  if (!session) {
    // Deliberately does not distinguish unknown user from wrong password.
    logEvent("admin_login_failed", { ip });
    return fail(401, "INVALID_CREDENTIALS");
  }

  logEvent("admin_login_succeeded", { subject: session.subject });

  const response = NextResponse.json({ ok: true, displayName: session.displayName });
  response.cookies.set(adminSessionCookie(session));
  return response;
}

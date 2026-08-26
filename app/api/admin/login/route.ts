import { NextRequest, NextResponse } from "next/server";
import { adminLoginSchema } from "@/lib/validation/logistics";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmailAllowed } from "@/lib/auth/admin-authorization";
import { checkLoginRateLimit, getClientIp, recordLoginFailure, resetLoginFailures } from "@/lib/rate-limit";
import { fail, readJsonBody } from "@/lib/server/route-helpers";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

/** Never log anything that could re-identify the account from logs alone. */
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  const visible = user.slice(0, 2);
  return `${visible}***@${domain}`;
}

/**
 * Admin login via Supabase Auth. The session lives entirely in the
 * sb-*-auth-token cookie pair that @supabase/ssr manages (see
 * src/lib/supabase/server.ts) — this route's only job is to call
 * signInWithPassword and translate the outcome into a coded JSON response.
 *
 * Two failure codes are deliberately distinct, per the auth/authorization
 * split documented in admin-session.ts:
 *   - 401 INVALID_CREDENTIALS: not a valid Supabase user, or wrong password.
 *   - 403 FORBIDDEN: a real Supabase user, correct password, but not on the
 *     admin allowlist. Reporting that as "wrong password" would be both
 *     misleading and would leak nothing useful to an attacker anyway, since
 *     they'd already proven they know a valid password.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rateLimitKey = `admin-login:${ip}`;

  const rateLimit = checkLoginRateLimit(rateLimitKey);
  if (rateLimit.limited) {
    logEvent("admin_login_rate_limited", { ip, retry_after_seconds: rateLimit.retryAfterSeconds });
    const response = fail(429, "RATE_LIMITED", [String(rateLimit.retryAfterSeconds)]);
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  const body = await readJsonBody(request);
  if (body === null) return fail(400, "VALIDATION_FAILED");

  const parsed = adminLoginSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_FAILED");

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    logEvent("admin_login_supabase_unconfigured", { ip });
    return fail(500, "SUPABASE_NOT_CONFIGURED");
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    recordLoginFailure(rateLimitKey);
    logEvent("admin_login_failed", {
      email: maskEmail(email),
      reason: error?.message ?? "no session returned",
      ip,
    });
    return fail(401, "INVALID_CREDENTIALS");
  }

  if (!isAdminEmailAllowed(data.user.email)) {
    // A real account, correct password — just not an admin. Sign the
    // Supabase session back out so a forbidden login doesn't leave a valid
    // (if useless) session cookie sitting in the browser.
    await supabase.auth.signOut();
    logEvent("admin_login_forbidden", { email: maskEmail(email), user_id: data.user.id, ip });
    return fail(403, "FORBIDDEN");
  }

  resetLoginFailures(rateLimitKey);
  logEvent("admin_login_success", { user_id: data.user.id });

  return NextResponse.json({ ok: true, displayName: data.user.email ?? data.user.id });
}

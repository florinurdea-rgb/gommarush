import { NextRequest, NextResponse } from "next/server";
import { driverLoginSchema } from "@/lib/validation/logistics";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDriverSession } from "@/lib/auth/driver-session";
import { checkLoginRateLimit, getClientIp, recordLoginFailure, resetLoginFailures } from "@/lib/rate-limit";
import { fail, readJsonBody } from "@/lib/server/route-helpers";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
}

/**
 * Driver login via Supabase Auth — same mechanism as /api/admin/login.
 * signInWithPassword() alone is authentication; getDriverSession() (called
 * after) is what decides whether this Supabase user is also a driver
 * (drivers.auth_user_id, claimed by email on first sign-in — see
 * src/lib/auth/driver-session.ts). A real account with no driver link
 * gets 403 NOT_A_DRIVER, and its session is signed back out so a
 * forbidden login doesn't leave a cookie behind — same posture as the
 * admin login route's FORBIDDEN case.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rateLimitKey = `driver-login:${ip}`;

  const rateLimit = checkLoginRateLimit(rateLimitKey);
  if (rateLimit.limited) {
    logEvent("driver_login_rate_limited", { ip, retry_after_seconds: rateLimit.retryAfterSeconds });
    const response = fail(429, "RATE_LIMITED", [String(rateLimit.retryAfterSeconds)]);
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  const body = await readJsonBody(request);
  if (body === null) return fail(400, "VALIDATION_FAILED");

  const parsed = driverLoginSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_FAILED");

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    logEvent("driver_login_supabase_unconfigured", { ip });
    return fail(500, "SUPABASE_NOT_CONFIGURED");
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    recordLoginFailure(rateLimitKey);
    logEvent("driver_login_failed", { email: maskEmail(email), reason: error?.message ?? "no session", ip });
    return fail(401, "INVALID_CREDENTIALS");
  }

  const driverSession = await getDriverSession();
  if (!driverSession) {
    await supabase.auth.signOut();
    logEvent("driver_login_forbidden", { email: maskEmail(email), user_id: data.user.id, ip });
    return fail(403, "NOT_A_DRIVER");
  }

  resetLoginFailures(rateLimitKey);
  logEvent("driver_login_success", { driverId: driverSession.driverId });

  return NextResponse.json({ ok: true, driverName: driverSession.driverName });
}

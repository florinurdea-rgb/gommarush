import { NextRequest, NextResponse } from "next/server";
import { adminLoginSchema } from "@/lib/validation/logistics";
import { adminSessionCookie, verifyAdminCredentials } from "@/lib/auth/admin-session";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { fail, readJsonBody } from "@/lib/server/route-helpers";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Admin login via Supabase Auth. The session cookie holds Supabase's own
 * access token — not a locally-signed one — so verification never depends on
 * a secret that could differ between serverless instances.
 *
 * See src/lib/auth/admin-session.ts for how to create an admin user.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);

  // Protects the Supabase sign-in call from being hammered from one address.
  if (isRateLimited(`admin-login:${ip}`)) {
    logEvent("admin_login_rate_limited", { ip });
    return fail(429, "RATE_LIMITED");
  }

  const body = await readJsonBody(request);
  if (body === null) return fail(400, "VALIDATION_FAILED");

  const parsed = adminLoginSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_FAILED");

  let verified;
  try {
    verified = await verifyAdminCredentials(parsed.data.email, parsed.data.password);
  } catch {
    logEvent("admin_login_supabase_unconfigured", { ip });
    return fail(500, "SUPABASE_NOT_CONFIGURED");
  }

  if (!verified) {
    // Deliberately does not distinguish unknown email from wrong password.
    logEvent("admin_login_failed", { ip });
    return fail(401, "INVALID_CREDENTIALS");
  }

  logEvent("admin_login_succeeded", { subject: verified.session.subject });

  const response = NextResponse.json({ ok: true, displayName: verified.session.displayName });
  response.cookies.set(adminSessionCookie(verified.accessToken));
  return response;
}

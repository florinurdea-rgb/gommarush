import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmailAllowed } from "@/lib/auth/admin-authorization";
import { logError } from "@/lib/logger";

/**
 * Admin authentication via Supabase Auth, backed by @supabase/ssr's cookie
 * adapter (see src/lib/supabase/server.ts and middleware.ts).
 *
 * This replaced two earlier designs in turn:
 *   1. A locally-signed cookie whose signing key fell back to a per-process
 *      random value when unset — a cookie signed by one serverless instance
 *      silently failed verification on another.
 *   2. A first Supabase Auth pass that stored only the raw access token in a
 *      plain cookie, with no refresh token — sessions worked but hard-expired
 *      after Supabase's ~1 hour access-token TTL with no way to renew them.
 *
 * @supabase/ssr fixes both: the cookie pair (access + refresh token) is
 * managed by Supabase's own client code, and middleware.ts calls
 * `auth.getUser()` on every /admin request, which transparently refreshes an
 * expired access token using the refresh token and rewrites the cookies.
 *
 * Creating an admin user: Supabase dashboard → Authentication → Users →
 * Add user (or /admin/bootstrap in this app, which avoids that dashboard
 * flow's "Invite" email-deliverability checks). Set "Auto Confirm User" so
 * no email-confirmation step blocks the first login.
 *
 * Authentication vs. authorization: any confirmed Supabase user in this
 * project can sign in, but only an email on ADMIN_ALLOWED_EMAILS (when set)
 * is treated as an admin — see admin-authorization.ts.
 */

export interface AdminSession {
  /** The Supabase user id — stable identifier for audit trails. */
  subject: string;
  displayName: string;
  provider: "supabase";
}

/**
 * Reads and verifies the current session by asking Supabase to validate the
 * cookie's access token (refreshing it first if middleware hasn't already).
 * Returns null when not signed in, the token is invalid/expired, or the
 * user is authenticated but not an allowed admin.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    if (!isAdminEmailAllowed(data.user.email)) return null;

    return {
      subject: data.user.id,
      displayName: data.user.email ?? data.user.id,
      provider: "supabase",
    };
  } catch (error) {
    // Missing Supabase client configuration, network error, etc. — treat as
    // not signed in rather than crashing every page that checks the session.
    // Logged so a config problem is diagnosable server-side without ever
    // surfacing as anything more specific than "not signed in" to the caller.
    logError("admin_session_check_failed", error);
    return null;
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * Server-side guard for every privileged page and route. Throws rather than
 * returning null so a forgotten check can't silently fall through to a
 * privileged code path.
 */
export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

/**
 * Admin authorization — separate from authentication.
 *
 * A valid Supabase Auth user is not automatically an admin. When
 * ADMIN_ALLOWED_EMAILS is set (comma-separated), only those addresses may
 * use the admin panel; anyone else authenticates successfully but is
 * forbidden (403), not "wrong password" (401) — those are different
 * failures and must not be reported as the same one.
 *
 * When ADMIN_ALLOWED_EMAILS is unset, any confirmed Supabase user in the
 * project may sign in — Phase 1's original single-admin-tier default,
 * preserved so existing deployments don't get locked out by this becoming
 * stricter. Set the allowlist once real operators are onboarded.
 *
 * No "server-only" import: middleware.ts (Edge runtime) needs this too.
 *
 * Parses ADMIN_ALLOWED_EMAILS on every call rather than once at module load:
 * this is called at most once per request, so the cost is negligible, and it
 * avoids a stale list surviving in memory for the life of a long-running
 * instance if the env var is ever updated without a full redeploy.
 */
export function isAdminEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;

  const allowedEmails = (process.env.ADMIN_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (allowedEmails.length === 0) return true;
  return allowedEmails.includes(email.toLowerCase());
}

import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Admin authentication via Supabase Auth.
 *
 * Replaces the earlier locally-signed-cookie design. That design failed on
 * Vercel because it fell back to a per-process random signing key when
 * ADMIN_SESSION_SECRET wasn't set: the login route and the very next page
 * request can land on two different serverless instances, each with its own
 * random key, so a cookie signed by one silently failed verification on the
 * other — "log in, nothing happens, still on the login page."
 *
 * Supabase Auth has no equivalent failure mode: the cookie stores Supabase's
 * own access token, and every request validates it against Supabase's Auth
 * service directly (`supabase.auth.getUser(token)`). There is no local secret
 * to go out of sync between instances.
 *
 * Creating an admin user: Supabase dashboard → Authentication → Users →
 * Add user. Set "Auto Confirm User" so no email-confirmation step blocks the
 * first login. Any confirmed user in this Supabase project can sign in here —
 * Phase 1 has no separate admin-role table, matching the rest of the app's
 * single-admin-tier model.
 *
 * Trade-off accepted for now: sessions last as long as the Supabase access
 * token (its default TTL, typically 1 hour) — there is no refresh-token flow
 * yet, so an admin has to sign in again after it expires. Good enough for
 * Phase 1; a refresh flow can be added later without changing this module's
 * public contract (`getAdminSession` / `requireAdminSession`).
 */

const COOKIE_NAME = "gorush_admin_session";
/** Matches Supabase's default access-token TTL; the cookie should never outlive the token it holds. */
const SESSION_TTL_SECONDS = 60 * 60;

export interface AdminSession {
  /** The Supabase user id — stable identifier for audit trails. */
  subject: string;
  displayName: string;
  issuedAt: number;
  expiresAt: number;
  provider: "supabase";
}

function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing Supabase client configuration");
  }
  // The anon key is intentional here (not the service-role key): signing in
  // and validating a token are both public Supabase Auth operations that do
  // not need to bypass Row Level Security.
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface VerifiedCredentials {
  session: AdminSession;
  accessToken: string;
}

/**
 * Verifies email/password against Supabase Auth. Returns the access token to
 * store in the session cookie — that token, not any local signature, is what
 * every subsequent request will be checked against.
 */
export async function verifyAdminCredentials(
  email: string,
  password: string
): Promise<VerifiedCredentials | null> {
  const supabase = authClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) return null;

  const now = Date.now();
  return {
    accessToken: data.session.access_token,
    session: {
      subject: data.user.id,
      displayName: data.user.email ?? data.user.id,
      issuedAt: now,
      expiresAt: now + SESSION_TTL_SECONDS * 1000,
      provider: "supabase",
    },
  };
}

// ---------------------------------------------------------------------------
// Cookie plumbing
// ---------------------------------------------------------------------------

export function adminSessionCookie(accessToken: string) {
  return {
    name: COOKIE_NAME,
    // The cookie holds the raw Supabase access token directly — there is
    // nothing to encode/sign locally, which is exactly what removes the
    // cross-instance failure mode.
    value: accessToken,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function clearedAdminSessionCookie() {
  return {
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
}

/**
 * Reads and verifies the current session by asking Supabase to validate the
 * access token. Returns null when not signed in or the token is invalid/expired.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const accessToken = store.get(COOKIE_NAME)?.value;
  if (!accessToken) return null;

  try {
    const supabase = authClient();
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) return null;

    return {
      subject: data.user.id,
      displayName: data.user.email ?? data.user.id,
      issuedAt: 0,
      expiresAt: 0,
      provider: "supabase",
    };
  } catch {
    // Missing Supabase client configuration, network error, etc. — treat as
    // not signed in rather than crashing every page that checks the session.
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

export const ADMIN_SESSION_COOKIE_NAME = COOKIE_NAME;

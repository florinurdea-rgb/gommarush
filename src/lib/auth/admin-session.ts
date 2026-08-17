import "server-only";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Phase 1 Admin authentication.
 *
 * ⚠️ THIS IS DEVELOPMENT AUTHENTICATION. It is a single shared username and
 * password, and it is not presented as production security anywhere in the UI.
 * It exists so the Admin screens can be built and operated now.
 *
 * What makes it more than "hiding buttons in the browser":
 *   * the session is a server-side HMAC-signed cookie the browser cannot forge
 *   * the cookie is httpOnly + sameSite=lax (+ secure in production)
 *   * every privileged route calls `requireAdminSession()` server-side; nothing
 *     relies on the client not rendering a button
 *
 * REPLACING THIS WITH SUPABASE AUTH LATER
 * The Admin UI never touches this file directly — it goes through
 * `getAdminSession()` / `requireAdminSession()` and the `AdminSession` shape.
 * Swapping in Supabase Auth means reimplementing those two functions against
 * `supabase.auth.getUser()` and returning the same shape. No page, route or
 * component changes. `AdminAuthProvider` below documents that contract.
 */

const COOKIE_NAME = "gorush_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h — a warehouse shift plus slack.

export interface AdminSession {
  /** Stable identifier for audit trails (`changed_by`, `operator_session`). */
  subject: string;
  displayName: string;
  issuedAt: number;
  expiresAt: number;
  /** Which auth backend issued this. Lets audit rows record how it was granted. */
  provider: "dev-credentials" | "supabase";
}

/**
 * The contract the Admin UI depends on. Implement this against Supabase Auth to
 * replace the dev login without touching any page.
 */
export interface AdminAuthProvider {
  signIn(username: string, password: string): Promise<AdminSession | null>;
  getSession(): Promise<AdminSession | null>;
  signOut(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * The signing secret. In production ADMIN_SESSION_SECRET must be set — without
 * it we fall back to a per-process random key, which means every deploy and
 * every serverless instance invalidates sessions (annoying but never insecure).
 * We deliberately do NOT fall back to a hardcoded constant.
 */
let ephemeralSecret: string | null = null;

function signingSecret(): string {
  const configured = process.env.ADMIN_SESSION_SECRET;
  if (configured && configured.length >= 16) return configured;

  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString("hex");
    if (process.env.NODE_ENV === "production") {
      console.warn(
        JSON.stringify({
          event: "admin_session_secret_missing",
          message:
            "ADMIN_SESSION_SECRET is not set; using an ephemeral per-instance key. Admin sessions will not survive a redeploy.",
        })
      );
    }
  }
  return ephemeralSecret;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

/** Constant-time comparison — a length mismatch alone must not leak. */
function signaturesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function encodeSessionToken(session: AdminSession): string {
  const payload = base64UrlEncode(JSON.stringify(session));
  return `${payload}.${sign(payload)}`;
}

export function decodeSessionToken(token: string | undefined | null): AdminSession | null {
  if (!token) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!signaturesMatch(signature, sign(payload))) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as AdminSession;
    if (typeof parsed.subject !== "string" || typeof parsed.expiresAt !== "number") return null;
    if (parsed.expiresAt <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Credential check
// ---------------------------------------------------------------------------

/**
 * Phase 1 credentials, overridable by env so a deployment isn't stuck with
 * test/test. Defaults are the documented development pair.
 */
function expectedCredentials(): { username: string; password: string } {
  return {
    username: process.env.ADMIN_USERNAME ?? "test",
    password: process.env.ADMIN_PASSWORD ?? "test",
  };
}

/** Constant-time string equality, safe for differing lengths. */
function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  // Hash both first so the comparison length is always identical.
  const hashA = createHmac("sha256", signingSecret()).update(bufferA).digest();
  const hashB = createHmac("sha256", signingSecret()).update(bufferB).digest();
  return timingSafeEqual(hashA, hashB);
}

export function verifyAdminCredentials(username: string, password: string): AdminSession | null {
  const expected = expectedCredentials();
  const userOk = safeEquals(username.trim(), expected.username);
  const passOk = safeEquals(password, expected.password);
  // Both checks always run, so timing doesn't reveal which half was wrong.
  if (!userOk || !passOk) return null;

  const now = Date.now();
  return {
    subject: `admin:${expected.username}`,
    displayName: expected.username,
    issuedAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
    provider: "dev-credentials",
  };
}

// ---------------------------------------------------------------------------
// Cookie plumbing
// ---------------------------------------------------------------------------

export function adminSessionCookie(session: AdminSession) {
  return {
    name: COOKIE_NAME,
    value: encodeSessionToken(session),
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

/** Reads and verifies the current session. Returns null when not signed in. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  return decodeSessionToken(store.get(COOKIE_NAME)?.value);
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

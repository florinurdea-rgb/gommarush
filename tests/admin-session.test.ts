import { beforeEach, describe, expect, it } from "vitest";

/**
 * Phase 1 admin session security.
 *
 * The dev credentials are not the point — the point is that the session is a
 * signed server-side token a browser cannot forge, so the Admin UI is genuinely
 * gated rather than merely hidden.
 */

process.env.ADMIN_SESSION_SECRET = "test-secret-value-at-least-16-chars";
process.env.ADMIN_USERNAME = "test";
process.env.ADMIN_PASSWORD = "test";

// server-only throws when imported outside a server context; vitest runs in
// node, so stub it away.
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }) }));

const {
  decodeSessionToken,
  encodeSessionToken,
  verifyAdminCredentials,
  adminSessionCookie,
  clearedAdminSessionCookie,
} = await import("@/lib/auth/admin-session");

describe("verifyAdminCredentials", () => {
  it("accepts the configured credentials", () => {
    const session = verifyAdminCredentials("test", "test");
    expect(session).not.toBeNull();
    expect(session?.subject).toBe("admin:test");
    expect(session?.provider).toBe("dev-credentials");
  });

  it("rejects a wrong password and a wrong username identically", () => {
    expect(verifyAdminCredentials("test", "wrong")).toBeNull();
    expect(verifyAdminCredentials("wrong", "test")).toBeNull();
    expect(verifyAdminCredentials("", "")).toBeNull();
  });

  it("tolerates surrounding whitespace in the username", () => {
    expect(verifyAdminCredentials("  test  ", "test")).not.toBeNull();
  });
});

describe("session token", () => {
  let token: string;

  beforeEach(() => {
    token = encodeSessionToken(verifyAdminCredentials("test", "test")!);
  });

  it("round-trips a valid token", () => {
    const decoded = decodeSessionToken(token);
    expect(decoded?.subject).toBe("admin:test");
  });

  it("rejects a tampered payload — the whole point of signing it", () => {
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        subject: "admin:attacker",
        displayName: "attacker",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 100000,
        provider: "dev-credentials",
      }),
      "utf8"
    ).toString("base64url");

    expect(decodeSessionToken(`${forged}.${signature}`)).toBeNull();
    expect(decodeSessionToken(`${payload}.deadbeef`)).toBeNull();
  });

  it("rejects malformed and empty tokens", () => {
    expect(decodeSessionToken(undefined)).toBeNull();
    expect(decodeSessionToken("")).toBeNull();
    expect(decodeSessionToken("no-separator")).toBeNull();
    expect(decodeSessionToken(".onlysignature")).toBeNull();
  });

  it("rejects an expired session", () => {
    const expired = encodeSessionToken({
      subject: "admin:test",
      displayName: "test",
      issuedAt: Date.now() - 10_000,
      expiresAt: Date.now() - 1,
      provider: "dev-credentials",
    });
    expect(decodeSessionToken(expired)).toBeNull();
  });
});

describe("cookie flags", () => {
  it("is httpOnly and sameSite=lax, so it cannot be read or forged by scripts", () => {
    const cookie = adminSessionCookie(verifyAdminCredentials("test", "test")!);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.path).toBe("/");
    expect(cookie.maxAge).toBeGreaterThan(0);
  });

  it("clears with an immediate expiry", () => {
    expect(clearedAdminSessionCookie().maxAge).toBe(0);
  });
});

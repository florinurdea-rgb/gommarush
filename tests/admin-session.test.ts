import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin session security, backed by Supabase Auth.
 *
 * The property under test: session validity is decided entirely by Supabase's
 * Auth service (mocked here), never by a local secret — which is exactly what
 * removes the earlier design's failure mode (a locally-signed cookie that
 * silently stopped validating whenever a request landed on a different
 * serverless instance with its own random signing key).
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

vi.mock("server-only", () => ({}));

const mockSignInWithPassword = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      getUser: mockGetUser,
    },
  }),
}));

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }),
}));

const {
  verifyAdminCredentials,
  getAdminSession,
  requireAdminSession,
  adminSessionCookie,
  clearedAdminSessionCookie,
  UnauthorizedError,
} = await import("@/lib/auth/admin-session");

const FAKE_USER = { id: "user-123", email: "admin@gommarush.com" };
const FAKE_SESSION = { access_token: "fake-access-token" };

beforeEach(() => {
  mockSignInWithPassword.mockReset();
  mockGetUser.mockReset();
  cookieValue = undefined;
});

describe("verifyAdminCredentials", () => {
  it("returns a session and the access token on success", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: FAKE_USER, session: FAKE_SESSION },
      error: null,
    });

    const result = await verifyAdminCredentials("admin@gommarush.com", "correct-password");

    expect(result).not.toBeNull();
    expect(result?.accessToken).toBe("fake-access-token");
    expect(result?.session.subject).toBe("user-123");
    expect(result?.session.displayName).toBe("admin@gommarush.com");
    expect(result?.session.provider).toBe("supabase");
  });

  it("returns null on wrong credentials", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    });

    expect(await verifyAdminCredentials("admin@gommarush.com", "wrong")).toBeNull();
  });

  it("returns null if Supabase reports success but omits a session", async () => {
    // Defensive: never treat a malformed success response as authenticated.
    mockSignInWithPassword.mockResolvedValue({ data: { user: FAKE_USER, session: null }, error: null });
    expect(await verifyAdminCredentials("admin@gommarush.com", "x")).toBeNull();
  });
});

describe("getAdminSession", () => {
  it("returns null when there is no cookie at all", async () => {
    cookieValue = undefined;
    expect(await getAdminSession()).toBeNull();
  });

  it("validates the cookie's token against Supabase, not any local secret", async () => {
    cookieValue = "some-access-token";
    mockGetUser.mockResolvedValue({ data: { user: FAKE_USER }, error: null });

    const session = await getAdminSession();
    expect(session?.subject).toBe("user-123");
    expect(session?.displayName).toBe("admin@gommarush.com");
    expect(mockGetUser).toHaveBeenCalledWith("some-access-token");
  });

  it("returns null for a token Supabase rejects (expired, revoked, forged)", async () => {
    cookieValue = "bad-token";
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid token" } });

    expect(await getAdminSession()).toBeNull();
  });

  it("fails closed rather than crashing when Supabase client config is missing", async () => {
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    cookieValue = "some-token";

    await expect(getAdminSession()).resolves.toBeNull();

    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  });
});

describe("requireAdminSession", () => {
  it("throws UnauthorizedError rather than falling through when signed out", async () => {
    cookieValue = undefined;
    await expect(requireAdminSession()).rejects.toThrow(UnauthorizedError);
  });

  it("returns the session when signed in", async () => {
    cookieValue = "valid-token";
    mockGetUser.mockResolvedValue({ data: { user: FAKE_USER }, error: null });
    await expect(requireAdminSession()).resolves.toMatchObject({ subject: "user-123" });
  });
});

describe("cookie flags", () => {
  it("is httpOnly and sameSite=lax, and stores the raw Supabase access token", () => {
    const cookie = adminSessionCookie("some-token");
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.path).toBe("/");
    expect(cookie.value).toBe("some-token");
    expect(cookie.maxAge).toBeGreaterThan(0);
  });

  it("clears with an immediate expiry", () => {
    expect(clearedAdminSessionCookie().maxAge).toBe(0);
  });
});

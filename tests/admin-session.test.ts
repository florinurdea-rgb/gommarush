import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin session security, backed by Supabase Auth via @supabase/ssr.
 *
 * The property under test: session validity is decided entirely by asking
 * Supabase to validate the request's cookies (mocked here), never by a local
 * secret — which is what removes the earlier design's failure mode (a
 * locally-signed cookie that silently stopped validating whenever a request
 * landed on a different serverless instance with its own random signing
 * key).
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
delete process.env.ADMIN_ALLOWED_EMAILS;

vi.mock("server-only", () => ({}));

const mockGetUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

const { getAdminSession, requireAdminSession, UnauthorizedError } = await import(
  "@/lib/auth/admin-session"
);

const FAKE_USER = { id: "user-123", email: "admin@gommarush.com" };

beforeEach(() => {
  mockGetUser.mockReset();
  delete process.env.ADMIN_ALLOWED_EMAILS;
});

describe("getAdminSession", () => {
  it("returns null when Supabase reports no user (no cookie, expired, or invalid)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    expect(await getAdminSession()).toBeNull();
  });

  it("returns the session for a Supabase user Supabase validates", async () => {
    mockGetUser.mockResolvedValue({ data: { user: FAKE_USER }, error: null });

    const session = await getAdminSession();
    expect(session?.subject).toBe("user-123");
    expect(session?.displayName).toBe("admin@gommarush.com");
    expect(session?.provider).toBe("supabase");
  });

  it("returns null for a user Supabase rejects (expired, revoked, forged token)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid token" } });
    expect(await getAdminSession()).toBeNull();
  });

  it("fails closed rather than crashing when Supabase client config is missing", async () => {
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    await expect(getAdminSession()).resolves.toBeNull();

    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  });

  it("authentication is not authorization: a valid Supabase user outside the allowlist is still null", async () => {
    process.env.ADMIN_ALLOWED_EMAILS = "someone-else@gommarush.com";
    mockGetUser.mockResolvedValue({ data: { user: FAKE_USER }, error: null });

    expect(await getAdminSession()).toBeNull();
  });

  it("allows any confirmed user when no allowlist is configured (Phase 1 default)", async () => {
    expect(process.env.ADMIN_ALLOWED_EMAILS).toBeUndefined();
    mockGetUser.mockResolvedValue({ data: { user: FAKE_USER }, error: null });

    expect(await getAdminSession()).not.toBeNull();
  });
});

describe("requireAdminSession", () => {
  it("throws UnauthorizedError rather than falling through when signed out", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    await expect(requireAdminSession()).rejects.toThrow(UnauthorizedError);
  });

  it("returns the session when signed in", async () => {
    mockGetUser.mockResolvedValue({ data: { user: FAKE_USER }, error: null });
    await expect(requireAdminSession()).resolves.toMatchObject({ subject: "user-123" });
  });
});

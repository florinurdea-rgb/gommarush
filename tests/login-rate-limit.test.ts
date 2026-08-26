import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The login rate limiter must count only failed attempts — counting
 * successes or page loads would lock out a legitimate admin just for using
 * the product, defeating the point of a brute-force guard.
 */

process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = "3";
process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES = "1";

vi.mock("server-only", () => ({}));

const { checkLoginRateLimit, recordLoginFailure, resetLoginFailures } = await import(
  "@/lib/rate-limit"
);

beforeEach(() => {
  vi.useRealTimers();
});

describe("login rate limiting", () => {
  it("is not limited before any failures", () => {
    expect(checkLoginRateLimit("key-a").limited).toBe(false);
  });

  it("limits after the configured number of failures, with a positive retry-after", () => {
    const key = "key-b";
    recordLoginFailure(key);
    recordLoginFailure(key);
    expect(checkLoginRateLimit(key).limited).toBe(false); // 2 failures, max is 3

    recordLoginFailure(key);
    const status = checkLoginRateLimit(key);
    expect(status.limited).toBe(true);
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("a successful login resets the count so it does not linger", () => {
    const key = "key-c";
    recordLoginFailure(key);
    recordLoginFailure(key);
    recordLoginFailure(key);
    expect(checkLoginRateLimit(key).limited).toBe(true);

    resetLoginFailures(key);
    expect(checkLoginRateLimit(key).limited).toBe(false);
  });

  it("tracks each key independently", () => {
    recordLoginFailure("ip-1");
    recordLoginFailure("ip-1");
    recordLoginFailure("ip-1");
    expect(checkLoginRateLimit("ip-1").limited).toBe(true);
    expect(checkLoginRateLimit("ip-2").limited).toBe(false);
  });
});

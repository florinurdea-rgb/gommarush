import { describe, it, expect } from "vitest";
import { classifyFreshness, ageHours, DEFAULT_STALE_MULTIPLIER } from "./freshness";

const NOW = new Date("2026-09-21T12:00:00Z");
const policy = { ttlHours: 24 };

function hoursAgo(h: number): Date {
  return new Date(NOW.getTime() - h * 3_600_000);
}

describe("freshness is deterministic business logic", () => {
  it("FRESH within the TTL", () => {
    expect(classifyFreshness(hoursAgo(0), policy, NOW)).toBe("FRESH");
    expect(classifyFreshness(hoursAgo(23), policy, NOW)).toBe("FRESH");
    expect(classifyFreshness(hoursAgo(24), policy, NOW)).toBe("FRESH");
  });

  it("AGEING between TTL and TTL x staleMultiplier", () => {
    expect(classifyFreshness(hoursAgo(25), policy, NOW)).toBe("AGEING");
    expect(classifyFreshness(hoursAgo(48), policy, NOW)).toBe("AGEING");
  });

  it("STALE beyond TTL x staleMultiplier", () => {
    expect(classifyFreshness(hoursAgo(49), policy, NOW)).toBe("STALE");
    expect(classifyFreshness(hoursAgo(24 * 30), policy, NOW)).toBe("STALE");
  });

  it("honours a per-lane stale multiplier", () => {
    const wide = { ttlHours: 24, staleMultiplier: 4 };
    expect(classifyFreshness(hoursAgo(90), wide, NOW)).toBe("AGEING");
    expect(classifyFreshness(hoursAgo(97), wide, NOW)).toBe("STALE");
    expect(DEFAULT_STALE_MULTIPLIER).toBe(2);
  });

  it("returns the SAME answer for the same inputs - no drift", () => {
    const a = classifyFreshness(hoursAgo(30), policy, NOW);
    const b = classifyFreshness(hoursAgo(30), policy, NOW);
    expect(a).toBe(b);
  });
});

describe("freshness never optimistically assumes currency", () => {
  it("UNKNOWN when there is no observation timestamp", () => {
    expect(classifyFreshness(null, policy, NOW)).toBe("UNKNOWN");
    expect(classifyFreshness(undefined, policy, NOW)).toBe("UNKNOWN");
  });

  it("UNKNOWN when the lane has no configured TTL", () => {
    expect(classifyFreshness(hoursAgo(1), { ttlHours: null }, NOW)).toBe("UNKNOWN");
    expect(classifyFreshness(hoursAgo(1), { ttlHours: 0 }, NOW)).toBe("UNKNOWN");
    expect(classifyFreshness(hoursAgo(1), { ttlHours: -5 }, NOW)).toBe("UNKNOWN");
  });

  it("UNKNOWN for an unparseable timestamp", () => {
    expect(classifyFreshness("not-a-date", policy, NOW)).toBe("UNKNOWN");
  });

  it("UNKNOWN for a future timestamp (clock skew), never FRESH", () => {
    expect(classifyFreshness(new Date(NOW.getTime() + 3_600_000), policy, NOW)).toBe(
      "UNKNOWN",
    );
  });

  it("accepts ISO strings as well as Dates", () => {
    expect(classifyFreshness("2026-09-21T11:00:00Z", policy, NOW)).toBe("FRESH");
  });
});

describe("ageHours for operator display", () => {
  it("reports whole hours since observation", () => {
    expect(ageHours(hoursAgo(3), NOW)).toBe(3);
    expect(ageHours(hoursAgo(0.5), NOW)).toBe(0);
  });

  it("returns null when unusable", () => {
    expect(ageHours(null, NOW)).toBeNull();
    expect(ageHours("nope", NOW)).toBeNull();
    expect(ageHours(new Date(NOW.getTime() + 1000), NOW)).toBeNull();
  });
});

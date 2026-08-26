import { describe, expect, it } from "vitest";
import { resolvePeriod } from "@/lib/logistics/summary-period";

const today = new Date(2026, 7, 18); // 18 Aug 2026 (local, no TZ surprises for date-only math)

describe("resolvePeriod", () => {
  it("today is a single-day range", () => {
    expect(resolvePeriod("today", today)).toEqual({ start: "2026-08-18", end: "2026-08-18" });
  });

  it("yesterday is the single day before", () => {
    expect(resolvePeriod("yesterday", today)).toEqual({ start: "2026-08-17", end: "2026-08-17" });
  });

  it("7d spans the last 7 days inclusive of today", () => {
    expect(resolvePeriod("7d", today)).toEqual({ start: "2026-08-12", end: "2026-08-18" });
  });

  it("this_month starts on the 1st", () => {
    expect(resolvePeriod("this_month", today)).toEqual({ start: "2026-08-01", end: "2026-08-18" });
  });

  it("last_month is the entire previous calendar month", () => {
    expect(resolvePeriod("last_month", today)).toEqual({ start: "2026-07-01", end: "2026-07-31" });
  });

  it("last_month across a year boundary", () => {
    const january = new Date(2026, 0, 15);
    expect(resolvePeriod("last_month", january)).toEqual({ start: "2025-12-01", end: "2025-12-31" });
  });

  it("custom uses the given start/end", () => {
    expect(resolvePeriod("custom", today, { start: "2026-01-01", end: "2026-01-31" })).toEqual({
      start: "2026-01-01",
      end: "2026-01-31",
    });
  });

  it("custom swaps a reversed range instead of returning an empty one", () => {
    expect(resolvePeriod("custom", today, { start: "2026-01-31", end: "2026-01-01" })).toEqual({
      start: "2026-01-01",
      end: "2026-01-31",
    });
  });

  it("custom falls back to the last 7 days when dates are missing", () => {
    expect(resolvePeriod("custom", today, {})).toEqual({ start: "2026-08-12", end: "2026-08-18" });
  });
});

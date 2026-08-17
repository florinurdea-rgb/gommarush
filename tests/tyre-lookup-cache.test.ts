import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TyreLookupResult } from "@/lib/tyre-lookup/types";

vi.mock("server-only", () => ({}));

const { getCachedLookup, setCachedLookup } = await import("@/lib/tyre-lookup/cache");

function identifiedResult(barcode: string): TyreLookupResult {
  return {
    status: "identified",
    barcode,
    brand: "Goodyear",
    model: "Eagle F1",
    width: 225,
    aspectRatio: 40,
    rimDiameter: 18,
    loadIndex: "92",
    speedRating: "Y",
    extraLoad: true,
    runFlat: false,
    season: "summer",
    ean: barcode,
    manufacturerCode: null,
    sources: [{ url: "https://example.com", title: "Example" }],
    notes: [],
    error: null,
    cached: false,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("tyre lookup cache", () => {
  it("returns null for a barcode that was never cached", () => {
    expect(getCachedLookup("never-seen-barcode")).toBeNull();
  });

  it("returns a cached result marked cached:true, without mutating the stored copy", () => {
    const barcode = `cache-hit-${Date.now()}`;
    setCachedLookup(barcode, identifiedResult(barcode));

    const first = getCachedLookup(barcode);
    expect(first?.cached).toBe(true);
    expect(first?.brand).toBe("Goodyear");

    // The stored entry itself must stay status-true "identified" data, not
    // get corrupted by returning the same object reference to callers.
    const second = getCachedLookup(barcode);
    expect(second?.brand).toBe("Goodyear");
  });

  it("never caches a technical failure — it must be retried, not stuck", () => {
    const barcode = `never-cached-${Date.now()}`;
    setCachedLookup(barcode, { ...identifiedResult(barcode), status: "failed", brand: null });
    expect(getCachedLookup(barcode)).toBeNull();
  });

  it("never caches an unconfigured result", () => {
    const barcode = `never-cached-unconfigured-${Date.now()}`;
    setCachedLookup(barcode, { ...identifiedResult(barcode), status: "unconfigured", brand: null });
    expect(getCachedLookup(barcode)).toBeNull();
  });
});

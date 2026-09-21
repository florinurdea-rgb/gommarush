import { describe, expect, it } from "vitest";
import {
  classifyObservation,
  isCommerciallyUsable,
  assertCommerciallyUsable,
  excludeTestObservations,
  DELDO_DOCUMENTED_FEED_INTERVAL_MS,
  type SupplierObservation,
  type FreshnessPolicy,
} from "@/lib/suppliers/observation";
import {
  DELDO_CAPABILITIES,
  DELDO_ORDERING_CAPABILITIES,
  isCapabilityAvailable,
  documentedButNotImplemented,
  getDeldoCapability,
} from "@/lib/suppliers/deldo/capabilities";

const NOW = new Date("2026-09-21T12:00:00Z");
const POLICY: FreshnessPolicy = { staleAfterMs: 2 * 60 * 60 * 1000 };

function observation(
  overrides: Partial<SupplierObservation> = {}
): SupplierObservation {
  return {
    laneCode: "deldo",
    classification: "live",
    source: "bulk_feed",
    observedAt: new Date("2026-09-21T11:30:00Z"),
    purchasePrice: 48.5,
    currency: "EUR",
    stockExact: 13,
    stockRaw: "13",
    commercialMode: "transport_separate",
    ...overrides,
  };
}

describe("observation freshness", () => {
  it("treats a recent, complete, live observation as current", () => {
    const state = classifyObservation(observation(), POLICY, NOW);
    expect(state.state).toBe("current");
    expect(isCommerciallyUsable(state)).toBe(true);
  });

  it("treats an observation older than the policy as stale", () => {
    const state = classifyObservation(
      observation({ observedAt: new Date("2026-09-21T09:00:00Z") }),
      POLICY,
      NOW
    );
    expect(state.state).toBe("stale");
    // Stale is deliberately NOT commercially usable. Whether a stale price may
    // be shown with a caveat is a product decision, not this function's.
    expect(isCommerciallyUsable(state)).toBe(false);
  });

  it("reports no usable observation when there is none", () => {
    const state = classifyObservation(null, POLICY, NOW);
    expect(state).toEqual({
      state: "no_usable_observation",
      reason: "no_observation",
    });
  });

  it("distinguishes zero stock from unknown stock", () => {
    // Zero is a real answer — the supplier has none — and stays usable.
    const zero = classifyObservation(observation({ stockExact: 0 }), POLICY, NOW);
    expect(zero.state).toBe("current");

    // Null means the supplier did not say, which cannot be reasoned about.
    const unknown = classifyObservation(
      observation({ stockExact: null }),
      POLICY,
      NOW
    );
    expect(unknown).toEqual({
      state: "no_usable_observation",
      reason: "unknown_stock",
    });
  });

  it("refuses an observation with no price", () => {
    const state = classifyObservation(
      observation({ purchasePrice: null }),
      POLICY,
      NOW
    );
    expect(state).toEqual({
      state: "no_usable_observation",
      reason: "missing_price",
    });
  });

  /**
   * Deldo's feed has two commercial modes and the same number means different
   * things under each. Until GoRush confirms which it receives, the price
   * cannot be marked up or compared.
   */
  it("refuses a price whose commercial meaning is unknown", () => {
    const state = classifyObservation(
      observation({ commercialMode: "unknown" }),
      POLICY,
      NOW
    );
    expect(state).toEqual({
      state: "no_usable_observation",
      reason: "unknown_commercial_mode",
    });
  });

  it("refuses a future timestamp instead of treating it as maximally fresh", () => {
    const state = classifyObservation(
      observation({ observedAt: new Date("2026-09-21T13:00:00Z") }),
      POLICY,
      NOW
    );
    expect(state).toEqual({
      state: "no_usable_observation",
      reason: "observed_in_future",
    });
  });

  it("records Deldo's documented hourly cadence without making it a policy", () => {
    expect(DELDO_DOCUMENTED_FEED_INTERVAL_MS).toBe(3_600_000);
    // The cadence is how often data arrives. How long GommaRush relies on it
    // is a separate, configurable decision — the two must not be the same
    // number by accident.
    expect(POLICY.staleAfterMs).not.toBe(DELDO_DOCUMENTED_FEED_INTERVAL_MS);
  });
});

describe("test-data safety boundary", () => {
  /**
   * The single most important test in this mission.
   *
   * 26933TEST.csv carries fictional prices and quantities. A fresh, complete,
   * perfectly well-formed test observation is exactly the input that would
   * pass a freshness check written in the obvious order, and a fictional price
   * reaching a customer or a purchase order would look entirely normal on the
   * way there.
   */
  it("never reports test data as current, however fresh and complete it is", () => {
    const state = classifyObservation(
      observation({
        classification: "test",
        observedAt: NOW, // as fresh as it is possible to be
      }),
      POLICY,
      NOW
    );
    expect(state).toEqual({ state: "test_data" });
    expect(isCommerciallyUsable(state)).toBe(false);
  });

  it("classifies test data as test even when it is also stale and incomplete", () => {
    const state = classifyObservation(
      observation({
        classification: "test",
        observedAt: new Date("2020-01-01T00:00:00Z"),
        purchasePrice: null,
        stockExact: null,
      }),
      POLICY,
      NOW
    );
    // Test data is its own state, never swept into a generic "no data" branch
    // where it could later be mistaken for a transient gap.
    expect(state.state).toBe("test_data");
  });

  it("throws rather than returning false when a commitment path asks", () => {
    const testState = classifyObservation(
      observation({ classification: "test" }),
      POLICY,
      NOW
    );
    expect(() => assertCommerciallyUsable(testState, "supplier purchase")).toThrow(
      /test_data/
    );

    const staleState = classifyObservation(
      observation({ observedAt: new Date("2026-09-20T00:00:00Z") }),
      POLICY,
      NOW
    );
    expect(() => assertCommerciallyUsable(staleState, "customer offer")).toThrow(
      /stale/
    );

    expect(() =>
      assertCommerciallyUsable(
        classifyObservation(observation(), POLICY, NOW),
        "customer offer"
      )
    ).not.toThrow();
  });

  it("excludes test observations from a mixed set", () => {
    const mixed = [
      observation({ classification: "live" }),
      observation({ classification: "test" }),
      observation({ classification: "live" }),
    ];
    const kept = excludeTestObservations(mixed);
    expect(kept).toHaveLength(2);
    expect(kept.every((o) => o.classification === "live")).toBe(true);
  });
});

describe("Deldo capabilities", () => {
  it("treats an unregistered capability as unavailable", () => {
    // @ts-expect-error deliberately outside the vocabulary
    expect(isCapabilityAvailable("teleportation")).toBe(false);
  });

  it("requires both documented AND implemented", () => {
    // Documented and built.
    expect(isCapabilityAvailable("live_stock_lookup")).toBe(true);
    expect(isCapabilityAvailable("catalogue_feed")).toBe(true);
    // Documented by the supplier, deliberately not built.
    expect(isCapabilityAvailable("order_status")).toBe(false);
    expect(getDeldoCapability("order_status")?.documented).toBe(true);
    expect(getDeldoCapability("order_status")?.implemented).toBe(false);
  });

  /**
   * The mission's hard invariant. No Deldo order may be placeable by any code
   * path in this repository, and the cheapest way to keep that true through
   * future edits is a test that fails the moment it stops being true.
   */
  it("keeps every ordering capability unavailable", () => {
    for (const capability of DELDO_ORDERING_CAPABILITIES) {
      expect(isCapabilityAvailable(capability)).toBe(false);
      expect(getDeldoCapability(capability)?.implemented).toBe(false);
    }
  });

  it("reports the honest gap between documented and built", () => {
    const gap = documentedButNotImplemented();
    expect(gap).toContain("production_ordering");
    expect(gap).toContain("test_ordering");
    expect(gap).toContain("invoices");
    expect(gap).not.toContain("live_stock_lookup");
  });

  it("gives every registered capability a reason for its state", () => {
    for (const record of DELDO_CAPABILITIES) {
      expect(record.note.trim().length).toBeGreaterThan(20);
    }
  });
});

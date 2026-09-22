import { describe, expect, it } from "vitest";
import {
  classifyObservation,
  isCommerciallyUsable,
  assertCommerciallyUsable,
  excludeTestObservations,
  DELDO_DOCUMENTED_FEED_INTERVAL_MS,
  classifyObservationForLane,
  freshnessPolicyForLane,
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
    supplierListingKey: "DELDO:BR6727",
    supplierArticleId: "BR6727",
    dotYear: null,
    demo: false,
    stockCondition: "normal",
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

/**
 * Lane-scoped freshness.
 *
 * These functions shipped exported but untested: the typecheck was failing on
 * two unused imports left behind by an abandoned attempt to cover them. The
 * safety property is that a lane with no configured policy FAILS rather than
 * falling back to a default, because a default would silently invent a
 * commercial freshness tolerance that nobody approved.
 */
describe("lane-scoped freshness policy", () => {
  const policies = {
    deldo: { staleAfterMs: 4 * 60 * 60 * 1000 },
    intersprint: { staleAfterMs: 7 * 24 * 60 * 60 * 1000 },
  };
  const now = new Date("2026-09-21T12:00:00Z");

  it("returns the policy configured for the lane", () => {
    expect(freshnessPolicyForLane("deldo", policies).staleAfterMs).toBe(4 * 60 * 60 * 1000);
    expect(freshnessPolicyForLane("intersprint", policies).staleAfterMs).toBe(
      7 * 24 * 60 * 60 * 1000
    );
  });

  it("THROWS for an unconfigured lane instead of defaulting", () => {
    expect(() => freshnessPolicyForLane("it_48h", policies)).toThrow(
      /No valid freshness policy configured for supplier lane 'it_48h'/
    );
  });

  it("THROWS on a malformed policy rather than treating it as usable", () => {
    for (const bad of [
      { staleAfterMs: Number.NaN },
      { staleAfterMs: Number.POSITIVE_INFINITY },
      { staleAfterMs: -1 },
    ]) {
      expect(() => freshnessPolicyForLane("deldo", { deldo: bad })).toThrow(
        /No valid freshness policy/
      );
    }
  });

  it("does NOT hard-code Deldo's documented feed interval as a policy", () => {
    // Publishing cadence is a supplier fact; freshness tolerance is a
    // GommaRush commercial decision. They must not be the same number by
    // accident.
    expect(() => freshnessPolicyForLane("deldo", {})).toThrow();
  });

  it("classifies through the lane's own policy", () => {
    const threeHoursOld = observation({
      observedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
    });
    // Fresh under Deldo's 4h policy...
    expect(classifyObservationForLane(threeHoursOld, policies, now).state).toBe("current");
    // ...and the SAME observation is stale under a stricter lane policy.
    expect(
      classifyObservationForLane(threeHoursOld, { deldo: { staleAfterMs: 60 * 1000 } }, now).state
    ).toBe("stale");
  });

  it("reports an absent observation without needing a policy at all", () => {
    expect(classifyObservationForLane(null, {}, now)).toEqual({
      state: "no_usable_observation",
      reason: "no_observation",
    });
  });

  it("still rejects test data ahead of any freshness question", () => {
    const freshTestRow = observation({ classification: "test", observedAt: now });
    expect(classifyObservationForLane(freshTestRow, policies, now).state).toBe("test_data");
  });

  it("propagates the throw for an observation on an unconfigured lane", () => {
    const other = observation({ laneCode: "it_48h" });
    expect(() => classifyObservationForLane(other, policies, now)).toThrow(
      /No valid freshness policy configured for supplier lane 'it_48h'/
    );
  });
});

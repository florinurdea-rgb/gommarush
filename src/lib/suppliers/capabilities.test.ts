import { describe, it, expect } from "vitest";
import {
  resolveCapabilities,
  hasCapability,
  assertNoOrderingEnabled,
  isKnownCapability,
  ORDERING_CAPABILITIES,
} from "./capabilities";
import { isbAdapter, deldoAdapter, ADAPTERS } from "./adapters";

describe("capability resolution - absence means unavailable", () => {
  it("returns an empty set for null, undefined and empty input", () => {
    for (const input of [null, undefined, []]) {
      expect(resolveCapabilities(input).size).toBe(0);
    }
  });

  it("an ABSENT capability row is unavailable", () => {
    const caps = resolveCapabilities([{ capability: "catalogue_feed", enabled: true }]);
    expect(hasCapability(caps, "catalogue_feed")).toBe(true);
    expect(hasCapability(caps, "stock_feed")).toBe(false);
    expect(hasCapability(caps, "live_stock_lookup")).toBe(false);
  });

  it("a DISABLED capability row is unavailable", () => {
    const caps = resolveCapabilities([{ capability: "price_feed", enabled: false }]);
    expect(hasCapability(caps, "price_feed")).toBe(false);
  });

  it("ignores unknown capability strings rather than trusting them", () => {
    const caps = resolveCapabilities([{ capability: "teleport", enabled: true }]);
    expect(caps.size).toBe(0);
    expect(isKnownCapability("teleport")).toBe(false);
  });
});

describe("supplier ordering is structurally disabled", () => {
  it("production_ordering can NEVER be resolved, even if a row says enabled", () => {
    const caps = resolveCapabilities([
      { capability: "production_ordering", enabled: true },
    ]);
    expect(caps.has("production_ordering")).toBe(false);
    expect(hasCapability(caps, "production_ordering")).toBe(false);
  });

  it("test_ordering can NEVER be resolved either", () => {
    const caps = resolveCapabilities([{ capability: "test_ordering", enabled: true }]);
    expect(hasCapability(caps, "test_ordering")).toBe(false);
  });

  it("hasCapability refuses ordering even against a hand-built set", () => {
    const rogue = new Set(["production_ordering"] as const);
    expect(hasCapability(rogue as never, "production_ordering")).toBe(false);
  });

  it("assertNoOrderingEnabled throws on a rogue set", () => {
    expect(() => assertNoOrderingEnabled(new Set(["production_ordering"] as never))).toThrow(
      /OWNER_DECISION/,
    );
    expect(() => assertNoOrderingEnabled(new Set())).not.toThrow();
  });

  it("no adapter declares any ordering capability", () => {
    for (const adapter of ADAPTERS) {
      for (const ordering of ORDERING_CAPABILITIES) {
        expect(adapter.capabilities().has(ordering)).toBe(false);
      }
      expect(() => assertNoOrderingEnabled(adapter.capabilities())).not.toThrow();
    }
  });

  it("NO adapter exposes an order-placing method - absent, not disabled", () => {
    for (const adapter of ADAPTERS) {
      const surface = adapter as unknown as Record<string, unknown>;
      for (const forbidden of [
        "placeOrder", "submitOrder", "createOrder", "purchase", "buy",
        "sendOrder", "order", "placeProductionOrder",
      ]) {
        expect(surface[forbidden]).toBeUndefined();
      }
    }
  });
});

describe("declared adapter capability ceilings", () => {
  it("Inter-Sprint implements catalogue_feed only - no Gateway/Protocol 103 yet", () => {
    const caps = isbAdapter.capabilities();
    expect(caps.has("catalogue_feed")).toBe(true);
    expect(caps.has("live_stock_lookup")).toBe(false);
    expect(caps.has("live_price_lookup")).toBe(false);
    expect(isbAdapter.lookupLive).toBeUndefined();
  });

  it("Deldo declares nothing - its feed contract is not documented", () => {
    expect(deldoAdapter.capabilities().size).toBe(0);
    expect(deldoAdapter.parseCatalogueRows).toBeUndefined();
    expect(deldoAdapter.lookupLive).toBeUndefined();
  });
});

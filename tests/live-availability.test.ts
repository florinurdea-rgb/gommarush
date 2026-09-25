import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BasketResolvedLine } from "@/lib/server/customer-basket";

/**
 * The live supplier check, run on every basket preview and again, fresh, at
 * the final confirm.
 *
 * Owner decisions, 2026-09-24, and each one is a property here rather than a
 * comment:
 *
 *   * The lookup runs on basket previews (D26, superseding the confirm-only
 *     D21) and at confirm with `forceFresh`, bypassing the short cache.
 *   * This module never throws and never blocks on its own: a gateway that
 *     does not answer leaves the line MARKED `feed_after_live_failure`. The
 *     ORDER gate then fails closed on any such line (D27,
 *     LIVE_VERIFICATION_UNAVAILABLE); the preview shows it as a retryable
 *     state, never as out of stock.
 *   * A lane with no live API keeps its feed observation and says so, rather
 *     than being dressed up as verified.
 *
 * Protocol 104 must not appear anywhere in this path. A stock check that can
 * reach order entry is not a stock check.
 */

const stockByEan = vi.fn();
const describeGatewayConfig = vi.fn();
const logError = vi.fn();

vi.mock("@/lib/server/supplier-gateway", () => ({
  getGatewayClient: () => ({ stockByEan: (...a: unknown[]) => stockByEan(...a) }),
}));

vi.mock("@/lib/suppliers/gateway/config", () => ({
  describeGatewayConfig: (...a: unknown[]) => describeGatewayConfig(...a),
}));

vi.mock("@/lib/logger", () => ({ logError: (...a: unknown[]) => logError(...a) }));

const OBSERVED = "2026-09-24T10:31:00.000Z";

function line(overrides: Partial<BasketResolvedLine> = {}, quantity = 4): BasketResolvedLine {
  return {
    input: { productId: "p-1", oldDot: false, quantity },
    tyre: { sizeDisplay: "205/55 R16" } as never,
    customer: { tyreSaleNetCents: 12_000 } as never,
    internal: {
      tyre: { productId: "p-1", productClass: "passenger_car", sizeDisplay: "205/55 R16" },
      availability: "in_stock",
      supplierListingId: "l-1",
      supplierName: "SECRET",
      supplierArticleId: "SECRET-SKU",
      laneCode: "intersprint",
      ean: "1234567890123",
      weightKg: 8.5,
      costObservedAt: OBSERVED,
      supplierCostCents: 10_000,
      tyreSaleNetCents: 12_000,
      supplierStockExact: 40,
      supplierStockMinimum: null,
      supplierStockRaw: "40",
      sellable: true,
      sellabilityReason: "sellable",
      minimumOfferQuantity: 5,
    } as never,
    availability: { state: "available" },
    provenance: { source: "feed", observedAt: OBSERVED },
    ...overrides,
  };
}

/**
 * A protocol-103 data response: net price in column 7, `available` in column 9.
 *
 * The price quoted here matches the fixture's stored cost, so these rows test
 * availability WITHOUT incidentally triggering a re-price. The re-pricing
 * tests below quote a different figure on purpose.
 */
function stockRow(ean: string, available: string) {
  return {
    outcome: {
      status: "data",
      rows: [["SYS", ean, "ALPHA", "G", "205/55 R16", "EUR", "100.00", "125.00", available]],
      truncated: false,
    },
  };
}

beforeEach(async () => {
  describeGatewayConfig.mockReturnValue({ configured: true });
  // The per-EAN call-rate cache is module state; a test must not inherit
  // another test's supplier answer.
  const { resetLiveAvailabilityCache } = await import("@/lib/server/live-availability");
  resetLiveAvailabilityCache();
});

afterEach(() => vi.clearAllMocks());

describe("when the supplier answers", () => {
  it("keeps a line available when live stock covers the quantity", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue(stockRow("1234567890123", "40"));

    const result = await verifyBasketLive([line()]);
    expect(result.lines[0].availability).toEqual({ state: "available" });
    expect(result.lines[0].provenance.source).toBe("live");
    expect(result.anyLive).toBe(true);
  });

  /** The case the whole feature exists for. */
  it("turns a line short at the supplier into a limited line", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue(stockRow("1234567890123", "2"));

    const result = await verifyBasketLive([line()]);
    expect(result.lines[0].availability).toEqual({ state: "limited", availableQuantity: 2 });
  });

  /**
   * The recovery path the basket offers: "Porta a 2" re-asks at the lower
   * quantity, and the SAME live answer now covers it. Nothing is reduced for
   * the customer; the reduction is theirs and the re-check is fresh.
   */
  it("makes a limited line available again once the quantity is lowered to what is held", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue(stockRow("1234567890123", "2"));

    const short = await verifyBasketLive([line({}, 4)]);
    expect(short.lines[0].availability).toEqual({ state: "limited", availableQuantity: 2 });
    expect(short.lines[0].input.quantity, "the requested quantity is kept, not reduced").toBe(4);

    const lowered = await verifyBasketLive([line({}, 2)], Date.now, { forceFresh: true });
    expect(lowered.lines[0].availability).toEqual({ state: "available" });
    expect(lowered.lines[0].provenance.source).toBe("live");
  });

  it("turns a line the supplier no longer holds into an unavailable line", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue(stockRow("1234567890123", "0"));

    const result = await verifyBasketLive([line()]);
    expect(result.lines[0].availability).toEqual({ state: "unavailable", reason: "out_of_stock" });
  });

  it("asks about the EAN the line actually carries", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue(stockRow("1234567890123", "40"));

    await verifyBasketLive([line()]);
    expect(stockByEan).toHaveBeenCalledWith("1234567890123");
  });

  /**
   * "Unparseable" and "none in stock" are different facts. Reading the first
   * as the second would cancel a line the supplier never said was empty.
   */
  it("does not read an unparseable quantity as zero", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue(stockRow("1234567890123", "op aanvraag"));

    const result = await verifyBasketLive([line()]);
    expect(result.lines[0].availability).toEqual({ state: "available" });
    expect(result.lines[0].provenance.source).toBe("feed_after_live_failure");
    expect(result.lines[0].provenance.liveFailureReason).toBe("unparseable_quantity");
  });
});

describe("when the supplier does not answer", () => {
  /** Owner decision: a supplier outage must not stop GommaRush selling. */
  it("keeps the feed answer rather than blocking the sale", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockRejectedValue(new Error("timeout"));

    const result = await verifyBasketLive([line()]);
    expect(result.lines[0].availability).toEqual({ state: "available" });
    expect(result.anyLiveFailure).toBe(true);
  });

  /** ...but never silently. That was the option the owner rejected. */
  it("marks the line so the screen and the order both know", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockRejectedValue(new Error("timeout"));

    const result = await verifyBasketLive([line()]);
    expect(result.lines[0].provenance.source).toBe("feed_after_live_failure");
    expect(result.lines[0].provenance.liveFailureReason).toBe("transport");
    expect(result.lines[0].provenance.observedAt, "the feed time is still what it rests on").toBe(
      OBSERVED
    );
  });

  it("records a gateway error code rather than swallowing it", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue({
      outcome: { status: "error", code: "92", description: "not enough stock" },
    });

    const result = await verifyBasketLive([line()]);
    expect(result.lines[0].provenance.liveFailureReason).toBe("gateway_92");
  });

  it("never throws out of the verification", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockRejectedValue(new Error("boom"));
    await expect(verifyBasketLive([line()])).resolves.toBeDefined();
    expect(logError).toHaveBeenCalled();
  });
});

describe("lines with no live lane", () => {
  /**
   * 3,289 active listings in production are on the `isb` lane, which has no
   * API at all. Owner decision: they keep the feed observation and say so.
   */
  it("leaves a non-live lane on its feed observation, untouched", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    const isb = line({ internal: { laneCode: "isb", ean: "999", costObservedAt: OBSERVED } as never });

    const result = await verifyBasketLive([isb]);
    expect(stockByEan).not.toHaveBeenCalled();
    expect(result.lines[0].provenance.source).toBe("feed");
    expect(result.anyLiveFailure, "not asking is not a failure").toBe(false);
  });

  /**
   * PREMISE INVERTED DELIBERATELY. This used to assert the line stayed on
   * plain `feed`, which made it indistinguishable from a lane that has no
   * live lookup — and the order gate now turns on exactly that distinction.
   * A live lane we cannot form a question for is a failure, not a pass.
   */
  it("does not call out for a line with no EAN, but records the failure", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    const noEan = line({
      internal: { laneCode: "intersprint", ean: null, costObservedAt: OBSERVED } as never,
    });

    const result = await verifyBasketLive([noEan]);
    expect(stockByEan, "no point asking without an identifier").not.toHaveBeenCalled();
    expect(result.lines[0].provenance.source).toBe("feed_after_live_failure");
  });

  it("does not try an already-unavailable line", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    const gone = line({
      internal: null,
      customer: null,
      availability: { state: "unavailable", reason: "not_stocked" },
    });

    await verifyBasketLive([gone]);
    expect(stockByEan).not.toHaveBeenCalled();
  });
});

describe("an unconfigured gateway", () => {
  /**
   * PREMISE INVERTED DELIBERATELY. This used to assert that missing
   * credentials were "not a failure", on the reasoning that nothing had been
   * attempted. That reasoning does not survive a fail-closed order gate: an
   * unconfigured deployment then looks identical to a working one, and every
   * order passes a check that never ran. Nothing is called — there is nothing
   * to call with — but the line is marked.
   */
  it("makes no call, and marks the line rather than passing it", async () => {
    describeGatewayConfig.mockReturnValue({ configured: false });
    const { verifyBasketLive } = await import("@/lib/server/live-availability");

    const result = await verifyBasketLive([line()]);
    expect(stockByEan).not.toHaveBeenCalled();
    expect(result.anyLive).toBe(false);
    expect(result.anyLiveFailure).toBe(true);
    expect(result.lines[0].provenance.source).toBe("feed_after_live_failure");
  });

  it("survives configuration that throws", async () => {
    describeGatewayConfig.mockImplementation(() => {
      throw new Error("no env");
    });
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    await expect(verifyBasketLive([line()])).resolves.toBeDefined();
  });
});

describe("the ordering protocol is not reachable from here", () => {
  /** A stock check that can reach order entry is not a stock check. */
  it("mentions no order protocol anywhere in the module", () => {
    const source = require("node:fs").readFileSync(
      "src/lib/server/live-availability.ts",
      "utf8"
    ) as string;
    expect(source).not.toContain("ORDER_ENTRY");
    expect(source).not.toContain("placeOrder");
    expect(source).not.toContain("validateOrder");
    expect(source.match(/stockByEan/g)?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("the live price drives the customer's price", () => {
  /**
   * The half of the requirement that quantity checking alone does not cover.
   * A line whose cost has moved must be re-priced, or the customer agrees to a
   * figure the supplier has already left behind and finds out at the order
   * gate.
   */
  it("re-prices the line through the approved engine when the cost has moved", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    // 100.00 was the stored cost; the supplier now says 110.00.
    stockByEan.mockResolvedValue({
      outcome: {
        status: "data",
        rows: [["SYS", "1234567890123", "ALPHA", "G", "205/55 R16", "EUR", "110.00", "140.00", "40"]],
        truncated: false,
      },
    });

    const result = await verifyBasketLive([line()]);
    // +20% markup, exactly as the catalogue applies it. 110.00 -> 132.00.
    expect(result.lines[0].customer?.tyreSaleNetCents).toBe(13_200);
    expect(result.lines[0].provenance.source).toBe("live");
  });

  it("leaves the price alone when the cost has not moved", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue(stockRow("1234567890123", "40"));
    const result = await verifyBasketLive([line()]);
    expect(result.lines[0].customer?.tyreSaleNetCents).toBe(12_000);
  });

  /** A malformed price column must not cancel a good quantity answer. */
  it("keeps the line live when the price cannot be read", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue({
      outcome: {
        status: "data",
        rows: [["SYS", "1234567890123", "ALPHA", "G", "205/55 R16", "EUR", "op aanvraag", "", "40"]],
        truncated: false,
      },
    });

    const result = await verifyBasketLive([line()]);
    expect(result.lines[0].provenance.source).toBe("live");
    expect(result.lines[0].availability).toEqual({ state: "available" });
    expect(result.lines[0].customer?.tyreSaleNetCents).toBe(12_000);
  });

  it("reads both decimal conventions and refuses anything else", async () => {
    const { parseNetPriceCents } = await import("@/lib/server/live-availability");
    expect(parseNetPriceCents("28.79")).toBe(2879);
    expect(parseNetPriceCents("28,79")).toBe(2879);
    expect(parseNetPriceCents(" 110 ")).toBe(11_000);
    // Never zero, never free.
    expect(parseNetPriceCents("op aanvraag")).toBeNull();
    expect(parseNetPriceCents("")).toBeNull();
    expect(parseNetPriceCents("-5.00")).toBeNull();
  });

  /** Sourcing cost has no field to travel in on a customer payload. */
  it("never lets the live cost reach the customer projection", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue({
      outcome: {
        status: "data",
        rows: [["SYS", "1234567890123", "ALPHA", "G", "205/55 R16", "EUR", "110.00", "140.00", "40"]],
        truncated: false,
      },
    });

    const result = await verifyBasketLive([line()]);
    const json = JSON.stringify(result.lines[0].customer);
    expect(json).not.toContain("11000");
    expect(json).not.toContain("supplierCostCents");
    expect(json).not.toContain("SECRET");
  });
});

describe("the per-EAN call-rate guard", () => {
  /**
   * A customer nudging a quantity from 4 to 8 fires several previews in a few
   * seconds. Each would otherwise be its own plain-HTTP round trip carrying
   * credentials in the clear.
   */
  it("collapses a burst of checks on one tyre into a single lookup", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue(stockRow("1234567890123", "40"));

    await verifyBasketLive([line()]);
    await verifyBasketLive([line()]);
    await verifyBasketLive([line()]);

    expect(stockByEan).toHaveBeenCalledTimes(1);
  });

  /**
   * THE PROPERTY THAT MATTERS MOST. It caches the SUPPLIER'S ANSWER, not a
   * verdict about a line, so "reduce the quantity and it becomes available
   * again" still works inside the window — same live figure, different
   * question.
   */
  it("re-decides a different quantity against the cached answer", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue(stockRow("1234567890123", "6"));

    const tooMany = await verifyBasketLive([line({}, 20)]);
    expect(tooMany.lines[0].availability).toEqual({ state: "limited", availableQuantity: 6 });

    const reduced = await verifyBasketLive([line({}, 6)]);
    expect(reduced.lines[0].availability).toEqual({ state: "available" });
    expect(stockByEan, "and without asking again").toHaveBeenCalledTimes(1);
  });

  /** A failure must not be remembered: the next request tries again. */
  it("never caches a failure", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockRejectedValueOnce(new Error("timeout"));
    const failed = await verifyBasketLive([line()]);
    expect(failed.lines[0].provenance.source).toBe("feed_after_live_failure");

    stockByEan.mockResolvedValue(stockRow("1234567890123", "40"));
    const retried = await verifyBasketLive([line()]);
    expect(retried.lines[0].provenance.source).toBe("live");
  });

  it("expires, so a stale answer cannot outlive the window", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue(stockRow("1234567890123", "40"));
    let clock = 1_000_000;
    const now = () => clock;

    await verifyBasketLive([line()], now);
    clock += 21_000;
    await verifyBasketLive([line()], now);

    expect(stockByEan).toHaveBeenCalledTimes(2);
  });
});

describe("a live lane that did not answer is marked, never passed off as fine", () => {
  /**
   * THE PROPERTY THE ORDER GATE TURNS ON.
   *
   * Missing credentials used to leave every line on plain `feed`, which is
   * indistinguishable from a lane that genuinely has no live lookup. An
   * unconfigured deployment therefore looked exactly like a correctly
   * configured one, and orders flowed through the live gate having never been
   * near it.
   */
  it("marks an unconfigured live lane as a failure", async () => {
    describeGatewayConfig.mockReturnValue({ configured: false });
    const { verifyBasketLive, liveVerificationMissing } = await import(
      "@/lib/server/live-availability"
    );

    const result = await verifyBasketLive([line()]);
    expect(result.lines[0].provenance.source).toBe("feed_after_live_failure");
    expect(result.lines[0].provenance.liveFailureReason).toBe("not_configured");
    expect(result.anyLiveFailure).toBe(true);
    expect(liveVerificationMissing(result.lines)).toBe(true);
  });

  /** Nothing was attempted on a lane with no lookup, so nothing failed. */
  it("leaves a lane with no live lookup alone, even when unconfigured", async () => {
    describeGatewayConfig.mockReturnValue({ configured: false });
    const { verifyBasketLive, liveVerificationMissing } = await import(
      "@/lib/server/live-availability"
    );
    const isb = line({
      internal: { laneCode: "isb", ean: "999", costObservedAt: OBSERVED } as never,
    });

    const result = await verifyBasketLive([isb]);
    expect(result.lines[0].provenance.source).toBe("feed");
    expect(liveVerificationMissing(result.lines)).toBe(false);
  });

  /** A live lane we cannot form a question for is a failure, not a pass. */
  it("marks a live lane with no identifier as a failure", async () => {
    const { verifyBasketLive, liveVerificationMissing } = await import(
      "@/lib/server/live-availability"
    );
    const noEan = line({
      internal: { laneCode: "intersprint", ean: null, costObservedAt: OBSERVED } as never,
    });

    const result = await verifyBasketLive([noEan]);
    expect(result.lines[0].provenance.liveFailureReason).toBe("no_identifier");
    expect(liveVerificationMissing(result.lines)).toBe(true);
  });

  it("reports every failure mode the same way", async () => {
    const { verifyBasketLive, liveVerificationMissing } = await import(
      "@/lib/server/live-availability"
    );
    for (const [label, mock] of [
      ["transport", () => stockByEan.mockRejectedValue(new Error("timeout"))],
      [
        "auth",
        () =>
          stockByEan.mockResolvedValue({
            outcome: { status: "error", code: "90", description: "not authorised" },
          }),
      ],
      [
        "malformed",
        () => stockByEan.mockResolvedValue({ outcome: { status: "malformed", reason: "NO_END" } }),
      ],
    ] as const) {
      const { resetLiveAvailabilityCache } = await import("@/lib/server/live-availability");
      resetLiveAvailabilityCache();
      stockByEan.mockReset();
      mock();
      const result = await verifyBasketLive([line()]);
      expect(liveVerificationMissing(result.lines), label).toBe(true);
      // ...and none of them is ever reported as out of stock.
      expect(result.lines[0].availability, label).not.toEqual({
        state: "unavailable",
        reason: "out_of_stock",
      });
    }
  });
});

describe("the final confirmation cannot be served from cache", () => {
  /**
   * The cache is right for a screen the customer is still deciding on and
   * wrong for the moment they commit. A cached answer from a basket preview
   * seconds earlier would otherwise stand in for the authoritative final
   * check — which is the one thing that check exists to prevent.
   */
  it("asks again even when a fresh cached answer exists", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue(stockRow("1234567890123", "40"));

    await verifyBasketLive([line()]);
    expect(stockByEan).toHaveBeenCalledTimes(1);

    await verifyBasketLive([line()], Date.now, { forceFresh: true });
    expect(stockByEan, "the confirm re-asks").toHaveBeenCalledTimes(2);
  });

  it("is what the order path uses", () => {
    const source = require("node:fs").readFileSync(
      "src/lib/server/sales-orders.ts",
      "utf8"
    ) as string;
    expect(source).toContain("verifyBasketLive(resolved, Date.now, { forceFresh: true })");
  });

  /** A fresh answer still refreshes the cache, so a retry is not a third call. */
  it("refreshes the cache with what it just learned", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    stockByEan.mockResolvedValue(stockRow("1234567890123", "40"));

    await verifyBasketLive([line()], Date.now, { forceFresh: true });
    await verifyBasketLive([line()]);
    expect(stockByEan).toHaveBeenCalledTimes(1);
  });
});

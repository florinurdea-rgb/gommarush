import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BasketResolvedLine } from "@/lib/server/customer-basket";

/**
 * The live supplier check that runs at the final confirm.
 *
 * Three owner decisions, 2026-09-24, and each one is a property here rather
 * than a comment:
 *
 *   * The lookup happens at confirm and nowhere else. That is enforced by
 *     who calls this module, and asserted in the checkout/preview tests.
 *   * It FAILS OPEN — a gateway that does not answer must not stop GommaRush
 *     selling — but never silently: the line is marked so the screen and the
 *     order snapshot both know a live answer was not obtained.
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
      supplierListingId: "l-1",
      laneCode: "intersprint",
      ean: "1234567890123",
      costObservedAt: OBSERVED,
    } as never,
    availability: { state: "available" },
    provenance: { source: "feed", observedAt: OBSERVED },
    ...overrides,
  };
}

/** A protocol-103 data response carrying `available` in column 9. */
function stockRow(ean: string, available: string) {
  return {
    outcome: {
      status: "data",
      rows: [["SYS", ean, "ALPHA", "G", "205/55 R16", "EUR", "28.79", "35.00", available]],
      truncated: false,
    },
  };
}

beforeEach(() => {
  describeGatewayConfig.mockReturnValue({ configured: true });
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

  it("does not try a line with no EAN to ask about", async () => {
    const { verifyBasketLive } = await import("@/lib/server/live-availability");
    const noEan = line({
      internal: { laneCode: "intersprint", ean: null, costObservedAt: OBSERVED } as never,
    });

    const result = await verifyBasketLive([noEan]);
    expect(stockByEan).not.toHaveBeenCalled();
    expect(result.lines[0].provenance.source).toBe("feed");
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
   * A deployment that has never had credentials is not a supplier that let us
   * down, and marking those lines as a live failure would put a warning in
   * front of customers about something that was never attempted.
   */
  it("is not reported as a live failure", async () => {
    describeGatewayConfig.mockReturnValue({ configured: false });
    const { verifyBasketLive } = await import("@/lib/server/live-availability");

    const result = await verifyBasketLive([line()]);
    expect(stockByEan).not.toHaveBeenCalled();
    expect(result.anyLive).toBe(false);
    expect(result.anyLiveFailure).toBe(false);
    expect(result.lines[0].provenance.source).toBe("feed");
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

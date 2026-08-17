import { describe, expect, it } from "vitest";
import { calculateOrderProgress, deriveOrderStatus } from "@/lib/logistics/order-progress";
import type { InventoryUnitStatus } from "@/lib/types/logistics";

const units = (...statuses: InventoryUnitStatus[]) => statuses.map((status) => ({ status }));

describe("calculateOrderProgress", () => {
  it("reports 0/4 for an untouched order", () => {
    const progress = calculateOrderProgress(units("expected", "expected", "expected", "expected"));
    expect(progress.storedLabel).toBe("0/4");
    expect(progress.storedPercent).toBe(0);
    expect(progress.outstanding).toBe(4);
  });

  it("reports 2/4 when partially stored", () => {
    const progress = calculateOrderProgress(units("stored", "stored", "received", "expected"));
    expect(progress.storedLabel).toBe("2/4");
    expect(progress.receivedLabel).toBe("3/4");
    expect(progress.storedPercent).toBe(50);
  });

  it("reports 4/4 when fully stored", () => {
    const progress = calculateOrderProgress(units("stored", "stored", "stored", "stored"));
    expect(progress.storedLabel).toBe("4/4");
    expect(progress.storedPercent).toBe(100);
  });

  it("treats milestones as cumulative, so a loaded unit still counts as stored", () => {
    // Without this, a fully loaded order would read "0/4 stored" and look
    // like nothing had happened.
    const progress = calculateOrderProgress(units("loaded", "loaded", "delivered", "loaded"));
    expect(progress.storedLabel).toBe("4/4");
    expect(progress.receivedLabel).toBe("4/4");
    expect(progress.loadedLabel).toBe("4/4");
  });

  it("counts incident statuses separately", () => {
    const progress = calculateOrderProgress(units("stored", "damaged", "missing", "lost"));
    expect(progress.problem).toBe(3);
    expect(progress.storedLabel).toBe("1/4");
  });

  it("handles an order with no physical units without dividing by zero", () => {
    const progress = calculateOrderProgress([]);
    expect(progress.storedPercent).toBe(0);
    expect(progress.storedLabel).toBe("0/0");
  });
});

describe("deriveOrderStatus", () => {
  it("stays expected while nothing has arrived", () => {
    expect(deriveOrderStatus(units("expected", "expected"), "expected")).toBe("expected");
  });

  it("moves to received once anything arrives", () => {
    expect(deriveOrderStatus(units("received", "expected"), "expected")).toBe("received");
  });

  it("moves to stored only when every unit is stored", () => {
    expect(deriveOrderStatus(units("stored", "received"), "received")).toBe("received");
    expect(deriveOrderStatus(units("stored", "stored"), "received")).toBe("stored");
  });

  it("moves to loaded when every unit is loaded", () => {
    expect(deriveOrderStatus(units("loaded", "loaded"), "stored")).toBe("loaded");
  });

  it("never overrides an administrative decision", () => {
    // Hold and cancel are human decisions, not physical facts.
    expect(deriveOrderStatus(units("stored", "stored"), "on_hold")).toBe("on_hold");
    expect(deriveOrderStatus(units("loaded", "loaded"), "cancelled")).toBe("cancelled");
  });

  it("never walks an order backwards out of a later delivery stage", () => {
    expect(deriveOrderStatus(units("stored", "stored"), "delivered")).toBe("delivered");
    expect(deriveOrderStatus(units("stored", "stored"), "out_for_delivery")).toBe("out_for_delivery");
  });

  it("preserves an explicit ready_for_loading decision", () => {
    expect(deriveOrderStatus(units("stored", "stored"), "ready_for_loading")).toBe(
      "ready_for_loading"
    );
  });
});

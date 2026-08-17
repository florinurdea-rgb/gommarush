import { describe, expect, it } from "vitest";
import { resolveReactivationStatus } from "@/lib/logistics/order-progress";
import { allocateStand } from "@/lib/logistics/stand-allocation";
import type { OrderStatus } from "@/lib/types/logistics";

/**
 * Hold / reactivate.
 *
 * The database side (history preservation, stand re-checking) is covered by
 * supabase/tests/logistics_phase1_flow.sql, which runs the real RPCs. These
 * cover the decision rules the server shares with the UI.
 */

describe("resolveReactivationStatus", () => {
  it("returns an order to the status it held before going on hold", () => {
    const cases: OrderStatus[] = [
      "expected",
      "partially_received",
      "received",
      "stored",
      "ready_for_loading",
    ];
    for (const status of cases) {
      expect(resolveReactivationStatus(status)).toBe(status);
    }
  });

  it("defaults to expected when nothing was remembered", () => {
    expect(resolveReactivationStatus(null)).toBe("expected");
    expect(resolveReactivationStatus(undefined)).toBe("expected");
  });

  it("never restores an order back into hold or cancellation", () => {
    expect(resolveReactivationStatus("on_hold")).toBe("expected");
    expect(resolveReactivationStatus("cancelled")).toBe("expected");
  });
});

describe("stand behaviour across hold", () => {
  it("frees the stand while an order is on hold", () => {
    const orders = [{ id: "held", stand_code: "A" as const, status: "on_hold" as OrderStatus }];
    // Another order may legitimately take stand A in the meantime.
    expect(allocateStand(orders, { requested: "A" })).toEqual({
      kind: "allocated",
      standCode: "A",
    });
  });

  it("reports the collision when the old stand was taken during the hold", () => {
    const orders = [
      { id: "newcomer", stand_code: "A" as const, status: "expected" as OrderStatus },
      { id: "held", stand_code: "A" as const, status: "on_hold" as OrderStatus },
    ];

    const result = allocateStand(orders, { requested: "A", excludeOrderId: "held" });
    expect(result.kind).toBe("requested_occupied");

    // ...and a different free stand is offered instead of double-booking.
    const fallback = allocateStand(orders, { excludeOrderId: "held" });
    expect(fallback).toEqual({ kind: "allocated", standCode: "B" });
  });
});

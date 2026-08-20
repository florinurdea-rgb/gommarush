import { describe, expect, it } from "vitest";
import { resolveReactivationStatus } from "@/lib/logistics/order-progress";
import type { OrderStatus } from "@/lib/types/logistics";

/**
 * Hold / reactivate.
 *
 * The database side (history preservation) is covered by
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

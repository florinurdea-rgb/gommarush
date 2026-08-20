import { describe, expect, it } from "vitest";
import { isManuallySettableStatus, MANUAL_STATUS_EXCLUDED } from "@/lib/logistics/order-status-rules";

/**
 * The Livrări board's "Schimbă statusul" menu (and setOrderStatusManually()
 * on the server, which shares this exact predicate) is restricted to
 * statuses whose transition has no required side effect it would skip.
 * 'loaded' needs a vehicle + loaded_at (gorush_mark_order_loaded);
 * 'delivered'/'partially_delivered' need delivered_at + payment recording
 * (gorush_deliver_order).
 */
describe("isManuallySettableStatus", () => {
  it("rejects 'loaded' — must go through markOrderLoaded() instead", () => {
    expect(isManuallySettableStatus("loaded")).toBe(false);
  });

  it("rejects 'delivered' and 'partially_delivered' — must go through deliverOrder() instead", () => {
    expect(isManuallySettableStatus("delivered")).toBe(false);
    expect(isManuallySettableStatus("partially_delivered")).toBe(false);
  });

  it("rejects a non-active status like 'cancelled' or 'draft'", () => {
    expect(isManuallySettableStatus("cancelled")).toBe(false);
    expect(isManuallySettableStatus("draft")).toBe(false);
  });

  it("allows ordinary in-progress statuses", () => {
    expect(isManuallySettableStatus("stored")).toBe(true);
    expect(isManuallySettableStatus("ready_for_loading")).toBe(true);
    expect(isManuallySettableStatus("on_hold")).toBe(true);
  });

  it("every excluded status is genuinely excluded, not just missing from the active list", () => {
    for (const status of MANUAL_STATUS_EXCLUDED) {
      expect(isManuallySettableStatus(status)).toBe(false);
    }
  });
});

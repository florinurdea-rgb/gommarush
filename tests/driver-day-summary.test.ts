import { describe, expect, it } from "vitest";
import { summariseDriverDay } from "@/lib/logistics/driver-day-summary";
import type { DriverOrderSummary } from "@/lib/server/loading";

function order(overrides: Partial<DriverOrderSummary>): DriverOrderSummary {
  return {
    id: "order-1",
    order_number: 1,
    status: "loaded",
    stand_code: null,
    customer_name: "Autoservice Rossi",
    customer_city: "Verona",
    customer_address: "Via Roma 25",
    customer_phone: null,
    planned_delivery_date: null,
    delivery_sequence: null,
    vehicle_id: "van-1",
    vehicle_name: "Van 1",
    tyre_count: 4,
    delivery_notes: null,
    cash_on_delivery: false,
    amount_to_collect: null,
    payment_method: null,
    payment_status: null,
    amount_collected: null,
    delivery_failure_reason: null,
    items: [],
    ...overrides,
  };
}

describe("summariseDriverDay", () => {
  it("sums orders and tyres across the whole run", () => {
    const orders = [order({ id: "a", tyre_count: 4 }), order({ id: "b", tyre_count: 2 })];
    const summary = summariseDriverDay(orders);
    expect(summary.orderCount).toBe(2);
    expect(summary.tyreCount).toBe(6);
  });

  it("only counts COD amounts for orders flagged cash_on_delivery", () => {
    const orders = [
      order({ id: "a", cash_on_delivery: true, amount_to_collect: 420 }),
      order({ id: "b", cash_on_delivery: false, amount_to_collect: 999 }),
      order({ id: "c", cash_on_delivery: true, amount_to_collect: 80 }),
    ];
    // Order b's amount_to_collect must never leak into codTotal just
    // because the field happens to be set — cash_on_delivery is the gate.
    expect(summariseDriverDay(orders).codTotal).toBe(500);
  });

  it("treats a null amount_to_collect on a COD order as zero, not a crash", () => {
    const orders = [order({ cash_on_delivery: true, amount_to_collect: null })];
    expect(summariseDriverDay(orders).codTotal).toBe(0);
  });

  it("counts delivered vs remaining correctly", () => {
    const orders = [
      order({ id: "a", status: "delivered" }),
      order({ id: "b", status: "loaded" }),
      order({ id: "c", status: "out_for_delivery" }),
    ];
    const summary = summariseDriverDay(orders);
    expect(summary.deliveredCount).toBe(1);
    expect(summary.remainingCount).toBe(2);
  });

  it("handles an empty run without dividing by zero or throwing", () => {
    const summary = summariseDriverDay([]);
    expect(summary).toEqual({ orderCount: 0, tyreCount: 0, codTotal: 0, deliveredCount: 0, remainingCount: 0 });
  });
});

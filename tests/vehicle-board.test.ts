import { describe, expect, it } from "vitest";
import { computeVehicleLoad, moveOrderBetweenColumns } from "@/lib/logistics/vehicle-board";

describe("computeVehicleLoad", () => {
  it("reports no occupancy/return figures when capacity is unknown", () => {
    const stats = computeVehicleLoad(3, 20, null);
    expect(stats).toEqual({ orderCount: 3, unitCount: 20, capacityUnits: null, occupancyPercent: null, returnTrips: 0 });
  });

  it("computes an occupancy percentage against capacity", () => {
    const stats = computeVehicleLoad(2, 30, 40);
    expect(stats.occupancyPercent).toBe(75);
    expect(stats.returnTrips).toBe(0);
  });

  it("reports zero return trips when the load exactly fits capacity", () => {
    const stats = computeVehicleLoad(1, 40, 40);
    expect(stats.occupancyPercent).toBe(100);
    expect(stats.returnTrips).toBe(0);
  });

  it("counts return trips only for the load beyond the first run", () => {
    // 90 units, 40 per run -> 3 runs total -> 2 RETURNS to depot.
    const stats = computeVehicleLoad(5, 90, 40);
    expect(stats.occupancyPercent).toBe(225);
    expect(stats.returnTrips).toBe(2);
  });

  it("treats a zero/invalid capacity the same as unknown, never dividing by zero", () => {
    const stats = computeVehicleLoad(1, 10, 0);
    expect(stats.occupancyPercent).toBeNull();
    expect(stats.returnTrips).toBe(0);
  });
});

describe("moveOrderBetweenColumns", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };

  it("reorders within the same column", () => {
    const columns = { vehicle1: [a, b, c] };
    const result = moveOrderBetweenColumns(columns, "c", "vehicle1", "vehicle1", 0);
    expect(result.vehicle1.map((o) => o.id)).toEqual(["c", "a", "b"]);
  });

  it("moves an order from one column to another at the given index", () => {
    const columns = { unassigned: [a, b], vehicle1: [c] };
    const result = moveOrderBetweenColumns(columns, "a", "unassigned", "vehicle1", 1);
    expect(result.unassigned.map((o) => o.id)).toEqual(["b"]);
    expect(result.vehicle1.map((o) => o.id)).toEqual(["c", "a"]);
  });

  it("appends when the target index is past the end of the list", () => {
    const columns = { unassigned: [a], vehicle1: [b, c] };
    const result = moveOrderBetweenColumns(columns, "a", "unassigned", "vehicle1", 99);
    expect(result.vehicle1.map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  it("leaves every column untouched when the order isn't found in the source", () => {
    const columns = { unassigned: [a], vehicle1: [b, c] };
    const result = moveOrderBetweenColumns(columns, "does-not-exist", "unassigned", "vehicle1", 0);
    expect(result).toBe(columns);
  });

  it("never mutates the input columns object", () => {
    const columns = { unassigned: [a, b], vehicle1: [c] };
    const snapshot = JSON.parse(JSON.stringify(columns));
    moveOrderBetweenColumns(columns, "a", "unassigned", "vehicle1", 0);
    expect(columns).toEqual(snapshot);
  });
});

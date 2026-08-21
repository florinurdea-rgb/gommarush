import { describe, expect, it } from "vitest";
import { suggestRouteAssignments, suggestRouteForOrder } from "@/lib/logistics/route-suggestion";
import type { RoutableOrder, RoutableVehicle } from "@/lib/logistics/route-suggestion";

describe("suggestRouteAssignments", () => {
  it("keeps orders from the same city together on one vehicle", () => {
    const orders: RoutableOrder[] = [
      { id: "a", city: "Vicenza", unitCount: 2 },
      { id: "b", city: "Vicenza", unitCount: 3 },
      { id: "c", city: "Verona", unitCount: 1 },
    ];
    const vehicles: RoutableVehicle[] = [
      { id: "v1", currentLoad: 0, capacityUnits: null },
      { id: "v2", currentLoad: 0, capacityUnits: null },
    ];

    const assignments = suggestRouteAssignments(orders, vehicles);
    const vehicleForA = assignments.find((a) => a.orderId === "a")!.vehicleId;
    const vehicleForB = assignments.find((a) => a.orderId === "b")!.vehicleId;
    expect(vehicleForA).toBe(vehicleForB);
  });

  it("never assigns a group past a vehicle's known capacity when another vehicle has room", () => {
    const orders: RoutableOrder[] = [
      { id: "a", city: "Vicenza", unitCount: 8 },
      { id: "b", city: "Verona", unitCount: 2 },
    ];
    const vehicles: RoutableVehicle[] = [
      { id: "small", currentLoad: 0, capacityUnits: 5 },
      { id: "large", currentLoad: 0, capacityUnits: 20 },
    ];

    const assignments = suggestRouteAssignments(orders, vehicles);
    const vehicleForA = assignments.find((a) => a.orderId === "a")!.vehicleId;
    expect(vehicleForA).toBe("large");
  });

  it("balances load across vehicles when capacity is unknown for all of them", () => {
    const orders: RoutableOrder[] = [
      { id: "a", city: "Vicenza", unitCount: 5 },
      { id: "b", city: "Verona", unitCount: 5 },
      { id: "c", city: "Padova", unitCount: 5 },
    ];
    const vehicles: RoutableVehicle[] = [
      { id: "v1", currentLoad: 10, capacityUnits: null },
      { id: "v2", currentLoad: 0, capacityUnits: null },
    ];

    const assignments = suggestRouteAssignments(orders, vehicles);
    // v2 started emptier, so it should pick up at least one group before v1 catches up.
    const v2Count = assignments.filter((a) => a.vehicleId === "v2").length;
    expect(v2Count).toBeGreaterThan(0);
  });

  it("returns nothing when there are no vehicles to assign to", () => {
    expect(suggestRouteAssignments([{ id: "a", city: "Vicenza", unitCount: 1 }], [])).toEqual([]);
  });

  it("treats orders with no known city as their own group rather than crashing", () => {
    const orders: RoutableOrder[] = [{ id: "a", city: null, unitCount: 1 }];
    const vehicles: RoutableVehicle[] = [{ id: "v1", currentLoad: 0, capacityUnits: null }];
    const assignments = suggestRouteAssignments(orders, vehicles);
    expect(assignments).toEqual([{ orderId: "a", vehicleId: "v1" }]);
  });
});

describe("suggestRouteForOrder", () => {
  it("returns the single best vehicle id for one order", () => {
    const order: RoutableOrder = { id: "a", city: "Vicenza", unitCount: 3 };
    const vehicles: RoutableVehicle[] = [
      { id: "v1", currentLoad: 0, capacityUnits: 5 },
      { id: "v2", currentLoad: 4, capacityUnits: 5 },
    ];
    expect(suggestRouteForOrder(order, vehicles)).toBe("v1");
  });

  it("returns null when there are no vehicles", () => {
    expect(suggestRouteForOrder({ id: "a", city: "Vicenza", unitCount: 1 }, [])).toBeNull();
  });
});

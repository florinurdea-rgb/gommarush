import { describe, expect, it } from "vitest";
import {
  allocateStand,
  freeStands,
  occupiedStands,
} from "@/lib/logistics/stand-allocation";
import type { StandOccupant } from "@/lib/logistics/stand-allocation";
import type { OrderStatus } from "@/lib/types/logistics";

/**
 * Stand allocation collision prevention.
 *
 * The database enforces this for real (partial unique index + advisory lock);
 * these tests pin the decision rules the UI and server share.
 */

function order(id: string, stand: string | null, status: OrderStatus): StandOccupant {
  return { id, stand_code: stand as StandOccupant["stand_code"], status };
}

describe("occupancy", () => {
  it("counts an order as holding its stand while in a warehouse stage", () => {
    const orders = [
      order("1", "A", "expected"),
      order("2", "B", "partially_received"),
      order("3", "C", "stored"),
      order("4", "D", "ready_for_loading"),
    ];
    expect([...occupiedStands(orders).keys()].sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("frees the stand once the order leaves the warehouse stages", () => {
    // This is the whole release mechanism: no explicit step to forget.
    const orders = [
      order("1", "A", "loaded"),
      order("2", "B", "out_for_delivery"),
      order("3", "C", "delivered"),
      order("4", "D", "cancelled"),
      order("5", "E", "on_hold"),
    ];
    expect(occupiedStands(orders).size).toBe(0);
    expect(freeStands(orders)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("ignores the excluded order, so an order can keep its own stand", () => {
    const orders = [order("1", "A", "expected")];
    expect(freeStands(orders, "1")).toContain("A");
  });
});

describe("allocateStand", () => {
  it("takes the first free stand when none is requested", () => {
    const orders = [order("1", "A", "expected"), order("2", "B", "stored")];
    expect(allocateStand(orders)).toEqual({ kind: "allocated", standCode: "C" });
  });

  it("honours a requested stand that is free", () => {
    const orders = [order("1", "A", "expected")];
    expect(allocateStand(orders, { requested: "E" })).toEqual({
      kind: "allocated",
      standCode: "E",
    });
  });

  it("NEVER silently reuses an occupied stand", () => {
    const orders = [order("existing", "A", "received")];
    const result = allocateStand(orders, { requested: "A" });

    expect(result.kind).toBe("requested_occupied");
    expect(result.standCode).toBeNull();
    if (result.kind === "requested_occupied") {
      expect(result.occupiedBy).toBe("existing");
    }
  });

  it("reports none_available rather than overloading a stand", () => {
    const orders = ["A", "B", "C", "D", "E"].map((stand, index) =>
      order(String(index), stand, "expected")
    );
    expect(allocateStand(orders)).toEqual({ kind: "none_available", standCode: null });
  });

  it("lets a held order's stand be taken by someone else", () => {
    // Hold frees the stand; a new order may legitimately claim it.
    const orders = [order("held", "A", "on_hold")];
    expect(allocateStand(orders, { requested: "A" })).toEqual({
      kind: "allocated",
      standCode: "A",
    });
  });
});

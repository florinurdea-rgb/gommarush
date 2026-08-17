import { describe, expect, it } from "vitest";
import {
  decideLoadingScan,
  decideStorageScan,
  shouldPlaySuccessSound,
} from "@/lib/logistics/scan-rules";
import type { InventoryUnitStatus } from "@/lib/types/logistics";

/**
 * Barcode scan decisions: duplicate safety and wrong-driver protection.
 * These mirror the branches inside gorush_store_unit / gorush_load_unit.
 */

const unit = (status: InventoryUnitStatus) => ({ status });
const order = (driverId: string | null, vehicleId: string | null = null, status = "stored") => ({
  status,
  driver_id: driverId,
  vehicle_id: vehicleId,
});

describe("storage scan", () => {
  it("stores an expected or received unit", () => {
    expect(decideStorageScan(unit("expected"))).toEqual({ outcome: "store", code: "STORED" });
    expect(decideStorageScan(unit("received"))).toEqual({ outcome: "store", code: "STORED" });
  });

  it("reports a duplicate instead of corrupting state", () => {
    const decision = decideStorageScan(unit("stored"));
    expect(decision).toEqual({ outcome: "duplicate", code: "ALREADY_STORED" });
    expect(shouldPlaySuccessSound(decision)).toBe(false);
  });

  it("recognises an item that has already moved on", () => {
    expect(decideStorageScan(unit("loaded")).code).toBe("ALREADY_MOVED_ON");
    expect(decideStorageScan(unit("delivered")).code).toBe("ALREADY_MOVED_ON");
  });

  it("refuses an unknown token rather than inventing a unit", () => {
    expect(decideStorageScan(null)).toEqual({ outcome: "reject", code: "UNIT_NOT_FOUND" });
  });
});

describe("loading scan — wrong-item protection", () => {
  const session = { driverId: "driver-1", vehicleId: "van-1" };

  it("loads a stored unit belonging to this driver", () => {
    const decision = decideLoadingScan({
      unit: unit("stored"),
      order: order("driver-1", "van-1"),
      session,
    });
    expect(decision).toEqual({ outcome: "load", code: "LOADED" });
    expect(shouldPlaySuccessSound(decision)).toBe(true);
  });

  it("REJECTS an item belonging to another driver", () => {
    const decision = decideLoadingScan({
      unit: unit("stored"),
      order: order("driver-2", "van-2"),
      session,
    });
    expect(decision).toEqual({ outcome: "reject", code: "WRONG_DRIVER" });
    expect(shouldPlaySuccessSound(decision)).toBe(false);
  });

  it("rejects a mismatched van even when the driver matches", () => {
    expect(
      decideLoadingScan({
        unit: unit("stored"),
        order: order("driver-1", "van-9"),
        session,
      })
    ).toEqual({ outcome: "reject", code: "WRONG_VEHICLE" });
  });

  it("reports WRONG_DRIVER before ALREADY_LOADED", () => {
    // Holding someone else's tyre is the more important thing to be told,
    // even if that tyre also happens to be loaded already.
    expect(
      decideLoadingScan({
        unit: unit("loaded"),
        order: order("driver-2"),
        session,
      }).code
    ).toBe("WRONG_DRIVER");
  });

  it("refuses to load anything the warehouse never checked in", () => {
    for (const status of ["expected", "received"] as InventoryUnitStatus[]) {
      expect(
        decideLoadingScan({ unit: unit(status), order: order("driver-1"), session }).code
      ).toBe("NOT_STORED");
    }
  });

  it("treats a re-scan during loading as a harmless duplicate", () => {
    const decision = decideLoadingScan({
      unit: unit("loaded"),
      order: order("driver-1"),
      session,
    });
    expect(decision).toEqual({ outcome: "duplicate", code: "ALREADY_LOADED" });
    expect(shouldPlaySuccessSound(decision)).toBe(false);
  });

  it("rejects everything on a cancelled order", () => {
    expect(
      decideLoadingScan({
        unit: unit("stored"),
        order: order("driver-1", "van-1", "cancelled"),
        session,
      }).code
    ).toBe("ORDER_CANCELLED");
  });

  it("does not block on vehicle when the session has no van", () => {
    expect(
      decideLoadingScan({
        unit: unit("stored"),
        order: order("driver-1", "van-1"),
        session: { driverId: "driver-1", vehicleId: null },
      }).code
    ).toBe("LOADED");
  });
});

import { describe, expect, it } from "vitest";
import { operationalStatus } from "@/lib/logistics/operational-status";

describe("operationalStatus", () => {
  it("buckets confirmed/expected as waiting for goods", () => {
    expect(operationalStatus("confirmed", false).bucket).toBe("waiting_goods");
    expect(operationalStatus("expected", false).bucket).toBe("waiting_goods");
  });

  it("buckets received/partially_received as receiving", () => {
    expect(operationalStatus("received", false).bucket).toBe("receiving");
    expect(operationalStatus("partially_received", false).bucket).toBe("receiving");
  });

  it("buckets sorting/stored as to prepare", () => {
    expect(operationalStatus("sorting", false).bucket).toBe("to_prepare");
    expect(operationalStatus("stored", false).bucket).toBe("to_prepare");
  });

  it("buckets ready_for_loading/partially_loaded/loaded/out_for_delivery as ready", () => {
    // ready_for_loading is where "Prepara l'ordine" lands an order — it's
    // already prepared, just waiting for a van, so it reads as ready (🟢)
    // rather than still needing prep (🟣).
    expect(operationalStatus("ready_for_loading", false).bucket).toBe("ready");
    expect(operationalStatus("partially_loaded", false).bucket).toBe("ready");
    expect(operationalStatus("loaded", false).bucket).toBe("ready");
    expect(operationalStatus("out_for_delivery", false).bucket).toBe("ready");
  });

  it("a problem always wins regardless of status", () => {
    expect(operationalStatus("loaded", true).bucket).toBe("problem");
    expect(operationalStatus("confirmed", true).bucket).toBe("problem");
  });

  it("always returns text alongside the emoji, never emoji-only", () => {
    const meta = operationalStatus("received", false);
    expect(meta.emoji.length).toBeGreaterThan(0);
    expect(meta.label.length).toBeGreaterThan(0);
  });
});

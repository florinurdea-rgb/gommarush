import { describe, expect, it } from "vitest";
import {
  buildItemSignature,
  computeOrderFingerprint,
  findExactDuplicate,
  normaliseDocumentNumber,
} from "@/lib/logistics/ddt-dedup";

describe("normaliseDocumentNumber", () => {
  it("trims, uppercases, and collapses internal whitespace", () => {
    expect(normaliseDocumentNumber("  26-21-0562123  ")).toBe("26-21-0562123");
    expect(normaliseDocumentNumber("27tri-0071009")).toBe("27TRI-0071009");
    expect(normaliseDocumentNumber("2e-003120 / pd")).toBe("2E-003120/PD");
  });
});

describe("Test D — same supplier + same DDT uploaded twice", () => {
  it("finds the existing order as an exact duplicate — never a second order", () => {
    const existing = [
      {
        id: "order-1",
        supplierId: "carlini",
        normalizedDocumentNumber: normaliseDocumentNumber("26-21-0562124"),
        supplierDocumentNumber: "26-21-0562124",
      },
    ];

    const duplicate = findExactDuplicate(existing, "carlini", normaliseDocumentNumber("26-21-0562124"));
    expect(duplicate?.id).toBe("order-1");
  });

  it("is not fooled by whitespace/case differences in the re-scanned document number", () => {
    const existing = [
      {
        id: "order-1",
        supplierId: "carlini",
        normalizedDocumentNumber: normaliseDocumentNumber("26-21-0562124"),
        supplierDocumentNumber: "26-21-0562124",
      },
    ];

    const duplicate = findExactDuplicate(existing, "carlini", normaliseDocumentNumber(" 26-21-0562124 "));
    expect(duplicate?.id).toBe("order-1");
  });

  it("does not match the same DDT number from a DIFFERENT supplier", () => {
    const existing = [
      { id: "order-1", supplierId: "carlini", normalizedDocumentNumber: "26-21-0562124", supplierDocumentNumber: "26-21-0562124" },
    ];

    expect(findExactDuplicate(existing, "zuin", "26-21-0562124")).toBeNull();
  });

  it("does not match an unrelated document number from the same supplier", () => {
    const existing = [
      { id: "order-1", supplierId: "carlini", normalizedDocumentNumber: "26-21-0562124", supplierDocumentNumber: "26-21-0562124" },
    ];

    expect(findExactDuplicate(existing, "carlini", "26-21-0562999")).toBeNull();
  });

  it("falls back to the raw supplier_document_number when normalized_document_number is NULL (a legacy row)", () => {
    // The exact bug found in production: an order created before the DDT
    // migration backfilled normalized_document_number (or whose confirm-
    // time update step never ran) has it NULL, but still has the raw
    // value — re-uploading the same DDT must still be recognised as a
    // duplicate instead of crashing on the database's own unique
    // constraint on a doomed re-insert.
    const existing = [
      { id: "order-1", supplierId: "carlini", normalizedDocumentNumber: null, supplierDocumentNumber: "26-21-0562124" },
    ];

    const duplicate = findExactDuplicate(existing, "carlini", normaliseDocumentNumber("26-21-0562124"));
    expect(duplicate?.id).toBe("order-1");
  });

  it("still returns null when both the normalized and raw document numbers are missing", () => {
    const existing = [
      { id: "order-1", supplierId: "carlini", normalizedDocumentNumber: null, supplierDocumentNumber: null },
    ];

    expect(findExactDuplicate(existing, "carlini", normaliseDocumentNumber("26-21-0562124"))).toBeNull();
  });
});

describe("computeOrderFingerprint / spec §17 — product match alone is not deduplication", () => {
  it("gives two different customers buying the identical tyres on the same day different fingerprints", () => {
    const items = buildItemSignature([{ brand: "Michelin", sizeLabel: "225/55 R18", quantity: 4 }]);

    const fingerprintA = computeOrderFingerprint({
      supplierName: "Carlini Gomme Srl",
      customerName: "Rossi Gomme Srl",
      postalCode: "36100",
      documentDate: "2026-08-13",
      itemSignature: items,
      totalTyres: 4,
    });

    const fingerprintB = computeOrderFingerprint({
      supplierName: "Carlini Gomme Srl",
      customerName: "Bianchi Pneumatici Srl",
      postalCode: "36045",
      documentDate: "2026-08-13",
      itemSignature: items,
      totalTyres: 4,
    });

    expect(fingerprintA).not.toBe(fingerprintB);
  });

  it("is stable across supplier-name spelling/legal-suffix noise (S.r.l. vs SRL)", () => {
    const items = buildItemSignature([{ brand: "Michelin", sizeLabel: "225/55 R18", quantity: 4 }]);
    const base = {
      customerName: "Rossi Gomme",
      postalCode: "36100",
      documentDate: "2026-08-13",
      itemSignature: items,
      totalTyres: 4,
    };

    const fingerprintA = computeOrderFingerprint({ ...base, supplierName: "CARLINI GOMME SRL" });
    const fingerprintB = computeOrderFingerprint({ ...base, supplierName: "Carlini Gomme S.r.l." });

    expect(fingerprintA).toBe(fingerprintB);
  });

  it("changes when the item list changes", () => {
    const base = {
      supplierName: "Carlini Gomme Srl",
      customerName: "Rossi Gomme Srl",
      postalCode: "36100",
      documentDate: "2026-08-13",
      totalTyres: 4,
    };

    const fingerprintA = computeOrderFingerprint({
      ...base,
      itemSignature: buildItemSignature([{ brand: "Michelin", sizeLabel: "225/55 R18", quantity: 4 }]),
    });
    const fingerprintB = computeOrderFingerprint({
      ...base,
      itemSignature: buildItemSignature([{ brand: "Pirelli", sizeLabel: "225/55 R18", quantity: 4 }]),
    });

    expect(fingerprintA).not.toBe(fingerprintB);
  });
});

describe("buildItemSignature", () => {
  it("is independent of the order the items were listed in", () => {
    const a = buildItemSignature([
      { brand: "Michelin", sizeLabel: "225/55 R18", quantity: 4 },
      { brand: "Pirelli", sizeLabel: "205/55 R16", quantity: 2 },
    ]);
    const b = buildItemSignature([
      { brand: "Pirelli", sizeLabel: "205/55 R16", quantity: 2 },
      { brand: "Michelin", sizeLabel: "225/55 R18", quantity: 4 },
    ]);
    expect(a).toBe(b);
  });
});

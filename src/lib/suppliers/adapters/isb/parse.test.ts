import { describe, it, expect } from "vitest";
import { parseIsbRow, parseIsbRows, ISB_LANE_CODE } from "./parse";

const OPTS = { isTestData: false, observedAt: "2026-09-21T12:00:00.000Z" };

/** Verbatim row 2 from production catalogue_import_rows.raw_payload. */
const REAL_ROW = {
  xl: "0",
  ean: "4717622044652",
  brand: "NANKANG",
  e_mark: "J",
  season: "summer",
  old_dot: "0",
  european: "N",
  rim_inch: "10",
  run_flat: "0",
  width_mm: "145",
  weight_kg: "6.031",
  ean_status: "valid",
  load_index: "84",
  scan_ready: "1",
  source_row: "2",
  data_status: "READY",
  description: "145     R10 TL 84N  NANK TR10",
  product_key: "GTIN:4717622044652",
  aspect_ratio: "80",
  import_ready: "1",
  size_display: "145/80 R10",
  speed_rating: "N",
  model_pattern: "TR10",
  product_class: "light_truck_van",
  weight_status: "supplier_reported",
  load_speed_raw: "84N",
  review_required: "0",
  weight_category: "1",
  enrichment_needed: "0",
  supplier_item_code: "145    R 10TTR10",
  supplier_article_id: "12851",
  supplier_listing_key: "ISB:12851",
  manufacturer_product_code: "EB208",
  service_description_status: "parsed",
};

describe("ISB parser against the real production row", () => {
  const outcome = parseIsbRow(REAL_ROW, OPTS);
  if (!outcome.ok) throw new Error("expected the real production row to parse");
  const offer = outcome.offer;

  it("preserves the supplier article identifier and listing key", () => {
    expect(offer.supplierArticleId).toBe("12851");
    expect(offer.supplierListingKey).toBe("ISB:12851");
    expect(offer.supplierItemCode).toBe("145    R 10TTR10");
    expect(offer.supplierLaneCode).toBe(ISB_LANE_CODE);
  });

  it("derives the same product key production derived", () => {
    expect(offer.productKey).toBe("GTIN:4717622044652");
    expect(offer.eanStatus).toBe("valid");
  });

  it("normalizes typed product hints from string cells", () => {
    expect(offer.productHints.widthMm).toBe(145);
    expect(offer.productHints.aspectRatio).toBe(80);
    expect(offer.productHints.rimInch).toBe(10);
    expect(offer.productHints.weightKg).toBeCloseTo(6.031);
    expect(offer.productHints.brand).toBe("NANKANG");
    expect(offer.productHints.xl).toBe(false);
    expect(offer.productHints.runFlat).toBe(false);
    expect(offer.productHints.european).toBe(false); // "N"
  });

  it("emits NO review reasons for a clean READY row", () => {
    expect(offer.reviewReasons).toEqual([]);
  });

  it("reports price and stock as UNKNOWN - the ISB feed carries neither", () => {
    expect(offer.purchasePriceNet).toBeNull();
    expect(offer.stockExact).toBeNull();
    expect(offer.stockStatus).toBe("unknown");
    expect(offer.stockConfidence).toBe("unknown");
    expect(offer.leadTimeDays).toBeNull();
    expect(offer.deliveryClass).toBe("unknown");
  });

  it("never invents a PFU", () => {
    expect(offer.pfu).toEqual({ amount: null, status: "TO_CONFIRM", source: null });
  });

  it("keeps the untouched source row", () => {
    expect(offer.raw).toEqual(REAL_ROW);
  });
});

describe("ISB parser - malformed and degraded rows", () => {
  it("REJECTS a row with no supplier article id - the one unaddressable case", () => {
    const outcome = parseIsbRow({ ...REAL_ROW, supplier_article_id: "" }, OPTS);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors).toContain("MISSING_SUPPLIER_ARTICLE_ID");
      expect(outcome.raw).toBeDefined();
    }
  });

  it("ACCEPTS a missing EAN but marks it provisional", () => {
    const outcome = parseIsbRow(
      { ...REAL_ROW, ean: "", supplier_article_id: "447912", supplier_listing_key: "ISB:447912" },
      OPTS,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.offer.productKey).toBe("ISB:447912"); // matches production
      expect(outcome.offer.reviewReasons).toContain("EAN_MISSING");
      expect(outcome.offer.reviewReasons).toContain("PROVISIONAL_NO_VALID_EAN");
    }
  });

  it("flags incomplete dimensions without dropping the row", () => {
    const outcome = parseIsbRow({ ...REAL_ROW, width_mm: "", rim_inch: "" }, OPTS);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.offer.reviewReasons).toContain("DIMENSIONS_INCOMPLETE");
      expect(outcome.offer.productHints.widthMm).toBeNull();
    }
  });

  it("flags a missing weight and does not carry a bogus weight through", () => {
    const outcome = parseIsbRow(
      { ...REAL_ROW, weight_kg: "", weight_status: "missing_or_zero" },
      OPTS,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.offer.reviewReasons).toContain("WEIGHT_MISSING");
      expect(outcome.offer.productHints.weightKg).toBeNull();
    }
  });

  it("flags unresolved class/season", () => {
    const outcome = parseIsbRow({ ...REAL_ROW, product_class: "", season: "" }, OPTS);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.offer.reviewReasons).toContain("CLASS_OR_SEASON_UNRESOLVED");
    }
  });

  it("flags an unparsed service description (NHS rows)", () => {
    const outcome = parseIsbRow(
      { ...REAL_ROW, service_description_status: "not_applicable_nhs" },
      OPTS,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.offer.reviewReasons).toContain("LI_SI_UNPARSED");
  });

  it("treats an unrecognised boolean as unknown, not false", () => {
    const outcome = parseIsbRow({ ...REAL_ROW, xl: "MAYBE" }, OPTS);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.offer.productHints.xl).toBeNull();
  });

  it("survives a completely empty object without throwing", () => {
    const outcome = parseIsbRow({}, OPTS);
    expect(outcome.ok).toBe(false);
  });

  it("deduplicates review reasons", () => {
    const outcome = parseIsbRow({ ...REAL_ROW, ean: "", product_class: "", season: "" }, OPTS);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const unique = new Set(outcome.offer.reviewReasons);
      expect(unique.size).toBe(outcome.offer.reviewReasons.length);
    }
  });
});

describe("ISB parser - duplicate handling and batch behaviour", () => {
  it("gives two rows with the same EAN the SAME product key but DISTINCT listing keys", () => {
    // New stock vs old DOT: two listings may share one catalogue product.
    const a = parseIsbRow({ ...REAL_ROW, supplier_article_id: "1", supplier_listing_key: "ISB:1" }, OPTS);
    const b = parseIsbRow({ ...REAL_ROW, supplier_article_id: "2", supplier_listing_key: "ISB:2", old_dot: "1" }, OPTS);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.offer.productKey).toBe(b.offer.productKey);
      expect(a.offer.supplierListingKey).not.toBe(b.offer.supplierListingKey);
      expect(b.offer.productHints.oldDot).toBe(true);
    }
  });

  it("parses a batch and reports per-row outcomes", () => {
    const outcomes = parseIsbRows(
      [REAL_ROW, { ...REAL_ROW, supplier_article_id: "" }, { ...REAL_ROW, supplier_article_id: "3" }],
      OPTS,
    );
    expect(outcomes).toHaveLength(3);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(2);
    expect(outcomes.filter((o) => !o.ok)).toHaveLength(1);
  });

  it("propagates the test-data flag onto every offer", () => {
    const outcome = parseIsbRow(REAL_ROW, { ...OPTS, isTestData: true });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.offer.isTestData).toBe(true);
  });
});

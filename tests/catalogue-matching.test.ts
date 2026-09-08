import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHT_TOLERANCE_KG,
  isIdentifyingSpec,
  matchRow,
  planProductUpdate,
  specsCompatible,
  type ExistingListing,
  type ExistingProduct,
  type MatchContext,
} from "@/lib/catalogue/matching";
import type { NormalizedCatalogueRow } from "@/lib/types/catalogue";

/**
 * The matching rules.
 *
 * Almost every test here asserts a REFUSAL: the importer declining to merge,
 * to overwrite, or to pick a winner. Those are the behaviours that protect
 * the catalogue, and they are the ones that would silently disappear under a
 * well-meaning refactor.
 */

const SUPPLIER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function row(overrides: Partial<NormalizedCatalogueRow> = {}): NormalizedCatalogueRow {
  return {
    sourceRow: 2,
    supplierListingKey: "ISB:12851",
    supplierArticleId: "12851",
    supplierItemCode: "145    R 10TTR10",
    sourceProductKey: "GTIN:4717622044652",
    productKey: "GTIN:4717622044652",
    ean: "4717622044652",
    eanRaw: "4717622044652",
    eanStatus: "valid",
    manufacturerProductCode: "EB208",
    brandCode: null,
    brand: "NANKANG",
    modelPattern: "TR10",
    description: "145     R10 TL 84N  NANK TR10",
    productClass: "light_truck_van",
    season: "summer",
    widthMm: 145,
    aspectRatio: 80,
    rimInch: 10,
    sizeDisplay: "145/80 R10",
    loadSpeedRaw: "84N",
    loadIndex: "84",
    speedRating: "N",
    xl: false,
    runFlat: false,
    oldDot: false,
    weightKg: 6.031,
    weightStatus: "supplier_reported",
    weightCategory: "1",
    eMark: "J",
    european: false,
    eprelId: null,
    scanReady: true,
    reviewRequired: false,
    reviewReasons: [],
    purchasePrice: null,
    stockRaw: null,
    stockExact: null,
    stockMinimum: null,
    ...overrides,
  };
}

function product(overrides: Partial<ExistingProduct> = {}): ExistingProduct {
  return {
    id: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
    productKey: "GTIN:4717622044652",
    ean: "4717622044652",
    eanStatus: "valid",
    brand: "NANKANG",
    brandCode: null,
    modelPattern: "TR10",
    widthMm: 145,
    aspectRatio: 80,
    rimInch: 10,
    loadIndex: "84",
    speedRating: "N",
    xl: false,
    runFlat: false,
    season: "summer",
    eMark: "J",
    manufacturerProductCode: "EB208",
    weightKg: 6.031,
    weightStatus: "supplier_reported",
    scanReady: true,
    reviewRequired: false,
    productClass: "light_truck_van",
    description: "145     R10 TL 84N  NANK TR10",
    sizeDisplay: "145/80 R10",
    loadSpeedRaw: "84N",
    weightCategory: "1",
    european: false,
    eprelId: null,
    oldDot: false,
    ...overrides,
  };
}

function listing(overrides: Partial<ExistingListing> = {}): ExistingListing {
  return {
    id: "llllllll-llll-4lll-8lll-llllllllllll",
    supplierId: SUPPLIER,
    supplierListingKey: "ISB:12851",
    supplierArticleId: "12851",
    catalogueProductId: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
    supplierItemCode: "145    R 10TTR10",
    oldDot: false,
    active: true,
    ...overrides,
  };
}

function context(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    supplierId: SUPPLIER,
    listingByKey: new Map(),
    listingBySupplierArticle: new Map(),
    productByEan: new Map(),
    productByKey: new Map(),
    productById: new Map(),
    productsByManufacturerCode: new Map(),
    ...overrides,
  };
}

function withProduct(existing: ExistingProduct, extra: Partial<MatchContext> = {}): MatchContext {
  return context({
    productByEan: existing.ean ? new Map([[existing.ean, existing]]) : new Map(),
    productByKey: new Map([[existing.productKey, existing]]),
    productById: new Map([[existing.id, existing]]),
    productsByManufacturerCode: existing.manufacturerProductCode
      ? new Map([[existing.manufacturerProductCode.toUpperCase(), [existing]]])
      : new Map(),
    ...extra,
  });
}

describe("specsCompatible", () => {
  it("treats an unknown field as compatible, not as a difference", () => {
    const result = specsCompatible(
      { ...product(), modelPattern: null } as never,
      product() as never
    );
    expect(result.compatible).toBe(true);
  });

  it("names every field where two known values disagree", () => {
    const result = specsCompatible(product(), product({ rimInch: 16, speedRating: "V" }));
    expect(result.compatible).toBe(false);
    expect(result.mismatches).toContain("rimInch");
    expect(result.mismatches).toContain("speedRating");
  });

  it("compares brands case-insensitively", () => {
    expect(specsCompatible(product({ brand: "nankang" }), product()).compatible).toBe(true);
  });
});

describe("isIdentifyingSpec", () => {
  it("rejects a size with no brand — dimensions alone identify nothing", () => {
    expect(isIdentifyingSpec(product({ brand: null }))).toBe(false);
  });

  it("accepts a fully specified tyre", () => {
    expect(isIdentifyingSpec(product())).toBe(true);
  });
});

describe("matchRow — precedence", () => {
  it("matches an existing listing by its supplier listing key", () => {
    const existing = product();
    const decision = matchRow(
      row(),
      withProduct(existing, { listingByKey: new Map([["ISB:12851", listing()]]) })
    );
    expect(decision.strategy).toBe("existing_listing_key");
    expect(decision.action).toBe("unchanged");
  });

  it("matches on supplier id + article id when the key format changed", () => {
    const existing = product();
    const decision = matchRow(
      row({ supplierListingKey: "ISB-NEW:12851" }),
      withProduct(existing, {
        listingBySupplierArticle: new Map([[`${SUPPLIER}:12851`, listing()]]),
      })
    );
    expect(decision.strategy).toBe("supplier_article");
  });

  /** A new supplier code for a tyre we already hold, proven by its barcode. */
  it("attaches a new supplier code to an existing product via a validated EAN", () => {
    const decision = matchRow(row({ supplierListingKey: "ISB:99999", supplierArticleId: "99999" }), withProduct(product()));
    expect(decision.strategy).toBe("validated_ean");
    expect(decision.action).toBe("insert_listing");
    expect(decision.productId).toBe(product().id);
  });

  it("creates a new product when nothing matches", () => {
    const decision = matchRow(row(), context());
    expect(decision.strategy).toBe("new_product");
    expect(decision.action).toBe("insert_product");
    expect(decision.productId).toBeNull();
  });

  it("marks a row with no usable barcode as provisional", () => {
    const decision = matchRow(
      row({ ean: null, eanStatus: "missing", scanReady: false }),
      context()
    );
    expect(decision.action).toBe("insert_product");
    expect(decision.reasons).toContain("PROVISIONAL_NO_VALID_EAN");
  });
});

describe("matchRow — duplicate EANs", () => {
  it("shares one product between two listings when the specs agree (new vs old DOT)", () => {
    const decision = matchRow(
      row({ supplierListingKey: "ISB:22222", supplierArticleId: "22222", oldDot: true }),
      withProduct(product())
    );
    expect(decision.action).toBe("insert_listing");
    expect(decision.productId).toBe(product().id);
    expect(decision.conflicts).toHaveLength(0);
  });

  it("refuses to merge two different tyres that share a barcode", () => {
    const decision = matchRow(
      row({ supplierListingKey: "ISB:33333", supplierArticleId: "33333", rimInch: 16, brand: "MICHELIN" }),
      withProduct(product())
    );
    expect(decision.action).toBe("conflict");
    expect(decision.conflicts[0].conflictType).toBe("ean_spec_mismatch");
    expect(decision.conflicts[0].detail.mismatches).toContain("rimInch");
  });
});

describe("planProductUpdate — data may improve, never degrade", () => {
  it("fills in a weight we did not have", () => {
    const plan = planProductUpdate(product({ weightKg: null, weightStatus: "missing_or_zero" }), row());
    expect(plan.changes.weight_kg).toBe(6.031);
    expect(plan.changes.weight_status).toBe("supplier_reported");
    expect(plan.reasons).toContain("WEIGHT_DISCOVERED");
  });

  it("never lets a zero or blank weight clear a real one", () => {
    const plan = planProductUpdate(
      product(),
      row({ weightKg: null, weightStatus: "missing_or_zero" })
    );
    expect(plan.changes).not.toHaveProperty("weight_kg");
    expect(plan.changes).not.toHaveProperty("weight_status");
    expect(plan.conflicts).toHaveLength(0);
  });

  it("raises a conflict when two supplier weights differ materially", () => {
    const plan = planProductUpdate(product(), row({ weightKg: 9.5 }));
    expect(plan.changes).not.toHaveProperty("weight_kg");
    expect(plan.conflicts[0].conflictType).toBe("weight_conflict");
    expect(plan.conflicts[0].detail.differenceKg).toBeCloseTo(3.469, 3);
  });

  it("accepts a difference inside the tolerance without a conflict or an update", () => {
    const plan = planProductUpdate(product(), row({ weightKg: 6.031 + DEFAULT_WEIGHT_TOLERANCE_KG / 2 }));
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.changes).not.toHaveProperty("weight_kg");
  });

  it("never averages two conflicting weights", () => {
    const plan = planProductUpdate(product(), row({ weightKg: 9.5 }));
    const average = (6.031 + 9.5) / 2;
    expect(Object.values(plan.changes)).not.toContain(average);
  });

  it("records a barcode we did not have", () => {
    const plan = planProductUpdate(product({ ean: null, eanStatus: "missing", scanReady: false }), row());
    expect(plan.changes.ean).toBe("4717622044652");
    expect(plan.changes.scan_ready).toBe(true);
    expect(plan.reasons).toContain("EAN_DISCOVERED");
  });

  it("never overwrites a verified EAN because a new file disagrees", () => {
    const plan = planProductUpdate(product(), row({ ean: "3528701101811", productKey: "GTIN:3528701101811" }));
    expect(plan.changes).not.toHaveProperty("ean");
    expect(plan.conflicts[0].conflictType).toBe("product_ean_change");
    expect(plan.conflicts[0].existingValue).toBe("4717622044652");
    expect(plan.conflicts[0].incomingValue).toBe("3528701101811");
  });

  it("does not let an invalid incoming barcode touch a good one", () => {
    const plan = planProductUpdate(
      product(),
      row({ ean: null, eanStatus: "invalid_check_digit", scanReady: false })
    );
    expect(plan.changes).not.toHaveProperty("ean");
    expect(plan.conflicts).toHaveLength(0);
  });

  it("fills a missing descriptive field but leaves a populated one alone", () => {
    const plan = planProductUpdate(
      product({ eprelId: null, description: "ORIGINAL DESCRIPTION" }),
      row({ eprelId: "470869", description: "A DIFFERENT DESCRIPTION" })
    );
    expect(plan.changes.eprel_id).toBe("470869");
    expect(plan.changes).not.toHaveProperty("description");
  });

  it("flags a manufacturer code that contradicts the one on file", () => {
    const plan = planProductUpdate(product(), row({ manufacturerProductCode: "XX999" }));
    expect(plan.conflicts[0].conflictType).toBe("manufacturer_code_conflict");
    expect(plan.changes).not.toHaveProperty("manufacturer_product_code");
  });
});

describe("matchRow — repeated imports", () => {
  it("reports an identical re-import as unchanged, writing nothing", () => {
    const decision = matchRow(
      row(),
      withProduct(product(), { listingByKey: new Map([["ISB:12851", listing()]]) })
    );
    expect(decision.action).toBe("unchanged");
    expect(decision.productChanges).toEqual({});
    expect(decision.listingChanges).toEqual({});
  });

  it("reactivates a listing that reappears after being marked inactive", () => {
    const decision = matchRow(
      row(),
      withProduct(product(), { listingByKey: new Map([["ISB:12851", listing({ active: false })]]) })
    );
    expect(decision.action).toBe("update_listing");
    expect(decision.listingChanges.active).toBe(true);
  });

  it("refreshes mutable supplier data on an existing listing", () => {
    const decision = matchRow(
      row({ supplierItemCode: "NEW CODE" }),
      withProduct(product(), { listingByKey: new Map([["ISB:12851", listing()]]) })
    );
    expect(decision.action).toBe("update_listing");
    expect(decision.listingChanges.supplier_item_code).toBe("NEW CODE");
  });
});

describe("matchRow — ambiguity is an outcome", () => {
  it("refuses to choose between two products sharing a manufacturer code", () => {
    const first = product({ id: "1", productKey: "ISB:1", ean: null });
    const second = product({ id: "2", productKey: "ISB:2", ean: null });
    const decision = matchRow(
      row({ ean: null, eanStatus: "missing", scanReady: false }),
      context({
        productsByManufacturerCode: new Map([["EB208", [first, second]]]),
        productByKey: new Map([
          ["ISB:1", first],
          ["ISB:2", second],
        ]),
        productById: new Map([
          [first.id, first],
          [second.id, second],
        ]),
      })
    );
    expect(decision.action).toBe("conflict");
    expect(decision.conflicts[0].conflictType).toBe("ambiguous_match");
  });

  it("does not merge two products merely because the dimensions match", () => {
    // Same size, different brand: not a match on specs, so a new product.
    const other = product({ id: "9", productKey: "ISB:9", ean: null, brand: "MICHELIN", manufacturerProductCode: null });
    const decision = matchRow(
      row({ ean: null, eanStatus: "missing", scanReady: false, manufacturerProductCode: null }),
      context({
        productByKey: new Map([["ISB:9", other]]),
        productById: new Map([[other.id, other]]),
      })
    );
    expect(decision.action).toBe("insert_product");
    expect(decision.productId).toBeNull();
  });
});

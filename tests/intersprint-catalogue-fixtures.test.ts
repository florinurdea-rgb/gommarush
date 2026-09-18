import { describe, expect, it } from "vitest";
import { parseGatewayResponse, toStockRow } from "@/lib/suppliers/gateway/response";
import {
  CATALOGUE_PROBE_SET,
  sizeMatchesDescription,
  type CatalogueProbeProduct,
} from "./intersprint-catalogue-fixtures";

/**
 * The identity check the live probe relies on.
 *
 * These run in CI with no network. The point is that when real credentials
 * arrive, the only unknown is Inter-Sprint's answer — not whether our
 * verification of that answer works. A probe whose checking logic is itself
 * unverified cannot produce evidence.
 */

/** Manual §2.1, Example 1 — a real protocol 103 response, verbatim. */
const MANUAL_103_RESPONSE =
  "034949\t225 40ZR 18TCSC2N2EU\tCO\t11\t225/40 ZR18 TL ZR CO CSC 2 N2 EU\tEUR\t105.89\t224.00\t10\n*END*";

/** The tyre that response describes, expressed as one of our catalogue rows. */
const MANUAL_PRODUCT: CatalogueProbeProduct = {
  ean: "0000000000000",
  brand: "CONTINENTAL",
  model: "CSC2",
  sizeDisplay: "225/40 R18",
  loadSpeed: "92Y",
  widthMm: 225,
  aspectRatio: 40,
  rimInch: 18,
  runFlat: false,
  xl: false,
  supplierArticleId: "n/a",
};

describe("Protocol 103 response mapping", () => {
  it("extracts net price, currency and availability from the manual's example", () => {
    const outcome = parseGatewayResponse(MANUAL_103_RESPONSE);
    expect(outcome.status).toBe("data");
    if (outcome.status !== "data") throw new Error("unreachable");

    const row = toStockRow(outcome.rows[0]);
    expect(row.articleSystemNumber).toBe("034949");
    expect(row.brand).toBe("CO");
    expect(row.currency).toBe("EUR");
    expect(row.netPrice).toBe("105.89");
    expect(row.grossPrice).toBe("224.00");
    expect(row.available).toBe("10");
  });

  it("confirms the response describes the tyre that was asked for", () => {
    const outcome = parseGatewayResponse(MANUAL_103_RESPONSE);
    if (outcome.status !== "data") throw new Error("expected data");
    const row = toStockRow(outcome.rows[0]);

    expect(sizeMatchesDescription(MANUAL_PRODUCT, row.description)).toBe(true);
  });

  /**
   * The case that matters. A lookup answering about the WRONG article is
   * worse than one answering nothing, because it would silently price a
   * different tyre.
   */
  it("rejects a response describing a different size", () => {
    const outcome = parseGatewayResponse(MANUAL_103_RESPONSE);
    if (outcome.status !== "data") throw new Error("expected data");
    const row = toStockRow(outcome.rows[0]);

    const wrongSize = CATALOGUE_PROBE_SET[0]; // 205/55 R16
    expect(sizeMatchesDescription(wrongSize, row.description)).toBe(false);
  });

  it("reports undetermined rather than mismatch when the description is empty", () => {
    expect(sizeMatchesDescription(MANUAL_PRODUCT, "")).toBeNull();
    expect(sizeMatchesDescription(MANUAL_PRODUCT, "   ")).toBeNull();
  });

  it("matches our own 205/55 R16 set against a plausible supplier description", () => {
    for (const product of CATALOGUE_PROBE_SET) {
      expect(
        sizeMatchesDescription(product, "205/55 R16 TL 91 V SUMMER"),
        `${product.brand} ${product.model} should match a 205/55 R16 description`
      ).toBe(true);
    }
  });
});

describe("the Protocol 103 proof set", () => {
  it("is five distinct brands with valid 13-digit EANs", () => {
    expect(CATALOGUE_PROBE_SET).toHaveLength(5);

    const eans = CATALOGUE_PROBE_SET.map((p) => p.ean);
    expect(new Set(eans).size).toBe(5);
    for (const ean of eans) expect(ean).toMatch(/^[0-9]{13}$/);

    const brands = CATALOGUE_PROBE_SET.map((p) => p.brand);
    expect(new Set(brands)).toEqual(
      new Set(["PIRELLI", "MICHELIN", "CONTINENTAL", "HANKOOK", "VREDESTEIN"])
    );
  });

  /**
   * Each brand's EAN must carry that manufacturer's own GS1 prefix. This is
   * the property the whole bridge depends on: if these were supplier-assigned
   * barcodes rather than manufacturer-global ones, Inter-Sprint would have no
   * reason to recognise a single one of them, and `catalogue_products.ean`
   * could not be the join between our catalogue and theirs.
   */
  it("carries manufacturer GS1 prefixes, not supplier-assigned barcodes", () => {
    const EXPECTED_PREFIX: Record<string, string> = {
      PIRELLI: "8019", // Italy
      MICHELIN: "3528", // France
      CONTINENTAL: "4019", // Germany
      HANKOOK: "8808", // South Korea
      VREDESTEIN: "8714", // Netherlands
    };

    for (const product of CATALOGUE_PROBE_SET) {
      expect(
        product.ean.slice(0, 4),
        `${product.brand} EAN ${product.ean} should start with ${EXPECTED_PREFIX[product.brand]}`
      ).toBe(EXPECTED_PREFIX[product.brand]);
    }
  });

  /**
   * ISB's article id must never reach Inter-Sprint. The two identifier spaces
   * are unrelated, and `artc=S=<isb id>` would either miss or — far worse —
   * resolve to an unrelated Inter-Sprint article.
   */
  it("keeps the ISB article id as provenance only, distinct from the EAN", () => {
    for (const product of CATALOGUE_PROBE_SET) {
      expect(product.supplierArticleId).not.toBe(product.ean);
      expect(product.supplierArticleId).toMatch(/^[0-9]+$/);
    }
  });
});

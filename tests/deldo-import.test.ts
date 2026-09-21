import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDeldoImport,
  persistDeldoImport,
  deldoFileChecksum,
  DeldoImportError,
  DeldoPersistenceUnavailableError,
  DELDO_REQUIRED_SCHEMA,
  CsvStructureError,
  type DeldoImportRequest,
} from "@/lib/suppliers/deldo/feed/import";
import { classifyObservation, isCommerciallyUsable } from "@/lib/suppliers/observation";

const FIXTURE = readFileSync(
  join(__dirname, "fixtures", "deldo-feed-sample.csv"),
  "utf8"
);

const OBSERVED_AT = new Date("2026-09-21T12:00:00Z");

function request(overrides: Partial<DeldoImportRequest> = {}): DeldoImportRequest {
  return {
    content: FIXTURE,
    sourceFilename: "deldo-feed-2026-09-21T12.csv",
    classification: "test",
    commercialMode: "unknown",
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

describe("Deldo import pipeline", () => {
  it("carries the whole fixture from CSV to observations", () => {
    const result = buildDeldoImport(request());
    expect(result.counts.totalDataLines).toBe(10);
    expect(result.counts.accepted).toBe(10);
    expect(result.counts.rejected).toBe(0);
    expect(result.counts.malformed).toBe(0);
    expect(result.listings).toHaveLength(10);
  });

  it("reports the conventions found in the real file", () => {
    const result = buildDeldoImport(request());
    // BR672722 carries Dot=2022.
    expect(result.counts.oldDotListings).toBe(1);
    // One fixture row has no EAN at all.
    expect(result.counts.withoutEan).toBe(1);
    expect(result.counts.review).toBeGreaterThan(0);
    expect(result.counts.clean + result.counts.review).toBe(10);
  });

  it("pairs every listing with an observation carrying the request's provenance", () => {
    const result = buildDeldoImport(
      request({ classification: "test", commercialMode: "transport_separate" })
    );
    for (const listing of result.listings) {
      expect(listing.observation.laneCode).toBe("deldo");
      expect(listing.observation.source).toBe("bulk_feed");
      expect(listing.observation.classification).toBe("test");
      expect(listing.observation.commercialMode).toBe("transport_separate");
      expect(listing.observation.observedAt).toEqual(OBSERVED_AT);
      // No currency is supplied by Deldo anywhere, so none is invented.
      expect(listing.observation.currency).toBeNull();
    }
  });

  it("keeps the Deldo Article as the listing identity", () => {
    const result = buildDeldoImport(request());
    const keys = result.listings.map((l) => l.row.supplierListingKey);
    expect(keys).toContain("DELDO:BR6727");
    expect(keys).toContain("DELDO:BR672722");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps exact listing identity and source condition on the observation itself", () => {
    const result = buildDeldoImport(request());
    const normal = result.listings.find((l) => l.row.supplierArticleId === "BR6727");
    const older = result.listings.find((l) => l.row.supplierArticleId === "BR672722");
    expect(normal?.observation.supplierListingKey).toBe("DELDO:BR6727");
    expect(older?.observation.supplierListingKey).toBe("DELDO:BR672722");
    expect(normal?.observation.stockCondition).toBe("normal");
    expect(older?.observation.stockCondition).toBe("older_dot");
    expect(older?.observation.dotYear).toBe("2022");
  });

  it("does not assume EAN is unique", () => {
    const result = buildDeldoImport(request());
    const pair = result.listings.filter(
      (l) => l.row.supplierArticleId === "BR6727" || l.row.supplierArticleId === "BR672722"
    );
    expect(pair).toHaveLength(2);
    // Same product, two listings, two different prices.
    expect(pair[0].row.productKey).toBe(pair[1].row.productKey);
    expect(pair[0].row.supplierListingKey).not.toBe(pair[1].row.supplierListingKey);
    expect(pair[0].observation.purchasePrice).not.toBe(pair[1].observation.purchasePrice);
  });

  it("computes a stable checksum for idempotency", () => {
    expect(deldoFileChecksum(FIXTURE)).toBe(deldoFileChecksum(FIXTURE));
    expect(deldoFileChecksum(FIXTURE)).not.toBe(deldoFileChecksum(FIXTURE + "\n"));
    expect(deldoFileChecksum(FIXTURE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across runs", () => {
    expect(buildDeldoImport(request())).toEqual(buildDeldoImport(request()));
  });
});

describe("Deldo import safety", () => {
  /**
   * The mission's core guarantee. The supplier said 26933TEST.csv contains
   * fictional stocks and prices; importing it as live is refused outright
   * rather than trusted to the caller's parameter.
   */
  it("refuses to import the known test file as live data", () => {
    expect(() =>
      buildDeldoImport(
        request({ sourceFilename: "26933TEST.csv", classification: "live" })
      )
    ).toThrow(DeldoImportError);

    expect(() =>
      buildDeldoImport(
        request({ sourceFilename: "/inbox/deldo/26933TEST.csv", classification: "live" })
      )
    ).toThrow(/fictional stocks and prices/);

    // Case is not a way around it.
    expect(() =>
      buildDeldoImport(
        request({ sourceFilename: "26933test.CSV", classification: "live" })
      )
    ).toThrow(DeldoImportError);
  });

  it("allows the test file when it is correctly declared as test", () => {
    expect(() =>
      buildDeldoImport(
        request({ sourceFilename: "26933TEST.csv", classification: "test" })
      )
    ).not.toThrow();
  });

  /**
   * End to end: whatever the import produces from a test feed must never be
   * usable commercially, no matter how fresh or complete it is.
   */
  it("produces observations that can never be commercially usable from a test feed", () => {
    const result = buildDeldoImport(
      request({
        classification: "test",
        commercialMode: "transport_separate",
        observedAt: OBSERVED_AT,
      })
    );
    for (const listing of result.listings) {
      const state = classifyObservation(
        listing.observation,
        { staleAfterMs: 24 * 60 * 60 * 1000 },
        OBSERVED_AT
      );
      expect(state.state).toBe("test_data");
      expect(isCommerciallyUsable(state)).toBe(false);
    }
  });

  it("still withholds a live feed whose commercial mode is unconfirmed", () => {
    const result = buildDeldoImport(
      request({ classification: "live", commercialMode: "unknown" })
    );
    const state = classifyObservation(
      result.listings[0].observation,
      { staleAfterMs: 24 * 60 * 60 * 1000 },
      OBSERVED_AT
    );
    // Real data, but the price's meaning is not yet established.
    expect(state).toEqual({
      state: "no_usable_observation",
      reason: "unknown_commercial_mode",
    });
  });

  it("fails loudly on an incompatible header rather than importing part of it", () => {
    expect(() =>
      buildDeldoImport(request({ content: FIXTURE.replace("Stock;Price;", "Price;Stock;") }))
    ).toThrow(CsvStructureError);
  });

  it("rejects bad commercial rows without losing the good ones", () => {
    const lines = FIXTURE.split("\n");
    // Corrupt one row's Price (column 17).
    const fields = lines[2].split(";");
    fields[16] = "48,50";
    lines[2] = fields.join(";");

    const result = buildDeldoImport(request({ content: lines.join("\n") }));
    expect(result.counts.rejected).toBe(1);
    expect(result.counts.accepted).toBe(9);
    expect(result.rejected[0].errors.join(" ")).toContain("Price");
    // The untouched source row survives for audit.
    expect(result.rejected[0].raw.Price).toBe("48,50");
  });
});

describe("Deldo persistence boundary", () => {
  /**
   * Throws rather than no-oping. A silent no-op would let a caller believe an
   * import succeeded, and the first symptom would be an empty catalogue that
   * nobody could explain.
   */
  it("refuses to persist until the schema can record classification", () => {
    const result = buildDeldoImport(request());
    expect(() => persistDeldoImport(result)).toThrow(DeldoPersistenceUnavailableError);
  });

  it("names exactly what the schema is missing", () => {
    const result = buildDeldoImport(request());
    try {
      persistDeldoImport(result);
      throw new Error("expected the boundary to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DeldoPersistenceUnavailableError);
      const missing = (error as DeldoPersistenceUnavailableError).missingSchema;
      expect(missing).toEqual(DELDO_REQUIRED_SCHEMA);
      expect(missing).toContain("supplier_listing_prices.data_classification");
      expect((error as Error).message).toContain("DATABASE_BASELINE");
    }
  });

  it("requires a classification column on both the run and the observation", () => {
    // Knowing a RUN was a test import is not enough: observations outlive the
    // run they came from and are queried on their own.
    expect(DELDO_REQUIRED_SCHEMA).toContain("catalogue_import_runs.data_classification");
    expect(DELDO_REQUIRED_SCHEMA).toContain("supplier_listing_prices.data_classification");
  });
});

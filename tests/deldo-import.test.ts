import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDeldoImport,
  persistDeldoImport,
  deldoFileChecksum,
  DeldoImportError,
  DeldoPersistenceUnavailableError,
  planDeldoListingPersistence,
  DELDO_REQUIRED_SCHEMA,
  CsvStructureError,
  type DeldoImportRequest,
} from "@/lib/suppliers/deldo/feed/import";
import {
  classifyObservation,
  isCommerciallyUsable,
  DataClassificationError,
} from "@/lib/suppliers/observation";

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

describe("Deldo exact-key persistence planning", () => {
  it("plans duplicate-EAN listings independently by supplier listing key", () => {
    const result = buildDeldoImport(request());
    const pair = result.listings.filter(
      (l) => l.row.supplierArticleId === "BR6727" || l.row.supplierArticleId === "BR672722"
    );
    const plans = pair.map(planDeldoListingPersistence);
    expect(plans.map((p) => p.supplierListingKey).sort()).toEqual([
      "DELDO:BR6727",
      "DELDO:BR672722",
    ].sort());
  });

  it("refuses a detached observation paired to the wrong listing", () => {
    const result = buildDeldoImport(request());
    const a = result.listings[0];
    const b = result.listings[1];
    expect(() =>
      planDeldoListingPersistence({ row: a.row, observation: b.observation })
    ).toThrow(/key mismatch|article id mismatch/);
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

/**
 * THE IMPORT SAFETY BOUNDARY.
 *
 * `DeldoImportRequest` is a TypeScript type, and TypeScript is erased at build
 * time. It constrains code we compile; it constrains nothing that arrives over
 * HTTP, from an upload form, from a scheduler payload or from JSON on disk.
 *
 * These tests therefore attack the boundary the way a real caller would: with
 * values the compiler would have rejected, cast through `unknown`. If any of
 * them reaches an observation, fictional supplier data has entered the
 * commercial path wearing a live label.
 */
describe("Deldo import: explicit data classification", () => {
  function untyped(overrides: Record<string, unknown>) {
    return {
      content: FIXTURE,
      sourceFilename: "deldo-feed.csv",
      classification: "live",
      commercialMode: "unknown",
      observedAt: OBSERVED_AT,
      ...overrides,
    } as unknown as DeldoImportRequest;
  }

  it("keeps an explicit test classification as test", () => {
    const result = buildDeldoImport(untyped({ classification: "test" }));
    expect(result.classification).toBe("test");
    expect(result.listings.every((l) => l.observation.classification === "test")).toBe(true);
  });

  it("keeps an explicit live classification as live", () => {
    const result = buildDeldoImport(untyped({ classification: "live" }));
    expect(result.classification).toBe("live");
    expect(result.listings.every((l) => l.observation.classification === "live")).toBe(true);
  });

  it("REFUSES a missing classification instead of defaulting", () => {
    expect(() => buildDeldoImport(untyped({ classification: undefined }))).toThrow(
      DataClassificationError
    );
    const { classification: _dropped, ...withoutKey } = untyped({});
    expect(() => buildDeldoImport(withoutKey as unknown as DeldoImportRequest)).toThrow(
      DataClassificationError
    );
  });

  it("REFUSES null, empty string and non-strings", () => {
    for (const bad of [null, "", 0, 1, true, false, {}, [], NaN]) {
      expect(() => buildDeldoImport(untyped({ classification: bad }))).toThrow(
        DataClassificationError
      );
    }
  });

  it("REFUSES a near-miss spelling rather than helpfully coercing it", () => {
    // "LIVE" coerced to "live" is precisely how fictional data would acquire a
    // real label. A caller that cannot spell its classification has not proven
    // which one it means.
    for (const bad of ["LIVE", "Live", "TEST", "Test", " live", "live ", "production", "prod", "real", "sample"]) {
      expect(() => buildDeldoImport(untyped({ classification: bad }))).toThrow(
        DataClassificationError
      );
    }
  });

  it("NEVER falls back to live - every refusal is a throw, not a value", () => {
    for (const bad of [undefined, null, "", "LIVE", "production", 1]) {
      let produced: unknown = "no-throw";
      try {
        produced = buildDeldoImport(untyped({ classification: bad })).classification;
      } catch {
        produced = "threw";
      }
      expect(produced).toBe("threw");
    }
  });

  it("names the offending value so a broken caller is diagnosable", () => {
    expect(() => buildDeldoImport(untyped({ classification: "LIVE" }))).toThrow(/"LIVE"/);
    expect(() => buildDeldoImport(untyped({ classification: undefined }))).toThrow(
      /undefined \(absent\)/
    );
    expect(() => buildDeldoImport(untyped({ classification: undefined }))).toThrow(
      /no default/
    );
  });

  it("refuses before reading the file, so a bad caller cannot even parse", () => {
    // Garbage content AND a bad classification: the classification error must
    // win, proving the check runs first.
    expect(() =>
      buildDeldoImport(untyped({ classification: undefined, content: "not;a;csv" }))
    ).toThrow(DataClassificationError);
  });

  it("REFUSES a missing or invalid commercial mode", () => {
    for (const bad of [undefined, null, "", "TRANSPORT_SEPARATE", "included", 0]) {
      expect(() => buildDeldoImport(untyped({ commercialMode: bad }))).toThrow(
        DataClassificationError
      );
    }
  });

  it("accepts 'unknown' as an EXPLICIT commercial mode - stating ignorance is not omitting it", () => {
    const result = buildDeldoImport(untyped({ commercialMode: "unknown" }));
    expect(result.commercialMode).toBe("unknown");
  });

  it("classification is not inferred from filename, directory or account", () => {
    // Same bytes, live classification, innocuous names in 'live' locations.
    // The only thing that decides is what the caller stated.
    for (const name of [
      "live/feed.csv",
      "/ftp/deldo/production/026933.csv",
      "026933LIVE.csv",
      "hourly-snapshot.csv",
    ]) {
      const result = buildDeldoImport(
        untyped({ classification: "test", sourceFilename: name })
      );
      expect(result.classification).toBe("test");
    }
  });

  it("still refuses the known sample file when claimed as live", () => {
    expect(() =>
      buildDeldoImport(untyped({ classification: "live", sourceFilename: "26933TEST.csv" }))
    ).toThrow(DeldoImportError);
  });
});

describe("Deldo persistence plan carries classification to the database write", () => {
  it("surfaces the three schema facts explicitly, not buried in the observation", () => {
    const result = buildDeldoImport(request({ classification: "test" }));
    const plan = planDeldoListingPersistence(result.listings[0]);
    expect(plan.dataClassification).toBe("test");
    expect(plan.commercialMode).toBe(result.commercialMode);
    expect(plan.observationSource).toBe("bulk_feed");
    // The eventual write reads these directly and derives nothing.
    expect(Object.keys(plan)).toEqual(
      expect.arrayContaining([
        "dataClassification",
        "commercialMode",
        "observationSource",
        "supplierListingKey",
        "supplierArticleId",
      ])
    );
  });

  it("carries a live classification through unchanged", () => {
    const result = buildDeldoImport(request({ classification: "live" }));
    expect(planDeldoListingPersistence(result.listings[0]).dataClassification).toBe("live");
  });

  it("REFUSES to plan a hand-assembled listing with no classification", () => {
    const result = buildDeldoImport(request());
    const listing = result.listings[0];
    const stripped = {
      row: listing.row,
      observation: { ...listing.observation, classification: undefined },
    } as unknown as typeof listing;
    expect(() => planDeldoListingPersistence(stripped)).toThrow(DataClassificationError);
  });

  it("REFUSES a hand-assembled listing with a bogus classification", () => {
    const result = buildDeldoImport(request());
    const listing = result.listings[0];
    const forged = {
      row: listing.row,
      observation: { ...listing.observation, classification: "LIVE" },
    } as unknown as typeof listing;
    expect(() => planDeldoListingPersistence(forged)).toThrow(DataClassificationError);
  });

  it("still keeps the exact listing identity, never collapsing on EAN", () => {
    const result = buildDeldoImport(request());
    const pair = result.listings.filter(
      (l) => l.row.supplierArticleId === "BR6727" || l.row.supplierArticleId === "BR672722"
    );
    const plans = pair.map(planDeldoListingPersistence);
    expect(new Set(plans.map((p) => p.supplierListingKey)).size).toBe(plans.length);
  });

  it("persistence is still closed, whatever the plan says", () => {
    const result = buildDeldoImport(request({ classification: "live" }));
    expect(() => persistDeldoImport(result)).toThrow(DeldoPersistenceUnavailableError);
  });
});

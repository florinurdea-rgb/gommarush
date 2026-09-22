// Deldo feed import: CSV → strict parser → normalized rows → observations →
// persistence boundary.
//
// The pipeline is complete up to, but not through, the database. The final
// write is deliberately unavailable: the schema has no way to record whether
// an observation is real or fictional (see docs/DATABASE_BASELINE.md §7), and
// persisting Deldo's sample feed without that column would put fictional
// prices into the same rows as commercial ones, indistinguishably. The
// boundary throws rather than silently doing nothing, so the gap cannot be
// mistaken for a successful import.
//
// Everything above the boundary is pure and fully tested, so when the
// migration lands only `persistDeldoImport` changes.

import { createHash } from "node:crypto";
import {
  readDeldoCsv,
  CsvStructureError,
  type MalformedLine,
} from "@/lib/suppliers/deldo/feed/csv-reader";
import {
  DELDO_FEED_COLUMNS,
  DELDO_FEED_DELIMITER,
  normalizeDeldoRow,
  type DeldoNormalizedRow,
} from "@/lib/suppliers/deldo/feed/parse";
import {
  DELDO_LANE_CODE,
  DELDO_TEST_FEED_FILENAME,
} from "@/lib/suppliers/deldo/capabilities";
import {
  assertDataClassification,
  assertFeedCommercialMode,
  type DataClassification,
  type FeedCommercialMode,
  type ObservationSource,
  type SupplierObservation,
} from "@/lib/suppliers/observation";

/**
 * Everything an import needs, with nothing defaulted.
 *
 * `classification` and `commercialMode` are REQUIRED and have no fallback.
 * A default for either would mean that forgetting to say what a file is
 * results in it being treated as something — and the safe something does not
 * exist here. This mirrors the database design: not null, no default.
 */
export interface DeldoImportRequest {
  readonly content: string;
  readonly sourceFilename: string;
  /** Real supplier data, or the supplier's fictional sample. Required. */
  readonly classification: DataClassification;
  /** Which pricing mode this feed represents. Required; 'unknown' is valid. */
  readonly commercialMode: FeedCommercialMode;
  /** When the supplier produced the file, not when we read it. */
  readonly observedAt: Date;
}

/** One listing ready to persist, with its observation alongside. */
export interface DeldoImportListing {
  readonly row: DeldoNormalizedRow;
  readonly observation: SupplierObservation;
}

export interface DeldoImportRejection {
  readonly sourceLine: number;
  readonly errors: readonly string[];
  /** The untouched source cells, kept so a rejection is auditable. */
  readonly raw: Readonly<Record<string, string>>;
}

export interface DeldoImportResult {
  readonly laneCode: string;
  readonly sourceFilename: string;
  readonly classification: DataClassification;
  readonly commercialMode: FeedCommercialMode;
  readonly observedAt: Date;
  /** SHA-256 of the file, for idempotency against `file_checksum`. */
  readonly fileChecksum: string;

  readonly listings: readonly DeldoImportListing[];
  readonly rejected: readonly DeldoImportRejection[];
  readonly malformed: readonly MalformedLine[];

  readonly counts: {
    readonly totalDataLines: number;
    readonly accepted: number;
    readonly clean: number;
    readonly review: number;
    readonly rejected: number;
    readonly malformed: number;
    readonly oldDotListings: number;
    readonly withoutEan: number;
  };
}

export class DeldoImportError extends Error {
  readonly kind: "test_file_misclassified" | "structure";
  constructor(kind: DeldoImportError["kind"], message: string) {
    super(message);
    this.name = "DeldoImportError";
    this.kind = kind;
  }
}

/**
 * Refuses to import the supplier's known sample file as live data.
 *
 * The supplier stated explicitly that 26933TEST.csv contains fictional stocks
 * and prices and must not be used for real orders. Everything else in this
 * module trusts the caller's `classification`; this is the one case where the
 * answer is already known, so a mistake is caught rather than trusted.
 *
 * Deliberately narrow — it is a backstop for one named file, not a heuristic.
 * A heuristic that guessed at "looks like test data" would eventually be wrong
 * in the expensive direction.
 */
function guardKnownTestFile(request: DeldoImportRequest): void {
  const filename = request.sourceFilename.trim().toLowerCase();
  const known = DELDO_TEST_FEED_FILENAME.toLowerCase();
  if (filename.endsWith(known) && request.classification !== "test") {
    throw new DeldoImportError(
      "test_file_misclassified",
      `Refusing to import '${request.sourceFilename}' as '${request.classification}': ` +
        `the supplier states this file contains fictional stocks and prices and must not be used for real orders`
    );
  }
}

/** SHA-256 of the exact bytes, so a re-upload of the same file is detectable. */
export function deldoFileChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Runs the import up to the persistence boundary.
 *
 * Throws CsvStructureError when the FILE is not the agreed contract — a wrong
 * delimiter, or a header that does not match exactly. Individual bad rows are
 * collected instead, so one malformed tyre cannot cost an hourly feed.
 */
export function buildDeldoImport(request: DeldoImportRequest): DeldoImportResult {
  // RUNTIME enforcement, before anything reads the file.
  //
  // The DeldoImportRequest type is erased at build time, so it stops nothing
  // once a request arrives over HTTP, from an upload form, from a scheduler
  // payload or from JSON on disk. These two calls are the point at which a
  // caller must actually have stated what the data is. They fail closed: no
  // default, no inference from filename, directory, FTP location, environment
  // or supplier account.
  const classification = assertDataClassification(
    (request as { classification?: unknown }).classification,
    `Deldo import of '${request.sourceFilename}'`
  );
  const commercialMode = assertFeedCommercialMode(
    (request as { commercialMode?: unknown }).commercialMode,
    `Deldo import of '${request.sourceFilename}'`
  );

  // Use the NARROWED values from here on, never the raw request fields, so a
  // future edit cannot reintroduce an unvalidated path.
  const validated: DeldoImportRequest = { ...request, classification, commercialMode };

  guardKnownTestFile(validated);

  const { rows, malformed, totalDataLines } = readDeldoCsv(validated.content, {
    delimiter: DELDO_FEED_DELIMITER,
    expectedHeader: DELDO_FEED_COLUMNS,
  });

  const listings: DeldoImportListing[] = [];
  const rejected: DeldoImportRejection[] = [];
  let clean = 0;
  let review = 0;
  let oldDotListings = 0;
  let withoutEan = 0;

  for (const row of rows) {
    const outcome = normalizeDeldoRow(
      row.sourceLine,
      row.cells as Record<string, string>
    );

    if (!outcome.normalized) {
      rejected.push({
        sourceLine: outcome.sourceRow,
        errors: outcome.validation.errors,
        raw: outcome.raw,
      });
      continue;
    }

    if (outcome.validation.result === "review") review += 1;
    else clean += 1;
    if (outcome.normalized.oldDot) oldDotListings += 1;
    if (outcome.normalized.ean === null) withoutEan += 1;

    listings.push({
      row: outcome.normalized,
      observation: {
        laneCode: DELDO_LANE_CODE,
        supplierListingKey: outcome.normalized.supplierListingKey,
        supplierArticleId: outcome.normalized.supplierArticleId,
        dotYear: outcome.normalized.deldo.dotYear,
        demo: outcome.normalized.deldo.demo,
        // Demo takes precedence when both source markers are present. This is
        // descriptive only: Demo remains commercially unusable until Deldo
        // confirms what the marker means.
        stockCondition: outcome.normalized.deldo.demo
          ? "demo"
          : outcome.normalized.deldo.dotYear !== null
            ? "older_dot"
            : "normal",
        // Carried from the request, never inferred from the content. A file's
        // rows cannot tell you whether the file is real.
        classification: validated.classification,
        source: "bulk_feed",
        observedAt: validated.observedAt,
        purchasePrice: outcome.normalized.purchasePrice,
        // Neither the feed nor the API supplies a currency, so none is
        // invented. See handoff decision D8.
        currency: null,
        stockExact: outcome.normalized.stockExact,
        stockRaw: outcome.normalized.stockRaw,
        commercialMode: validated.commercialMode,
      },
    });
  }

  return {
    laneCode: DELDO_LANE_CODE,
    sourceFilename: validated.sourceFilename,
    classification: validated.classification,
    commercialMode: validated.commercialMode,
    observedAt: validated.observedAt,
    fileChecksum: deldoFileChecksum(validated.content),
    listings,
    rejected,
    malformed,
    counts: {
      totalDataLines,
      accepted: listings.length,
      clean,
      review,
      rejected: rejected.length,
      malformed: malformed.length,
      oldDotListings,
      withoutEan,
    },
  };
}

/**
 * Persistence plan for one Deldo listing. This remains pure and does not touch
 * Supabase; persistDeldoImport stays closed until the post-baseline migration
 * is deliberately applied.
 *
 * The key is the safety property: database lookup/upsert MUST use the exact
 * supplier listing key, never EAN/product identity. Deldo legitimately carries
 * two listings for one EAN at different prices/condition.
 */
export interface DeldoListingPersistencePlan {
  readonly supplierListingKey: string;
  readonly supplierArticleId: string;
  /**
   * The three facts the eventual write must record, surfaced HERE rather than
   * left for the writer to dig out of `listing.observation`.
   *
   * These map one-to-one onto the columns in DELDO_REQUIRED_SCHEMA. The point
   * is that the database write receives them explicitly and never derives,
   * infers or defaults them at the last moment — which is exactly where a
   * fictional row would otherwise acquire a "live" classification.
   */
  readonly dataClassification: DataClassification;
  readonly commercialMode: FeedCommercialMode;
  readonly observationSource: ObservationSource;
  readonly listing: DeldoImportListing;
}

export function planDeldoListingPersistence(
  listing: DeldoImportListing
): DeldoListingPersistencePlan {
  if (listing.observation.supplierListingKey !== listing.row.supplierListingKey) {
    throw new Error("Deldo persistence refused: observation/listing key mismatch");
  }
  if (listing.observation.supplierArticleId !== listing.row.supplierArticleId) {
    throw new Error("Deldo persistence refused: observation/article id mismatch");
  }

  // Re-assert at the persistence boundary rather than trusting that the
  // observation was built by buildDeldoImport. A plan can be constructed from
  // a hand-assembled listing, and this is the last point before a database
  // write where refusing is still cheap.
  const dataClassification = assertDataClassification(
    (listing.observation as { classification?: unknown }).classification,
    `Deldo persistence plan for '${listing.row.supplierListingKey}'`
  );
  const commercialMode = assertFeedCommercialMode(
    (listing.observation as { commercialMode?: unknown }).commercialMode,
    `Deldo persistence plan for '${listing.row.supplierListingKey}'`
  );

  return {
    supplierListingKey: listing.row.supplierListingKey,
    supplierArticleId: listing.row.supplierArticleId,
    dataClassification,
    commercialMode,
    observationSource: listing.observation.source,
    listing,
  };
}

export class DeldoPersistenceUnavailableError extends Error {
  readonly missingSchema: readonly string[];
  constructor(missingSchema: readonly string[]) {
    super(
      "Deldo persistence is unavailable: the schema cannot record whether an " +
        "observation is real or fictional. Missing: " +
        missingSchema.join(", ") +
        ". See docs/DATABASE_BASELINE.md §7 — the migration is specified and " +
        "gated behind the schema reconciliation."
    );
    this.name = "DeldoPersistenceUnavailableError";
    this.missingSchema = missingSchema;
  }
}

/**
 * The columns the import needs and the database does not yet have.
 *
 * Named here rather than in a comment so the boundary error tells whoever hits
 * it exactly what is missing, and so the list is the single thing that changes
 * when the migration lands.
 */
export const DELDO_REQUIRED_SCHEMA: readonly string[] = [
  "catalogue_import_runs.data_classification",
  "supplier_listing_prices.data_classification",
  "supplier_listing_prices.commercial_mode",
  "supplier_listing_prices.observation_source",
];

/**
 * The persistence boundary. Deliberately unavailable.
 *
 * Throws rather than no-oping. A silent no-op would let a caller believe an
 * import succeeded, and the first symptom would be an empty catalogue that
 * nobody could explain.
 */
export function persistDeldoImport(_result: DeldoImportResult): never {
  throw new DeldoPersistenceUnavailableError(DELDO_REQUIRED_SCHEMA);
}

export { CsvStructureError };

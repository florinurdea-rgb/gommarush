import {
  archivedName,
  checksumOf,
  decideIngestion,
  FEED_DIRECTORIES,
  planCompletion,
  type CompletionOutcome,
  type DiscoveredFile,
  type FeedFileRecord,
  type FeedTransport,
} from "@/lib/suppliers/intersprint/feed/lifecycle";
import {
  CsvFeedError,
  readIntersprintCsv,
} from "@/lib/suppliers/intersprint/feed/csv-reader";
import type { DataClassification } from "@/lib/suppliers/observation";

// Orchestration: discover, fetch, decide, parse, hand on, file the result.
//
// Everything consequential is delegated. The lifecycle module decides, the CSV
// reader parses, the M8 adapter interprets commercially, and the existing
// catalogue importer commits. This file only sequences them and makes sure a
// file ends up in exactly one of `processed` or `failed`.
//
// It is transport-agnostic: `FeedTransport` is an interface, so the whole run
// is tested against an in-memory fake and the untested FTP client is not on
// the path of a single test.

export interface FeedRunOptions {
  readonly transport: FeedTransport;
  /**
   * Whether files found on this server are real or samples. NO DEFAULT — the
   * same reason buildIntersprintObservation has none. A run that assumed
   * "live" would publish a sample as today's price.
   */
  readonly classification: DataClassification;
  /** Looks up what we already know about a checksum. */
  readonly lookupRecord: (checksum: string) => Promise<FeedFileRecord | null>;
  /** Marks a file as being worked on, before any parsing happens. */
  readonly claimFile: (input: {
    checksum: string;
    fileName: string;
    startedAt: Date;
  }) => Promise<void>;
  /** Applies a parsed file. Returns what happened; must not throw for data errors. */
  readonly applyFile: (input: {
    checksum: string;
    fileName: string;
    rows: readonly { sourceRow: number; cells: Readonly<Record<string, string>> }[];
    classification: DataClassification;
    observedAt: Date;
  }) => Promise<CompletionOutcome>;
  /** Records the final state. */
  readonly recordCompletion: (input: {
    checksum: string;
    fileName: string;
    moveTo: "processed" | "failed";
    importRunId: string | null;
    error: string | null;
    finishedAt: Date;
  }) => Promise<void>;
  readonly now: () => Date;
  /**
   * Whether to move files on the server. Off by default: the FTP client has
   * never run against the real endpoint, and a bad move loses the supplier's
   * only copy. The database record is authoritative either way.
   */
  readonly moveFiles?: boolean;
}

export interface FeedFileResult {
  readonly fileName: string;
  readonly checksum: string | null;
  readonly status: "ingested" | "skipped" | "failed";
  readonly reason: string | null;
  readonly importRunId: string | null;
  readonly rowsParsed: number;
  readonly malformedLines: number;
}

export interface FeedRunResult {
  readonly discovered: number;
  readonly results: readonly FeedFileResult[];
}

/**
 * Processes everything currently sitting in `incoming`.
 *
 * Order of operations is the safety property:
 *
 *   1. claim the file BEFORE parsing, so a second runner cannot start on it
 *   2. parse, which is where malformed files fail
 *   3. apply
 *   4. record completion, then move
 *
 * The record is written before the move, so a crash between them leaves a
 * correct database and a stale file position rather than the reverse. A file
 * in the wrong directory is a tidying problem; a file marked processed that
 * never was is a double-charge waiting to happen.
 */
export async function runIntersprintFeedIngestion(
  options: FeedRunOptions
): Promise<FeedRunResult> {
  const { transport } = options;
  const results: FeedFileResult[] = [];

  const discovered: DiscoveredFile[] = await transport.list(FEED_DIRECTORIES.incoming);

  for (const file of discovered) {
    const startedAt = options.now();

    let bytes: Buffer | null = null;
    try {
      bytes = await transport.download(FEED_DIRECTORIES.incoming, file.name);
    } catch (error) {
      results.push({
        fileName: file.name,
        checksum: null,
        status: "failed",
        reason: `download_failed: ${(error as Error).message}`,
        importRunId: null,
        rowsParsed: 0,
        malformedLines: 0,
      });
      continue;
    }

    // Identity is the bytes, so the checksum comes first and the record
    // lookup is keyed on it rather than on a filename the supplier reuses.
    const checksum = checksumOf(bytes);
    const existing = await options.lookupRecord(checksum);
    const decision = decideIngestion({ file, bytes, existing, now: startedAt });

    if (decision.action === "skip") {
      results.push({
        fileName: file.name,
        checksum: decision.checksum,
        status: "skipped",
        reason: decision.reason,
        importRunId: null,
        rowsParsed: 0,
        malformedLines: 0,
      });
      continue;
    }

    // Claimed before a single row is read, so a concurrent runner sees the
    // lock rather than starting the same file.
    await options.claimFile({ checksum, fileName: file.name, startedAt });

    let outcome: CompletionOutcome;
    let rowsParsed = 0;
    let malformedLines = 0;

    try {
      const parsed = readIntersprintCsv(bytes.toString("utf8"));
      rowsParsed = parsed.rows.length;
      malformedLines = parsed.malformedLines.length;

      // A file that mostly failed to parse is not a file to import. Half a
      // price list applied as though complete is worse than none.
      if (malformedLines > 0 && malformedLines >= rowsParsed) {
        outcome = {
          outcome: "failed",
          error: `more malformed lines (${malformedLines}) than usable rows (${rowsParsed})`,
        };
      } else {
        outcome = await options.applyFile({
          checksum,
          fileName: file.name,
          rows: parsed.rows,
          classification: options.classification,
          observedAt: file.modifiedAt ?? startedAt,
        });
      }
    } catch (error) {
      outcome = {
        outcome: "failed",
        error:
          error instanceof CsvFeedError
            ? `csv_${error.kind}: ${error.detail}`
            : `import_failed: ${(error as Error).message}`,
      };
    }

    const plan = planCompletion(outcome);
    const finishedAt = options.now();

    await options.recordCompletion({
      checksum,
      fileName: file.name,
      moveTo: plan.moveTo,
      importRunId: plan.importRunId,
      error: plan.error,
      finishedAt,
    });

    if (options.moveFiles) {
      try {
        await transport.move(
          FEED_DIRECTORIES.incoming,
          file.name,
          FEED_DIRECTORIES[plan.moveTo],
          archivedName(file.name, checksum, finishedAt)
        );
      } catch {
        // The record already says what happened, so a failed move is an
        // operational annoyance rather than a correctness problem. It must not
        // turn a successful import into a reported failure.
      }
    }

    results.push({
      fileName: file.name,
      checksum,
      status: plan.moveTo === "processed" ? "ingested" : "failed",
      reason: plan.error,
      importRunId: plan.importRunId,
      rowsParsed,
      malformedLines,
    });
  }

  return { discovered: discovered.length, results };
}

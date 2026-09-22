import "server-only";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  analyzeCatalogueImport,
  commitCatalogueImport,
} from "@/lib/server/catalogue-import";
import { intersprintFeedAdapter } from "@/lib/catalogue/intersprint-feed-adapter";
import { WorkbookError } from "@/lib/catalogue/xlsx-reader";
import { CsvFeedError } from "@/lib/suppliers/intersprint/feed/csv-reader";
import { logError } from "@/lib/logger";

// Server side of the Inter-Sprint feed ingestion.
//
// The VM worker hands over bytes; everything that decides what those bytes
// MEAN happens here, in code that is already tested. That split is the whole
// architecture: the VM does file lifecycle and transport, Vercel does
// interpretation and persistence, and the Supabase service-role key never
// leaves Vercel.
//
// Nothing here is new persistence. It calls analyzeCatalogueImport and
// commitCatalogueImport — the same path the admin upload screen uses — so
// there is exactly one catalogue pipeline.

/**
 * Prefix marking the sub-feed on a run's notes.
 *
 * A convention on an existing column rather than a new one: adding a column
 * means a hosted migration, and the value is provenance rather than something
 * the importer branches on.
 */
export const FEED_CATEGORY_NOTE_PREFIX = "intersprint-feed:category=";

export class FeedIngestionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "FeedIngestionError";
    this.code = code;
    this.status = status;
  }
}

/**
 * The supplier the Inter-Sprint feed belongs to.
 *
 * Configuration, not a constant, because the production record is still named
 * 'asdas' pending the rename in supabase/pending-approval/0002. Reading it
 * from the environment means the rename does not require a deployment, and an
 * unset value disables ingestion rather than guessing at a supplier.
 */
export function intersprintSupplierId(env: NodeJS.ProcessEnv = process.env): string {
  const id = env.INTERSPRINT_SUPPLIER_ID?.trim();
  if (!id) {
    throw new FeedIngestionError(
      "SUPPLIER_NOT_CONFIGURED",
      "INTERSPRINT_SUPPLIER_ID is not set, so there is no supplier to attach this feed to",
      503
    );
  }
  return id;
}

/** Largest feed we will accept, uncompressed. Production PCR is ~3 MB. */
export const MAX_FEED_BYTES = 32 * 1024 * 1024;

export interface SubmitFeedInput {
  /** Raw request body. Gzip-compressed when `gzipped` is true. */
  readonly body: Buffer;
  readonly gzipped: boolean;
  /** The supplier's filename, for provenance. Never used to decide anything. */
  readonly fileName: string;
  /**
   * SHA-256 the worker computed over the UNCOMPRESSED file.
   *
   * Verified here against the bytes actually received. Without this check a
   * truncated upload would be analysed as though it were the whole feed, and
   * a partial price list applied as if complete is precisely the outcome this
   * pipeline exists to prevent.
   */
  readonly expectedChecksum: string;
  readonly submittedBy: string;
}

export interface SubmitFeedResult {
  readonly runId: string;
  readonly duplicateOfRunId: string | null;
  readonly category: "pcr" | "truck" | null;
  readonly sourceRows: number;
  readonly malformedRows: number;
  readonly paddingRows: number;
  readonly rejectedRows: number;
  readonly checksum: string;
  readonly finished: boolean;
  readonly applied: number;
}

function decompress(input: SubmitFeedInput): Buffer {
  if (!input.gzipped) return input.body;
  try {
    return gunzipSync(input.body);
  } catch (error) {
    throw new FeedIngestionError(
      "DECOMPRESSION_FAILED",
      `the body did not decompress as gzip: ${(error as Error).message}`
    );
  }
}

/**
 * Accepts a feed file, analyses it and starts applying it.
 *
 * Order of checks is the safety property:
 *
 *   1. size          — refuse anything absurd before spending memory on it
 *   2. integrity     — the bytes must hash to what the worker said they do
 *   3. shape         — the header must be a recognisable Inter-Sprint feed
 *   4. analyse       — stages rows, changes nothing in the catalogue
 *   5. commit        — applies in batches, resumable
 *
 * `importMode` is forced to 'partial'. A 'complete' run is the only thing that
 * may propose deactivating listings absent from the file, and whether an
 * Inter-Sprint delivery is an authoritative snapshot is UNRESOLVED (D14).
 * Until a supplier statement settles it, absence means nothing — so the mode
 * is not a caller's choice.
 */
export async function submitIntersprintFeed(
  input: SubmitFeedInput
): Promise<SubmitFeedResult> {
  if (input.body.length === 0) {
    throw new FeedIngestionError("EMPTY_BODY", "no bytes were submitted");
  }

  const bytes = decompress(input);

  if (bytes.length > MAX_FEED_BYTES) {
    throw new FeedIngestionError(
      "FEED_TOO_LARGE",
      `feed is ${bytes.length} bytes, over the ${MAX_FEED_BYTES} limit`,
      413
    );
  }

  const checksum = createHash("sha256").update(bytes).digest("hex");
  const expected = input.expectedChecksum.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new FeedIngestionError(
      "CHECKSUM_MALFORMED",
      "the declared checksum is not a SHA-256 hex digest"
    );
  }
  if (checksum !== expected) {
    // A mismatch means the bytes changed in flight — a truncated upload, a
    // file still being written, or a proxy rewriting the body. None of those
    // may be analysed as a price list.
    throw new FeedIngestionError(
      "CHECKSUM_MISMATCH",
      "the received bytes do not match the declared checksum; the upload was incomplete or altered"
    );
  }

  // Category from the header, never the filename: production ships
  // 'vrd-001-21185.csv' (truck) and 'vrd-001-21185-107.csv' (PCR), and the
  // first is a strict prefix of the second.
  let category: "pcr" | "truck" | null = null;
  try {
    const parsed = intersprintFeedAdapter.readDelimitedText(bytes.toString("utf8"));
    category = intersprintFeedAdapter.detectCategory(parsed.headers) as
      | "pcr"
      | "truck"
      | null;
  } catch (error) {
    if (error instanceof CsvFeedError) {
      throw new FeedIngestionError("FEED_UNREADABLE", `${error.kind}: ${error.detail}`);
    }
    throw error;
  }

  const supplierId = intersprintSupplierId();

  try {
    const analysis = await analyzeCatalogueImport({
      bytes,
      fileName: input.fileName,
      adapterId: intersprintFeedAdapter.id,
      supplierId,
      // See the doc comment: never 'complete' while D14 is open.
      importMode: "partial",
      uploadedBy: input.submittedBy,
      // Determined from the header, not the filename. Recorded so the admin
      // status view can report the two feeds separately.
      notes: category ? `${FEED_CATEGORY_NOTE_PREFIX}${category}` : null,
    });

    if (analysis.duplicateOfRunId) {
      return {
        runId: analysis.runId,
        duplicateOfRunId: analysis.duplicateOfRunId,
        category,
        sourceRows: 0,
        malformedRows: 0,
        paddingRows: 0,
        rejectedRows: 0,
        checksum,
        finished: true,
        applied: 0,
      };
    }

    const commit = await commitCatalogueImport(analysis.runId, input.submittedBy, {
      maxBatches: DEFAULT_COMMIT_BATCHES,
    });

    return {
      runId: analysis.runId,
      duplicateOfRunId: null,
      category,
      sourceRows: analysis.summary.sourceRows,
      malformedRows: analysis.summary.malformedRows,
      paddingRows: analysis.summary.paddingRows,
      rejectedRows: analysis.summary.rejected,
      checksum,
      finished: commit.finished,
      applied: commit.applied,
    };
  } catch (error) {
    if (error instanceof WorkbookError) {
      throw new FeedIngestionError(error.code, error.message);
    }
    logError("intersprint_feed_ingestion_failed", error, { fileName: input.fileName });
    throw error;
  }
}

/**
 * How many commit batches one request attempts.
 *
 * Bounded so a request finishes inside the serverless limit. The worker calls
 * `continueIntersprintFeedCommit` until `finished`, which is the same
 * resume-until-done shape the admin upload screen uses — and the reason an
 * 11,000-row feed never leaves a half-applied run looking successful.
 */
const DEFAULT_COMMIT_BATCHES = 8;

export async function continueIntersprintFeedCommit(
  runId: string,
  submittedBy: string
): Promise<{ finished: boolean; applied: number }> {
  const result = await commitCatalogueImport(runId, submittedBy, {
    maxBatches: DEFAULT_COMMIT_BATCHES,
  });
  return { finished: result.finished, applied: result.applied };
}

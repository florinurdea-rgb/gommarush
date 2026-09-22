import { createHash } from "node:crypto";

// Feed file lifecycle: incoming -> processing -> processed | failed.
//
// This module is PURE DECISION LOGIC. It never touches a socket, a filesystem
// or a database; it takes the state of the world and returns what should
// happen next. That separation is what makes the dangerous part testable — the
// dangerous part being that a mistake here either loses a supplier file or
// applies the same prices twice.
//
// The four directories already exist on the FTP host: infra/ftp provisions
// `incoming` writable by the supplier, and `processing`, `processed`, `failed`
// owned by root and read-only to them, so Inter-Sprint cannot alter the record
// of what we did with their files.
//
// Two invariants drive everything below:
//
//   1. A FILE IS NEVER COMMERCIALLY APPLIED TWICE. Identity is the SHA-256 of
//      the bytes, not the filename — Inter-Sprint deliver three times a day
//      and a repeated name with new contents is a new file, while a re-upload
//      of identical bytes is not.
//   2. A PARTIAL IMPORT IS NEVER MARKED SUCCESSFUL. There is no state that
//      means "mostly done"; an interrupted run stays in `processing` and is
//      recoverable, and only a complete commit reaches `processed`.

/** Where a file sits in its lifecycle. */
export type FeedFileState = "incoming" | "processing" | "processed" | "failed";

export const FEED_DIRECTORIES: Readonly<Record<FeedFileState, string>> = {
  incoming: "incoming",
  processing: "processing",
  processed: "processed",
  failed: "failed",
};

/** SHA-256 of the file's bytes. The only identity that means anything. */
export function checksumOf(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface DiscoveredFile {
  readonly name: string;
  readonly sizeBytes: number;
  /** Last modification time reported by the server, when it gives one. */
  readonly modifiedAt: Date | null;
}

/** A file we have already seen, keyed by checksum. */
export interface FeedFileRecord {
  readonly checksum: string;
  readonly state: FeedFileState;
  readonly fileName: string;
  /** The import run that applied it, once one committed. */
  readonly importRunId: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
}

export type SkipReason =
  /** Identical bytes already committed. Applying again would double-count. */
  | "already_processed"
  /** Another run holds it. Two importers on one file is how a feed is applied twice. */
  | "in_progress"
  /** Zero bytes, or still being written by the supplier. */
  | "not_ready"
  /** Already failed with identical bytes; re-running would fail identically. */
  | "already_failed_identical";

export type IngestionDecision =
  | { readonly action: "ingest"; readonly checksum: string }
  | { readonly action: "skip"; readonly reason: SkipReason; readonly checksum: string | null };

/**
 * How long a `processing` record may sit before it is treated as abandoned.
 *
 * A GOMMARUSH OPERATIONAL POLICY, not a supplier fact. A run that dies mid-way
 * leaves its record in `processing`, and without a timeout that file would be
 * locked out permanently. Two hours is comfortably longer than any real import
 * of a 9,559-row file and comfortably shorter than the gap between deliveries.
 */
export const ABANDONED_PROCESSING_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * Whether a discovered file looks finished rather than mid-upload.
 *
 * Plain FTP gives no atomic rename and no "upload complete" signal, so a file
 * can be listed while the supplier is still writing it. Size zero is the
 * clearest tell. A stability check across two listings is stronger and belongs
 * to the caller, which is the only party that can wait.
 */
export function looksReady(file: DiscoveredFile): boolean {
  return file.sizeBytes > 0;
}

export interface DecideInput {
  readonly file: DiscoveredFile;
  /** The file's bytes, once downloaded. Null when not yet fetched. */
  readonly bytes: Buffer | Uint8Array | null;
  /** What we already know about this checksum, if anything. */
  readonly existing: FeedFileRecord | null;
  readonly now: Date;
}

/**
 * Decides whether a discovered file should be ingested.
 *
 * Ordering matters and is deliberate: readiness is checked before anything
 * else because a half-written file has a meaningless checksum, and an
 * abandoned `processing` record is reclaimed rather than treated as a live
 * lock.
 */
export function decideIngestion(input: DecideInput): IngestionDecision {
  if (!looksReady(input.file)) {
    return { action: "skip", reason: "not_ready", checksum: null };
  }
  if (!input.bytes) {
    // Not downloaded yet, so no checksum exists. The caller fetches, then asks
    // again; nothing is committed on the strength of a filename alone.
    return { action: "skip", reason: "not_ready", checksum: null };
  }

  const checksum = checksumOf(input.bytes);
  const existing = input.existing;

  if (!existing) return { action: "ingest", checksum };

  switch (existing.state) {
    case "processed":
      return { action: "skip", reason: "already_processed", checksum };

    case "processing": {
      const ageMs = input.now.getTime() - existing.startedAt.getTime();
      // Abandoned by a run that died. Reclaiming is safe precisely because
      // nothing was committed: `processed` is only ever reached on success.
      if (ageMs > ABANDONED_PROCESSING_AFTER_MS) {
        return { action: "ingest", checksum };
      }
      return { action: "skip", reason: "in_progress", checksum };
    }

    case "failed":
      // Identical bytes failed before and would fail the same way. A retry is
      // a deliberate operator act, not an automatic one.
      return { action: "skip", reason: "already_failed_identical", checksum };

    case "incoming":
      return { action: "ingest", checksum };
  }
}

export type CompletionOutcome =
  | { readonly outcome: "committed"; readonly importRunId: string; readonly rowsApplied: number }
  | { readonly outcome: "failed"; readonly error: string };

export interface CompletionPlan {
  readonly moveTo: Extract<FeedFileState, "processed" | "failed">;
  readonly importRunId: string | null;
  readonly error: string | null;
}

/**
 * Where a file goes once its import finishes.
 *
 * A commit that applied zero rows is a FAILURE, not a quiet success. An
 * Inter-Sprint delivery always carries rows; a run that applied none either
 * read the wrong file or broke, and filing it under `processed` would hide
 * that and suppress the retry.
 */
export function planCompletion(result: CompletionOutcome): CompletionPlan {
  if (result.outcome === "failed") {
    return { moveTo: "failed", importRunId: null, error: result.error };
  }
  if (result.rowsApplied <= 0) {
    return {
      moveTo: "failed",
      importRunId: result.importRunId,
      error: "import committed zero rows; a supplier feed is never legitimately empty",
    };
  }
  return { moveTo: "processed", importRunId: result.importRunId, error: null };
}

/**
 * A destination name that cannot collide.
 *
 * Inter-Sprint deliver three times a day under what is very likely the same
 * filename. Moving `vrd-pcr.csv` into `processed/` repeatedly would overwrite
 * the archive and destroy the record this lifecycle exists to keep, so the
 * timestamp and a checksum prefix are folded in.
 */
export function archivedName(fileName: string, checksum: string, at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  const short = checksum.slice(0, 12);
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  return `${base}.${stamp}.${short}${extension}`;
}

/**
 * The transport a lifecycle run needs.
 *
 * An interface rather than a concrete FTP client so the whole lifecycle is
 * testable without a server — and so a future SFTP or FTPS endpoint, which is
 * the standing recommendation for this plain-FTP drop point, replaces one
 * implementation and nothing else.
 */
export interface FeedTransport {
  /** Files currently in a directory. */
  list(directory: string): Promise<DiscoveredFile[]>;
  /** The bytes of a file. */
  download(directory: string, fileName: string): Promise<Buffer>;
  /** Moves a file between lifecycle directories. */
  move(
    fromDirectory: string,
    fileName: string,
    toDirectory: string,
    toFileName: string
  ): Promise<void>;
}

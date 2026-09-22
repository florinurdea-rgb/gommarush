import { describe, expect, it } from "vitest";
import {
  ABANDONED_PROCESSING_AFTER_MS,
  archivedName,
  checksumOf,
  decideIngestion,
  FEED_DIRECTORIES,
  looksReady,
  planCompletion,
  type DiscoveredFile,
  type FeedFileRecord,
} from "@/lib/suppliers/intersprint/feed/lifecycle";

/**
 * The file lifecycle, tested entirely without a server.
 *
 * Deliberately separate from the parser and the pricing tests. These cover the
 * two ways an ingestion pipeline loses money: applying the same supplier
 * prices twice, and recording a half-finished import as done.
 */

const NOW = new Date("2026-09-22T12:00:00Z");
const BYTES = Buffer.from("sysnr;nett-price\n34197;99.2\n");
const OTHER_BYTES = Buffer.from("sysnr;nett-price\n34197;104.75\n");

const file = (overrides: Partial<DiscoveredFile> = {}): DiscoveredFile => ({
  name: "vrd-pcr.csv",
  sizeBytes: BYTES.length,
  modifiedAt: new Date("2026-09-22T11:00:00Z"),
  ...overrides,
});

const record = (overrides: Partial<FeedFileRecord> = {}): FeedFileRecord => ({
  checksum: checksumOf(BYTES),
  state: "processed",
  fileName: "vrd-pcr.csv",
  importRunId: "run-1",
  startedAt: new Date("2026-09-22T06:00:00Z"),
  finishedAt: new Date("2026-09-22T06:05:00Z"),
  ...overrides,
});

describe("file identity is the bytes, not the name", () => {
  it("gives identical bytes the same checksum", () => {
    expect(checksumOf(BYTES)).toBe(checksumOf(Buffer.from(BYTES)));
  });

  /**
   * Inter-Sprint deliver three times a day, very likely under one filename.
   * Keying on the name would make the second delivery look like a duplicate.
   */
  it("gives a same-named file with new contents a different checksum", () => {
    expect(checksumOf(OTHER_BYTES)).not.toBe(checksumOf(BYTES));
  });
});

describe("duplicate handling", () => {
  it("ingests a file it has never seen", () => {
    const decision = decideIngestion({ file: file(), bytes: BYTES, existing: null, now: NOW });
    expect(decision).toEqual({ action: "ingest", checksum: checksumOf(BYTES) });
  });

  /** The expensive mistake: applying one delivery's prices twice. */
  it("refuses to re-apply bytes that already committed", () => {
    const decision = decideIngestion({
      file: file(),
      bytes: BYTES,
      existing: record({ state: "processed" }),
      now: NOW,
    });
    expect(decision).toEqual({
      action: "skip",
      reason: "already_processed",
      checksum: checksumOf(BYTES),
    });
  });

  it("ingests the next delivery even under the same filename", () => {
    const decision = decideIngestion({
      file: file(),
      bytes: OTHER_BYTES,
      existing: null,
      now: NOW,
    });
    expect(decision.action).toBe("ingest");
  });

  it("does not re-run a file that already failed with identical bytes", () => {
    const decision = decideIngestion({
      file: file(),
      bytes: BYTES,
      existing: record({ state: "failed", importRunId: null }),
      now: NOW,
    });
    expect(decision).toEqual({
      action: "skip",
      reason: "already_failed_identical",
      checksum: checksumOf(BYTES),
    });
  });
});

describe("concurrency and interrupted runs", () => {
  it("leaves a file alone while another run holds it", () => {
    const decision = decideIngestion({
      file: file(),
      bytes: BYTES,
      existing: record({
        state: "processing",
        startedAt: new Date(NOW.getTime() - 60_000),
        finishedAt: null,
      }),
      now: NOW,
    });
    expect(decision.action).toBe("skip");
    expect(decision).toMatchObject({ reason: "in_progress" });
  });

  /**
   * A run that died leaves its record in `processing`. Without reclamation the
   * file would be locked out for ever — and reclaiming is safe precisely
   * because `processed` is only reached on a complete commit.
   */
  it("reclaims a processing record that was abandoned", () => {
    const decision = decideIngestion({
      file: file(),
      bytes: BYTES,
      existing: record({
        state: "processing",
        startedAt: new Date(NOW.getTime() - ABANDONED_PROCESSING_AFTER_MS - 1),
        finishedAt: null,
      }),
      now: NOW,
    });
    expect(decision.action).toBe("ingest");
  });

  it("holds the lock right up to the timeout", () => {
    const decision = decideIngestion({
      file: file(),
      bytes: BYTES,
      existing: record({
        state: "processing",
        startedAt: new Date(NOW.getTime() - ABANDONED_PROCESSING_AFTER_MS + 1000),
        finishedAt: null,
      }),
      now: NOW,
    });
    expect(decision.action).toBe("skip");
  });
});

describe("half-written uploads", () => {
  /** Plain FTP has no atomic rename, so a file can be listed mid-upload. */
  it("skips a zero-byte file", () => {
    expect(looksReady(file({ sizeBytes: 0 }))).toBe(false);
    const decision = decideIngestion({
      file: file({ sizeBytes: 0 }),
      bytes: null,
      existing: null,
      now: NOW,
    });
    expect(decision).toEqual({ action: "skip", reason: "not_ready", checksum: null });
  });

  it("commits nothing on the strength of a filename alone", () => {
    const decision = decideIngestion({ file: file(), bytes: null, existing: null, now: NOW });
    expect(decision.action).toBe("skip");
    expect(decision.checksum).toBeNull();
  });
});

describe("completion is never partial", () => {
  it("files a committed import under processed", () => {
    expect(
      planCompletion({ outcome: "committed", importRunId: "run-9", rowsApplied: 9559 })
    ).toEqual({ moveTo: "processed", importRunId: "run-9", error: null });
  });

  it("files a failure under failed", () => {
    expect(planCompletion({ outcome: "failed", error: "parse error" })).toEqual({
      moveTo: "failed",
      importRunId: null,
      error: "parse error",
    });
  });

  /**
   * A commit that applied nothing is a failure. An Inter-Sprint delivery
   * always carries rows, so zero means we read the wrong file or broke —
   * and filing it under `processed` would hide that and block the retry.
   */
  it("treats a zero-row commit as a failure, not a quiet success", () => {
    const plan = planCompletion({ outcome: "committed", importRunId: "run-9", rowsApplied: 0 });
    expect(plan.moveTo).toBe("failed");
    expect(plan.error).toContain("zero rows");
  });
});

describe("the archive keeps every delivery", () => {
  /**
   * Three deliveries a day under one name would overwrite each other in
   * `processed/`, destroying the record the lifecycle exists to keep.
   */
  it("makes each archived name unique", () => {
    const a = archivedName("vrd-pcr.csv", checksumOf(BYTES), NOW);
    const b = archivedName("vrd-pcr.csv", checksumOf(OTHER_BYTES), NOW);

    expect(a).not.toBe(b);
    expect(a.startsWith("vrd-pcr.")).toBe(true);
    expect(a.endsWith(".csv")).toBe(true);
    expect(a).not.toContain(":");
  });

  it("handles a name with no extension", () => {
    expect(archivedName("feed", "abcdef123456", NOW)).toContain("feed.");
  });
});

describe("the directory contract matches the provisioned server", () => {
  it("names the four directories infra/ftp creates", () => {
    expect(FEED_DIRECTORIES).toEqual({
      incoming: "incoming",
      processing: "processing",
      processed: "processed",
      failed: "failed",
    });
  });
});

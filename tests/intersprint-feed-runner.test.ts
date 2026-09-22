import { describe, expect, it, vi } from "vitest";
import { runIntersprintFeedIngestion } from "@/lib/suppliers/intersprint/feed/runner";
import {
  checksumOf,
  type DiscoveredFile,
  type FeedFileRecord,
  type FeedTransport,
} from "@/lib/suppliers/intersprint/feed/lifecycle";

/**
 * The ingestion run, end to end, against an in-memory transport.
 *
 * No FTP client is on this path by design: the transport is an interface, so
 * every ordering and failure property below is proven without a server — which
 * matters, because the real server is unreachable from here.
 */

const NOW = new Date("2026-09-22T12:00:00Z");

const HEADER = [
  "sysnr", "itemcode", "description", "Type", "brand", "brand description",
  "group", "group description", "E-mark", "European", "width tyre",
  "aspect ratio", "diameter", "LI/SI", "nett-price", "gross", "available",
  "eancode", "ip-code", "photolink", "", "", "", "", "weight",
  "Fuel effeciency", "Wet grip", "Rollnoise", "Noiselevel", "Snowgrip",
  "Icegrip", "EPREL-id", "EPREL-url", "wcat",
].join(";");

const ROW = [
  "34197", "205 55VR 16TWINTRACXL", "205/55 VR16 TL 94V  VR WINTRAC XL",
  "WINTRACXL", "VR", "VREDESTEIN", "13", "LUXE BANDEN M&S", "J", "J",
  "205", "55", "16", "94V", "99.2", "143", "6", "8714692361425",
  "AP20555016VWTRA02", "", "", "", "", "", "8.238", "C", "B", "70", "B",
  "J", "N", "615687", "https://eprel.ec.europa.eu/qr/615687", "1",
].join(";");

const GOOD_CSV = `${HEADER}\n${ROW}\n`;

class FakeTransport implements FeedTransport {
  readonly moves: { from: string; name: string; to: string; toName: string }[] = [];
  private readonly files: Map<string, Buffer>;
  downloadError: Error | null = null;
  moveError: Error | null = null;

  constructor(files: Record<string, string | Buffer>) {
    this.files = new Map(
      Object.entries(files).map(([name, body]) => [
        name,
        typeof body === "string" ? Buffer.from(body) : body,
      ])
    );
  }

  async list(): Promise<DiscoveredFile[]> {
    return [...this.files.entries()].map(([name, body]) => ({
      name,
      sizeBytes: body.length,
      modifiedAt: new Date("2026-09-22T11:00:00Z"),
    }));
  }

  async download(_directory: string, fileName: string): Promise<Buffer> {
    if (this.downloadError) throw this.downloadError;
    const body = this.files.get(fileName);
    if (!body) throw new Error(`no such file ${fileName}`);
    return body;
  }

  async move(from: string, name: string, to: string, toName: string): Promise<void> {
    if (this.moveError) throw this.moveError;
    this.moves.push({ from, name, to, toName });
  }
}

function harness(
  files: Record<string, string | Buffer>,
  overrides: Partial<Parameters<typeof runIntersprintFeedIngestion>[0]> = {},
  records: Map<string, FeedFileRecord> = new Map()
) {
  const transport = new FakeTransport(files);
  const claimFile = vi.fn(async () => {});
  const recordCompletion = vi.fn(async () => {});
  const applyFile = vi.fn(async () => ({
    outcome: "committed" as const,
    importRunId: "run-1",
    rowsApplied: 1,
  }));

  const options = {
    transport,
    classification: "live" as const,
    lookupRecord: async (checksum: string) => records.get(checksum) ?? null,
    claimFile,
    applyFile,
    recordCompletion,
    now: () => NOW,
    ...overrides,
  };

  return { transport, claimFile, recordCompletion, applyFile, options, records };
}

describe("a clean run", () => {
  it("parses, applies and records a good file", async () => {
    const h = harness({ "vrd-pcr.csv": GOOD_CSV });
    const result = await runIntersprintFeedIngestion(h.options);

    expect(result.discovered).toBe(1);
    expect(result.results[0]).toMatchObject({
      fileName: "vrd-pcr.csv",
      status: "ingested",
      importRunId: "run-1",
      rowsParsed: 1,
    });
    expect(h.applyFile).toHaveBeenCalledOnce();
    expect(h.recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ moveTo: "processed", error: null })
    );
  });

  /** A second runner must see the lock, so the claim precedes any parsing. */
  it("claims the file before parsing it", async () => {
    const order: string[] = [];
    const h = harness(
      { "vrd-pcr.csv": GOOD_CSV },
      {
        claimFile: async () => {
          order.push("claim");
        },
        applyFile: async () => {
          order.push("apply");
          return { outcome: "committed" as const, importRunId: "run-1", rowsApplied: 1 };
        },
      }
    );

    await runIntersprintFeedIngestion(h.options);
    expect(order).toEqual(["claim", "apply"]);
  });

  it("passes the classification through rather than assuming live", async () => {
    const h = harness({ "vrd-pcr.csv": GOOD_CSV }, { classification: "test" });
    await runIntersprintFeedIngestion(h.options);

    expect(h.applyFile).toHaveBeenCalledWith(
      expect.objectContaining({ classification: "test" })
    );
  });

  it("uses the server's modification time as the observation time", async () => {
    const h = harness({ "vrd-pcr.csv": GOOD_CSV });
    await runIntersprintFeedIngestion(h.options);

    expect(h.applyFile).toHaveBeenCalledWith(
      expect.objectContaining({ observedAt: new Date("2026-09-22T11:00:00Z") })
    );
  });
});

describe("duplicate deliveries", () => {
  it("skips bytes that already committed", async () => {
    const records = new Map<string, FeedFileRecord>([
      [
        checksumOf(Buffer.from(GOOD_CSV)),
        {
          checksum: checksumOf(Buffer.from(GOOD_CSV)),
          state: "processed",
          fileName: "vrd-pcr.csv",
          importRunId: "run-0",
          startedAt: new Date("2026-09-22T06:00:00Z"),
          finishedAt: new Date("2026-09-22T06:05:00Z"),
        },
      ],
    ]);

    const h = harness({ "vrd-pcr.csv": GOOD_CSV }, {}, records);
    const result = await runIntersprintFeedIngestion(h.options);

    expect(result.results[0]).toMatchObject({ status: "skipped", reason: "already_processed" });
    expect(h.applyFile).not.toHaveBeenCalled();
    expect(h.claimFile).not.toHaveBeenCalled();
  });

  /** Three deliveries a day under one name: new contents must still import. */
  it("ingests the same filename when the contents changed", async () => {
    const records = new Map<string, FeedFileRecord>([
      [
        checksumOf(Buffer.from(GOOD_CSV)),
        {
          checksum: checksumOf(Buffer.from(GOOD_CSV)),
          state: "processed",
          fileName: "vrd-pcr.csv",
          importRunId: "run-0",
          startedAt: NOW,
          finishedAt: NOW,
        },
      ],
    ]);

    const changed = GOOD_CSV.replace("99.2", "104.75");
    const h = harness({ "vrd-pcr.csv": changed }, {}, records);
    const result = await runIntersprintFeedIngestion(h.options);

    expect(result.results[0].status).toBe("ingested");
    expect(h.applyFile).toHaveBeenCalledOnce();
  });
});

describe("malformed and broken files", () => {
  it("fails a file whose header is not the Inter-Sprint contract", async () => {
    const h = harness({ "wrong.csv": "a,b,c\n1,2,3\n" });
    const result = await runIntersprintFeedIngestion(h.options);

    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].reason).toContain("csv_no_delimiter_matched");
    expect(h.applyFile).not.toHaveBeenCalled();
    expect(h.recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ moveTo: "failed" })
    );
  });

  it("fails an empty file", async () => {
    const h = harness({ "empty.csv": Buffer.from("x") });
    // One byte: ready, but not parseable.
    const result = await runIntersprintFeedIngestion(h.options);
    expect(result.results[0].status).toBe("failed");
  });

  it("skips a zero-byte upload still in flight", async () => {
    const h = harness({ "partial.csv": Buffer.alloc(0) });
    const result = await runIntersprintFeedIngestion(h.options);

    expect(result.results[0].status).toBe("skipped");
    expect(result.results[0].reason).toBe("not_ready");
    expect(h.applyFile).not.toHaveBeenCalled();
  });

  /** Half a price list applied as though complete is worse than none. */
  it("refuses a file with more malformed lines than usable rows", async () => {
    const broken = `${HEADER}\n${ROW}\nshort;line\nanother;short;line\n`;
    const h = harness({ "broken.csv": broken });
    const result = await runIntersprintFeedIngestion(h.options);

    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].reason).toContain("malformed");
    expect(h.applyFile).not.toHaveBeenCalled();
  });

  it("records a download failure without claiming the file", async () => {
    const h = harness({ "vrd-pcr.csv": GOOD_CSV });
    h.transport.downloadError = new Error("connection reset");

    const result = await runIntersprintFeedIngestion(h.options);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].reason).toContain("download_failed");
    expect(h.claimFile).not.toHaveBeenCalled();
  });

  /**
   * An import that applied nothing is a failure. Filing it under processed
   * would hide the breakage and block the retry.
   */
  it("fails a run that committed zero rows", async () => {
    const h = harness(
      { "vrd-pcr.csv": GOOD_CSV },
      {
        applyFile: async () => ({
          outcome: "committed" as const,
          importRunId: "run-1",
          rowsApplied: 0,
        }),
      }
    );

    const result = await runIntersprintFeedIngestion(h.options);
    expect(result.results[0].status).toBe("failed");
    expect(h.recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ moveTo: "failed" })
    );
  });

  it("fails rather than throws when applying blows up", async () => {
    const h = harness(
      { "vrd-pcr.csv": GOOD_CSV },
      {
        applyFile: async () => {
          throw new Error("database unavailable");
        },
      }
    );

    const result = await runIntersprintFeedIngestion(h.options);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].reason).toContain("database unavailable");
  });
});

describe("moving files on the server", () => {
  it("does not move anything unless explicitly enabled", async () => {
    const h = harness({ "vrd-pcr.csv": GOOD_CSV });
    await runIntersprintFeedIngestion(h.options);
    expect(h.transport.moves).toHaveLength(0);
  });

  it("archives under a unique name when enabled", async () => {
    const h = harness({ "vrd-pcr.csv": GOOD_CSV }, { moveFiles: true });
    await runIntersprintFeedIngestion(h.options);

    expect(h.transport.moves).toHaveLength(1);
    expect(h.transport.moves[0]).toMatchObject({ from: "incoming", to: "processed" });
    expect(h.transport.moves[0].toName).not.toBe("vrd-pcr.csv");
  });

  it("sends a failed file to failed/", async () => {
    const h = harness({ "wrong.csv": "a,b,c\n1,2,3\n" }, { moveFiles: true });
    await runIntersprintFeedIngestion(h.options);
    expect(h.transport.moves[0]).toMatchObject({ to: "failed" });
  });

  /**
   * The record is written before the move, so a move that fails leaves a
   * correct database and a misplaced file — never a successful import
   * reported as a failure.
   */
  it("keeps a successful import successful when the move fails", async () => {
    const h = harness({ "vrd-pcr.csv": GOOD_CSV }, { moveFiles: true });
    h.transport.moveError = new Error("550 permission denied");

    const result = await runIntersprintFeedIngestion(h.options);
    expect(result.results[0].status).toBe("ingested");
    expect(h.recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ moveTo: "processed" })
    );
  });
});

describe("several files in one run", () => {
  it("processes each independently and does not let one failure stop the rest", async () => {
    const h = harness({ "good.csv": GOOD_CSV, "bad.csv": "a,b\n1,2\n" });
    const result = await runIntersprintFeedIngestion(h.options);

    expect(result.discovered).toBe(2);
    const statuses = result.results.map((r) => r.status).sort();
    expect(statuses).toEqual(["failed", "ingested"]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

/**
 * The server side of feed ingestion.
 *
 * Mostly about what it REFUSES. A price list that arrives truncated, or gets
 * applied twice, or gets treated as an authoritative snapshot while snapshot
 * semantics are unresolved, are all failures that look like success from the
 * outside.
 */

const analyzeCatalogueImport = vi.fn();
const commitCatalogueImport = vi.fn();

vi.mock("@/lib/server/catalogue-import", () => ({
  analyzeCatalogueImport,
  commitCatalogueImport,
}));

const HEADER =
  "sysnr;itemcode;description;Type;brand;brand description;group;group description;" +
  "E-mark;European;width tyre;aspect ratio;diameter;LI/SI;nett-price;gross;available;" +
  "eancode;ip-code;photolink;weight;Fuel efficiency;Wet grip;Rollnoise;Noiselevel;" +
  "Snowgrip;Icegrip;EPREL-id;EPREL-url;wcat";

const ROW =
  "34197;205 55VR 16TWINTRACXL;205/55 VR16 TL 94V  VR WINTRAC XL;WINTRACXL;VR;VREDESTEIN;" +
  "13;LUXE BANDEN M&S;J;J;205;55;16;94V;99.2;143;6;8714692361425;AP20555016VWTRA02;" +
  "https://x;8.238;C;B;70;B;J;N;615687;https://y;1";

const CSV = `${HEADER}\n${ROW}\n`;
const CSV_BYTES = Buffer.from(CSV);
const CHECKSUM = createHash("sha256").update(CSV_BYTES).digest("hex");

function input(overrides: Record<string, unknown> = {}) {
  return {
    body: CSV_BYTES,
    gzipped: false,
    fileName: "vrd-001-21185-107.csv",
    expectedChecksum: CHECKSUM,
    submittedBy: "intersprint-feed-worker",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.INTERSPRINT_SUPPLIER_ID = "4ce0b557-9575-4784-aa80-99e78af4da2f";
  analyzeCatalogueImport.mockResolvedValue({
    runId: "run-1",
    duplicateOfRunId: null,
    summary: { sourceRows: 1, rejected: 0, malformedRows: 0, paddingRows: 0 },
    errors: [],
  });
  commitCatalogueImport.mockResolvedValue({ finished: true, applied: 1 });
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.INTERSPRINT_SUPPLIER_ID;
});

describe("integrity of the uploaded bytes", () => {
  it("accepts a feed whose checksum matches", async () => {
    const { submitIntersprintFeed } = await import("@/lib/server/feed-ingestion");
    const result = await submitIntersprintFeed(input());

    expect(result.checksum).toBe(CHECKSUM);
    expect(result.category).toBe("pcr");
    expect(analyzeCatalogueImport).toHaveBeenCalledOnce();
  });

  /**
   * The failure this exists for: a truncated upload still hashes to something,
   * and a half price list analysed as though complete is exactly the outcome
   * the whole pipeline is built to prevent.
   */
  it("refuses bytes that do not match the declared checksum", async () => {
    const { submitIntersprintFeed, FeedIngestionError } = await import(
      "@/lib/server/feed-ingestion"
    );
    const truncated = Buffer.from(CSV.slice(0, CSV.length - 20));

    await expect(submitIntersprintFeed(input({ body: truncated }))).rejects.toThrow(
      FeedIngestionError
    );
    expect(analyzeCatalogueImport).not.toHaveBeenCalled();
  });

  it("refuses a checksum that is not a SHA-256 digest", async () => {
    const { submitIntersprintFeed } = await import("@/lib/server/feed-ingestion");
    await expect(
      submitIntersprintFeed(input({ expectedChecksum: "not-a-hash" }))
    ).rejects.toMatchObject({ code: "CHECKSUM_MALFORMED" });
  });

  it("refuses an empty body", async () => {
    const { submitIntersprintFeed } = await import("@/lib/server/feed-ingestion");
    await expect(
      submitIntersprintFeed(input({ body: Buffer.alloc(0) }))
    ).rejects.toMatchObject({ code: "EMPTY_BODY" });
  });

  it("decompresses a gzipped body and checksums the original", async () => {
    const { submitIntersprintFeed } = await import("@/lib/server/feed-ingestion");
    const result = await submitIntersprintFeed(
      input({ body: gzipSync(CSV_BYTES), gzipped: true })
    );

    expect(result.checksum).toBe(CHECKSUM);
    expect(result.sourceRows).toBe(1);
  });

  it("refuses a body that claims to be gzip and is not", async () => {
    const { submitIntersprintFeed } = await import("@/lib/server/feed-ingestion");
    await expect(
      submitIntersprintFeed(input({ body: CSV_BYTES, gzipped: true }))
    ).rejects.toMatchObject({ code: "DECOMPRESSION_FAILED" });
  });
});

describe("snapshot semantics are not assumed", () => {
  /**
   * D14 is unresolved: nobody has told us whether a delivery is the complete
   * catalogue or only what changed. A 'complete' run is the ONLY thing that
   * may propose deactivating listings absent from the file, so the mode is
   * not a caller's choice.
   */
  it("always imports as partial, never as a complete snapshot", async () => {
    const { submitIntersprintFeed } = await import("@/lib/server/feed-ingestion");
    await submitIntersprintFeed(input());

    expect(analyzeCatalogueImport).toHaveBeenCalledWith(
      expect.objectContaining({ importMode: "partial" })
    );
  });
});

describe("idempotency", () => {
  it("does not re-apply content that already committed", async () => {
    const { submitIntersprintFeed } = await import("@/lib/server/feed-ingestion");
    analyzeCatalogueImport.mockResolvedValue({
      runId: "run-0",
      duplicateOfRunId: "run-0",
      summary: { sourceRows: 0, rejected: 0, malformedRows: 0, paddingRows: 0 },
      errors: [],
    });

    const result = await submitIntersprintFeed(input());

    expect(result.duplicateOfRunId).toBe("run-0");
    expect(result.finished).toBe(true);
    expect(commitCatalogueImport).not.toHaveBeenCalled();
  });

  it("reports an unfinished commit so the worker keeps going", async () => {
    const { submitIntersprintFeed } = await import("@/lib/server/feed-ingestion");
    commitCatalogueImport.mockResolvedValue({ finished: false, applied: 500 });

    const result = await submitIntersprintFeed(input());

    expect(result.finished).toBe(false);
    expect(result.runId).toBe("run-1");
  });
});

describe("configuration", () => {
  it("refuses to ingest when no supplier is configured", async () => {
    delete process.env.INTERSPRINT_SUPPLIER_ID;
    const { submitIntersprintFeed } = await import("@/lib/server/feed-ingestion");

    await expect(submitIntersprintFeed(input())).rejects.toMatchObject({
      code: "SUPPLIER_NOT_CONFIGURED",
      status: 503,
    });
    expect(analyzeCatalogueImport).not.toHaveBeenCalled();
  });

  it("records the category it detected from the header", async () => {
    const { submitIntersprintFeed, FEED_CATEGORY_NOTE_PREFIX } = await import(
      "@/lib/server/feed-ingestion"
    );
    await submitIntersprintFeed(input());

    expect(analyzeCatalogueImport).toHaveBeenCalledWith(
      expect.objectContaining({ notes: `${FEED_CATEGORY_NOTE_PREFIX}pcr` })
    );
  });

  /** Provenance travels, but never decides anything. */
  it("passes the supplier filename through as provenance only", async () => {
    const { submitIntersprintFeed } = await import("@/lib/server/feed-ingestion");
    await submitIntersprintFeed(input({ fileName: "vrd-001-21185.csv" }));

    // The file IS a PCR feed by its header, whatever the truck-looking name.
    expect(analyzeCatalogueImport).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "vrd-001-21185.csv" })
    );
    const call = analyzeCatalogueImport.mock.calls[0][0] as { notes: string };
    expect(call.notes).toContain("pcr");
  });
});

describe("unreadable feeds", () => {
  it("refuses a file that is not an Inter-Sprint feed", async () => {
    const { submitIntersprintFeed } = await import("@/lib/server/feed-ingestion");
    const junk = Buffer.from("hello, world\n");

    await expect(
      submitIntersprintFeed(
        input({
          body: junk,
          expectedChecksum: createHash("sha256").update(junk).digest("hex"),
        })
      )
    ).rejects.toMatchObject({ code: "FEED_UNREADABLE" });
    expect(analyzeCatalogueImport).not.toHaveBeenCalled();
  });
});

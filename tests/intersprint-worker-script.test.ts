import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const run = promisify(execFile);

/**
 * The VM worker script itself, executed.
 *
 * Not a re-implementation of its logic in TypeScript — the actual bash that
 * will run on the FTP VM, driven against a stub of our own endpoint. The two
 * things it decides are the two that can only be decided locally, and both are
 * exercised here: is this file finished being written, and has this content
 * already been accepted.
 *
 * Skipped off Linux, where `stat -c` and the GNU flags it uses do not exist.
 */

const SCRIPT = resolve("infra/intersprint-worker/ingest-feed.sh");
const CAN_RUN = process.platform === "linux" && existsSync(SCRIPT);
const describeMaybe = CAN_RUN ? describe : describe.skip;

const HEADER = "sysnr;itemcode;nett-price;available;wcat";
const CSV = `${HEADER}\n34197;205 55VR 16TWINTRACXL;99.2;6;1\n`;

interface Received {
  fileName: string;
  checksum: string;
  bodyChecksum: string;
  gzipped: boolean;
  rows: number;
}

describeMaybe("the Inter-Sprint worker script", () => {
  let server: Server;
  let port = 0;
  let received: Received[] = [];
  let commitCalls = 0;
  /** How many commit calls the stub makes the worker perform. */
  let commitsUntilFinished = 1;
  let ingestStatus = 200;
  let duplicateRunId: string | null = null;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        const body = Buffer.concat(chunks);

        if (req.headers.authorization !== "Bearer test-token") {
          res.writeHead(401).end(JSON.stringify({ ok: false }));
          return;
        }

        if (req.url?.endsWith("/ingest")) {
          if (ingestStatus !== 200) {
            res.writeHead(ingestStatus).end(JSON.stringify({ ok: false, code: "NOPE" }));
            return;
          }
          const gzipped = (req.headers["content-encoding"] ?? "").includes("gzip");
          const raw = gzipped ? gunzipSync(body) : body;
          received.push({
            fileName: String(req.headers["x-feed-filename"] ?? ""),
            checksum: String(req.headers["x-feed-checksum"] ?? ""),
            bodyChecksum: createHash("sha256").update(raw).digest("hex"),
            gzipped,
            rows: raw.toString("utf8").trim().split("\n").length - 1,
          });
          res.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              ok: true,
              runId: "11111111-1111-1111-1111-111111111111",
              duplicateOfRunId: duplicateRunId,
              finished: commitsUntilFinished === 0,
            })
          );
          return;
        }

        if (req.url?.endsWith("/commit")) {
          commitCalls++;
          res.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({ ok: true, finished: commitCalls >= commitsUntilFinished, applied: 1 })
          );
          return;
        }

        res.writeHead(404).end();
      });
    });

    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => {
    server.close();
  });

  function workspace() {
    const root = mkdtempSync(join(tmpdir(), "gr-feed-"));
    for (const dir of ["incoming", "processing", "processed", "failed"]) {
      mkdirSync(join(root, dir));
    }
    return root;
  }

  /** Writes a file and backdates it so the stability check sees it as settled. */
  function writeSettled(root: string, name: string, body: string, ageSeconds = 600) {
    const path = join(root, "incoming", name);
    writeFileSync(path, body);
    const when = new Date(Date.now() - ageSeconds * 1000);
    utimesSync(path, when, when);
    return path;
  }

  async function runWorker(root: string, env: Record<string, string> = {}) {
    received = [];
    commitCalls = 0;
    return run("bash", [SCRIPT], {
      env: {
        ...process.env,
        INTERSPRINT_WORKER_CONFIG: "/nonexistent",
        FEED_ROOT: root,
        INGEST_URL: `http://127.0.0.1:${port}/ingest`,
        COMMIT_URL: `http://127.0.0.1:${port}/commit`,
        FEED_WORKER_TOKEN: "test-token",
        STABLE_SECONDS: "90",
        ...env,
      },
    }).catch((error: Error & { stdout?: string; stderr?: string; code?: number }) => ({
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      code: error.code,
    }));
  }

  describe("partial-upload protection", () => {
    /**
     * vsftpd's STOR is not atomic: the supplier's file appears at its final
     * name and then grows. Reading it mid-upload would submit a truncated
     * price list that hashes perfectly well and looks complete.
     */
    it("leaves a file that is still being written alone", async () => {
      const root = workspace();
      writeSettled(root, "vrd-001-21185-107.csv", CSV, 5); // 5s old

      await runWorker(root);

      expect(received).toHaveLength(0);
      expect(readdirSync(join(root, "incoming"))).toEqual(["vrd-001-21185-107.csv"]);
      expect(readdirSync(join(root, "processing"))).toEqual([]);
      rmSync(root, { recursive: true, force: true });
    });

    it("processes a file that has stopped changing", async () => {
      const root = workspace();
      writeSettled(root, "vrd-001-21185-107.csv", CSV);

      await runWorker(root);

      expect(received).toHaveLength(1);
      expect(received[0].fileName).toBe("vrd-001-21185-107.csv");
      rmSync(root, { recursive: true, force: true });
    });

    it("ignores a zero-byte upload", async () => {
      const root = workspace();
      writeSettled(root, "empty.csv", "");

      await runWorker(root);

      expect(received).toHaveLength(0);
      expect(readdirSync(join(root, "incoming"))).toEqual(["empty.csv"]);
      rmSync(root, { recursive: true, force: true });
    });
  });

  describe("what it sends", () => {
    it("gzips the body and declares a checksum of the UNCOMPRESSED file", async () => {
      const root = workspace();
      writeSettled(root, "vrd-001-21185-107.csv", CSV);

      await runWorker(root);

      const expected = createHash("sha256").update(Buffer.from(CSV)).digest("hex");
      expect(received[0].gzipped).toBe(true);
      expect(received[0].checksum).toBe(expected);
      // The server re-hashes what it received; the two must agree or the
      // upload was truncated in flight.
      expect(received[0].bodyChecksum).toBe(expected);
      expect(received[0].rows).toBe(1);
      rmSync(root, { recursive: true, force: true });
    });

    it("processes both feeds in one run", async () => {
      const root = workspace();
      writeSettled(root, "vrd-001-21185-107.csv", CSV);
      writeSettled(root, "vrd-001-21185.csv", CSV.replace(";wcat", ""));

      await runWorker(root);

      expect(received.map((r) => r.fileName).sort()).toEqual([
        "vrd-001-21185-107.csv",
        "vrd-001-21185.csv",
      ]);
      rmSync(root, { recursive: true, force: true });
    });
  });

  describe("archiving happens only after the commit finishes", () => {
    it("archives a completed import under a unique name", async () => {
      const root = workspace();
      writeSettled(root, "vrd-001-21185-107.csv", CSV);

      await runWorker(root);

      expect(readdirSync(join(root, "incoming"))).toEqual([]);
      expect(readdirSync(join(root, "processing"))).toEqual([]);
      const archived = readdirSync(join(root, "processed"));
      expect(archived).toHaveLength(1);
      // Never the bare supplier filename: the same two names arrive several
      // times a day and would overwrite each other.
      expect(archived[0]).not.toBe("vrd-001-21185-107.csv");
      expect(archived[0].startsWith("vrd-001-21185-107.")).toBe(true);
      expect(archived[0].endsWith(".csv")).toBe(true);
      rmSync(root, { recursive: true, force: true });
    });

    it("keeps calling commit until the server says it is finished", async () => {
      const root = workspace();
      writeSettled(root, "vrd-001-21185-107.csv", CSV);
      commitsUntilFinished = 4;

      await runWorker(root);

      expect(commitCalls).toBe(4);
      expect(readdirSync(join(root, "processed"))).toHaveLength(1);
      commitsUntilFinished = 1;
      rmSync(root, { recursive: true, force: true });
    });

    /** A rejected feed is kept for investigation, never deleted. */
    it("moves a rejected feed to failed/ and keeps it", async () => {
      const root = workspace();
      writeSettled(root, "vrd-001-21185-107.csv", CSV);
      ingestStatus = 400;

      const result = await runWorker(root);

      expect(readdirSync(join(root, "failed"))).toHaveLength(1);
      expect(readdirSync(join(root, "processed"))).toEqual([]);
      expect(readdirSync(join(root, "incoming"))).toEqual([]);
      expect((result as { code?: number }).code).toBe(2);
      ingestStatus = 200;
      rmSync(root, { recursive: true, force: true });
    });

    it("archives without committing when the server reports a duplicate", async () => {
      const root = workspace();
      writeSettled(root, "vrd-001-21185-107.csv", CSV);
      duplicateRunId = "22222222-2222-2222-2222-222222222222";

      await runWorker(root);

      expect(commitCalls).toBe(0);
      expect(readdirSync(join(root, "processed"))).toHaveLength(1);
      duplicateRunId = null;
      rmSync(root, { recursive: true, force: true });
    });
  });

  describe("configuration safety", () => {
    it("refuses to run without a token rather than calling unauthenticated", async () => {
      const root = workspace();
      writeSettled(root, "vrd-001-21185-107.csv", CSV);

      const result = await runWorker(root, { FEED_WORKER_TOKEN: "" });

      expect((result as { code?: number }).code).toBe(1);
      expect(received).toHaveLength(0);
      expect(readdirSync(join(root, "incoming"))).toHaveLength(1);
      rmSync(root, { recursive: true, force: true });
    });

    it("refuses to run when the lifecycle directories are missing", async () => {
      const root = mkdtempSync(join(tmpdir(), "gr-feed-bare-"));
      mkdirSync(join(root, "incoming"));

      const result = await runWorker(root);

      expect((result as { code?: number }).code).toBe(1);
      rmSync(root, { recursive: true, force: true });
    });
  });
});

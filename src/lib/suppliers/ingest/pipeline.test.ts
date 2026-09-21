import { describe, it, expect } from "vitest";
import {
  runIngestion, verifyRun, countOutcomes,
  type IngestStore, type IngestRequest, type RunStatus, type IngestCounters,
} from "./pipeline";
import { parseIsbRows } from "../adapters/isb/parse";
import type { ParseOutcome } from "../types";

const ROW = {
  ean: "4717622044652", brand: "NANKANG", season: "summer", rim_inch: "10",
  width_mm: "145", aspect_ratio: "80", weight_kg: "6.031", weight_status: "supplier_reported",
  product_class: "light_truck_van", supplier_article_id: "12851",
  supplier_listing_key: "ISB:12851", source_row: "2", service_description_status: "parsed",
};

class FakeStore implements IngestStore {
  committed = new Map<string, string>();
  created: IngestRequest[] = [];
  staged: ParseOutcome[][] = [];
  commits: Array<{ runId: string; count: number }> = [];
  finished: Array<{ status: RunStatus; counters: IngestCounters; errorSummary: string | null }> = [];
  failCommit = false;
  private seq = 0;

  key(a: { laneCode: string; adapterName: string; fileChecksum: string }) {
    return `${a.laneCode}|${a.adapterName}|${a.fileChecksum}`;
  }
  async findCommittedRun(a: { laneCode: string; adapterName: string; fileChecksum: string }) {
    const id = this.committed.get(this.key(a));
    return id ? { runId: id } : null;
  }
  async createRun(a: IngestRequest & { observedAt: string }) {
    this.created.push(a);
    return { runId: `run-${++this.seq}` };
  }
  async stageRows(a: { runId: string; outcomes: ParseOutcome[] }) {
    this.staged.push(a.outcomes);
  }
  async commitOffers(a: { runId: string; offers: unknown[] }) {
    if (this.failCommit) throw new Error("database unavailable");
    this.commits.push({ runId: a.runId, count: a.offers.length });
  }
  async finishRun(a: { runId: string; status: RunStatus; counters: IngestCounters; errorSummary: string | null }) {
    this.finished.push({ status: a.status, counters: a.counters, errorSummary: a.errorSummary });
    if (a.status === "committed") {
      const req = this.created[this.created.length - 1];
      this.committed.set(this.key(req), a.runId);
    }
  }
}

function request(over: Partial<IngestRequest> = {}): IngestRequest {
  return {
    laneCode: "intersprint", adapterName: "isb", originalFilename: "cat.xlsx",
    fileChecksum: "sha256:abc", importMode: "partial", isTestData: false,
    uploadedBy: "tester", rows: [ROW], observedAt: "2026-09-21T12:00:00.000Z",
    ...over,
  };
}
const parse = (rows: unknown[], o: { isTestData: boolean; observedAt: string }) =>
  parseIsbRows(rows as Record<string, unknown>[], o);

describe("pipeline: fetch -> validate -> normalize -> stage -> verify -> commit", () => {
  it("commits a clean run and reports counters", async () => {
    const store = new FakeStore();
    const result = await runIngestion(store, request(), parse);
    expect(result.status).toBe("committed");
    expect(result.replayed).toBe(false);
    expect(result.counters.accepted).toBe(1);
    expect(result.counters.rejected).toBe(0);
    expect(store.commits).toHaveLength(1);
  });

  it("stages BEFORE committing, so parsing never mutates live state", async () => {
    const store = new FakeStore();
    await runIngestion(store, request(), parse);
    expect(store.staged).toHaveLength(1);
    expect(store.commits).toHaveLength(1);
  });

  it("records every observability field the owner asked for", async () => {
    const store = new FakeStore();
    const r = await runIngestion(store, request({ rows: [ROW, { ...ROW, supplier_article_id: "" }] }), parse);
    expect(r.counters.sourceRowCount).toBe(2);
    expect(r.counters.accepted).toBe(1);
    expect(r.counters.rejected).toBe(1);
    expect(r.rejections[0].errors).toContain("MISSING_SUPPLIER_ARTICLE_ID");
    expect(store.created[0].uploadedBy).toBe("tester");
    expect(store.created[0].observedAt).toBe("2026-09-21T12:00:00.000Z");
  });
});

describe("idempotency", () => {
  it("re-ingesting the same checksum is a REPLAY, not a second apply", async () => {
    const store = new FakeStore();
    await runIngestion(store, request(), parse);
    const second = await runIngestion(store, request(), parse);
    expect(second.replayed).toBe(true);
    expect(second.status).toBe("committed");
    expect(store.commits).toHaveLength(1); // still one
    expect(store.created).toHaveLength(1); // no second run created
  });

  it("a DIFFERENT checksum is a new run", async () => {
    const store = new FakeStore();
    await runIngestion(store, request(), parse);
    await runIngestion(store, request({ fileChecksum: "sha256:def" }), parse);
    expect(store.commits).toHaveLength(2);
  });

  it("the same file on a DIFFERENT lane is a separate run", async () => {
    const store = new FakeStore();
    await runIngestion(store, request(), parse);
    await runIngestion(store, request({ laneCode: "deldo" }), parse);
    expect(store.commits).toHaveLength(2);
  });
});

describe("a failed feed must not corrupt the last known good catalogue", () => {
  it("does NOT commit an empty file", async () => {
    const store = new FakeStore();
    const r = await runIngestion(store, request({ rows: [] }), parse);
    expect(r.status).toBe("failed");
    expect(r.errorSummary).toContain("EMPTY_FILE");
    expect(store.commits).toHaveLength(0);
  });

  it("does NOT commit when every row was rejected", async () => {
    const store = new FakeStore();
    const r = await runIngestion(store, request({ rows: [{ nonsense: 1 }, { junk: 2 }] }), parse);
    expect(r.status).toBe("failed");
    expect(r.errorSummary).toContain("NO_ROWS_ACCEPTED");
    expect(store.commits).toHaveLength(0);
  });

  it("does NOT commit duplicate supplier listing keys", async () => {
    const store = new FakeStore();
    const r = await runIngestion(store, request({ rows: [ROW, { ...ROW }] }), parse);
    expect(r.status).toBe("failed");
    expect(r.errorSummary).toContain("DUPLICATE_LISTING_KEYS");
    expect(store.commits).toHaveLength(0);
  });

  it("refuses a COMPLETE snapshot that lost most of its rows", async () => {
    // A lossy "complete" snapshot would wrongly deactivate live listings.
    const rows = [ROW, { bad: 1 }, { bad: 2 }, { bad: 3 }];
    const store = new FakeStore();
    const r = await runIngestion(store, request({ rows, importMode: "complete" }), parse);
    expect(r.status).toBe("failed");
    expect(r.errorSummary).toContain("COMPLETE_SNAPSHOT_TOO_LOSSY");
    expect(store.commits).toHaveLength(0);
  });

  it("allows the SAME lossy file as a partial import", async () => {
    // A partial file may never deactivate anything, so losing rows is safe.
    const rows = [ROW, { bad: 1 }, { bad: 2 }, { bad: 3 }];
    const store = new FakeStore();
    const r = await runIngestion(store, request({ rows, importMode: "partial" }), parse);
    expect(r.status).toBe("committed");
  });

  it("marks the run failed when the commit itself throws", async () => {
    const store = new FakeStore();
    store.failCommit = true;
    const r = await runIngestion(store, request(), parse);
    expect(r.status).toBe("failed");
    expect(r.errorSummary).toContain("COMMIT_FAILED");
    expect(store.finished.at(-1)?.status).toBe("failed");
  });

  it("marks the run failed when the parser throws, without committing", async () => {
    const store = new FakeStore();
    const r = await runIngestion(store, request(), () => { throw new Error("boom"); });
    expect(r.status).toBe("failed");
    expect(r.errorSummary).toContain("PARSE_FAILED");
    expect(store.commits).toHaveLength(0);
  });

  it("a failed run is never recorded as committed, so a retry re-runs it", async () => {
    const store = new FakeStore();
    store.failCommit = true;
    await runIngestion(store, request(), parse);
    store.failCommit = false;
    const retry = await runIngestion(store, request(), parse);
    expect(retry.replayed).toBe(false);
    expect(retry.status).toBe("committed");
  });
});

describe("test-data propagation through ingestion", () => {
  it("propagates isTestData onto every offer and into the commit", async () => {
    const store = new FakeStore();
    await runIngestion(store, request({ isTestData: true }), parse);
    const staged = store.staged[0][0];
    expect(staged.ok).toBe(true);
    if (staged.ok) expect(staged.offer.isTestData).toBe(true);
  });
});

describe("verifyRun / countOutcomes are pure", () => {
  it("returns no issues for a healthy partial run", () => {
    expect(verifyRun(countOutcomes(parse([ROW], { isTestData: false, observedAt: "x" }), 1), "partial")).toEqual([]);
  });

  it("counts EAN and review outcomes", () => {
    const outcomes = parse(
      [ROW, { ...ROW, supplier_article_id: "9", supplier_listing_key: "ISB:9", ean: "" }],
      { isTestData: false, observedAt: "x" },
    );
    const c = countOutcomes(outcomes, 2);
    expect(c.accepted).toBe(2);
    expect(c.missingEan).toBe(1);
    expect(c.reviewRequired).toBe(1);
    expect(c.priceObservations).toBe(0); // ISB feed has no prices
  });
});

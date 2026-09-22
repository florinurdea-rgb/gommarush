import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The admin feed-status view.
 *
 * The property that matters: last SUCCESS and last ATTEMPT are reported
 * separately. A feed that imported cleanly yesterday and has failed on every
 * delivery since still has a recent success, and collapsing the two would
 * render that as healthy.
 */

const from = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({
  createSupabaseAdminClient: () => ({ from }),
}));

const NOW = new Date("2026-09-22T15:00:00Z");

function mockRuns(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.order = self;
  chain.limit = () => Promise.resolve({ data, error });
  from.mockReturnValue(chain);
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    original_filename: "vrd-001-21185-107.csv",
    file_checksum: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    status: "committed",
    notes: "intersprint-feed:category=pcr",
    source_row_count: 11207,
    committed_row_count: 11207,
    rejected_rows: 0,
    conflict_count: 0,
    started_at: "2026-09-22T14:27:00Z",
    finished_at: "2026-09-22T14:29:00Z",
    error_summary: null,
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("reporting per feed", () => {
  it("reports PCR and truck separately", async () => {
    const { getIntersprintFeedStatus } = await import("@/lib/server/feed-status");
    mockRuns([
      run(),
      run({
        id: "22222222-2222-2222-2222-222222222222",
        notes: "intersprint-feed:category=truck",
        original_filename: "vrd-001-21185.csv",
        source_row_count: 171,
        committed_row_count: 171,
        finished_at: "2026-09-22T12:19:00Z",
      }),
    ]);

    const status = await getIntersprintFeedStatus(NOW);
    const pcr = status.byCategory.find((c) => c.category === "pcr");
    const truck = status.byCategory.find((c) => c.category === "truck");

    expect(pcr?.lastSuccess?.fileName).toBe("vrd-001-21185-107.csv");
    expect(pcr?.lastSuccess?.rowsReceived).toBe(11207);
    expect(truck?.lastSuccess?.fileName).toBe("vrd-001-21185.csv");
    expect(truck?.lastSuccess?.rowsReceived).toBe(171);
  });

  it("abbreviates the checksum rather than printing all of it", async () => {
    const { getIntersprintFeedStatus } = await import("@/lib/server/feed-status");
    mockRuns([run()]);

    const status = await getIntersprintFeedStatus(NOW);
    expect(status.byCategory[0].lastSuccess?.checksumShort).toBe("abcdef012345");
    expect(status.byCategory[0].lastSuccess?.checksumShort).toHaveLength(12);
  });

  it("is fresh just after a successful import", async () => {
    const { getIntersprintFeedStatus } = await import("@/lib/server/feed-status");
    mockRuns([run()]);

    const pcr = (await getIntersprintFeedStatus(NOW)).byCategory[0];
    expect(pcr.stale).toBe(false);
    expect(pcr.ageMs).toBeGreaterThan(0);
  });

  it("goes stale when the feed stops arriving", async () => {
    const { getIntersprintFeedStatus } = await import("@/lib/server/feed-status");
    mockRuns([run({ finished_at: "2026-09-19T14:29:00Z" })]);

    expect((await getIntersprintFeedStatus(NOW)).byCategory[0].stale).toBe(true);
  });

  /** "We have never imported anything" is not a healthy blank. */
  it("treats never having imported as stale", async () => {
    const { getIntersprintFeedStatus } = await import("@/lib/server/feed-status");
    mockRuns([]);

    const status = await getIntersprintFeedStatus(NOW);
    for (const category of status.byCategory) {
      expect(category.stale).toBe(true);
      expect(category.lastSuccess).toBeNull();
      expect(category.ageMs).toBeNull();
    }
  });
});

describe("a failing feed is visible", () => {
  /**
   * The case the split exists for: yesterday's success is still the last
   * success, and only the last ATTEMPT shows that today is broken.
   */
  it("keeps the last success and the last failure both visible", async () => {
    const { getIntersprintFeedStatus } = await import("@/lib/server/feed-status");
    mockRuns([
      run({
        id: "33333333-3333-3333-3333-333333333333",
        status: "failed",
        finished_at: "2026-09-22T14:29:00Z",
        error_summary: "CHECKSUM_MISMATCH: the upload was incomplete",
        committed_row_count: 0,
      }),
      run({ finished_at: "2026-09-21T14:29:00Z" }),
    ]);

    const pcr = (await getIntersprintFeedStatus(NOW)).byCategory[0];

    expect(pcr.lastAttempt?.status).toBe("failed");
    expect(pcr.lastAttempt?.error).toContain("CHECKSUM_MISMATCH");
    expect(pcr.lastSuccess?.status).toBe("committed");
    expect(pcr.lastSuccess?.finishedAt).toBe("2026-09-21T14:29:00Z");
  });

  it("reports rejected rows alongside accepted ones", async () => {
    const { getIntersprintFeedStatus } = await import("@/lib/server/feed-status");
    mockRuns([run({ source_row_count: 100, committed_row_count: 95, rejected_rows: 5 })]);

    const success = (await getIntersprintFeedStatus(NOW)).byCategory[0].lastSuccess;
    expect(success?.rowsReceived).toBe(100);
    expect(success?.rowsAccepted).toBe(95);
    expect(success?.rowsRejected).toBe(5);
  });
});

describe("degrading safely", () => {
  it("reports the schema as absent rather than throwing", async () => {
    const { getIntersprintFeedStatus } = await import("@/lib/server/feed-status");
    mockRuns(null, { code: "42P01", message: 'relation "catalogue_import_runs" does not exist' });

    const status = await getIntersprintFeedStatus(NOW);
    expect(status.schemaAvailable).toBe(false);
    expect(status.recent).toEqual([]);
  });

  it("ignores a run whose category note is missing or unrecognised", async () => {
    const { getIntersprintFeedStatus } = await import("@/lib/server/feed-status");
    mockRuns([run({ notes: null }), run({ id: "x", notes: "something else" })]);

    const status = await getIntersprintFeedStatus(NOW);
    for (const category of status.byCategory) {
      expect(category.lastSuccess).toBeNull();
    }
    // Still listed in the recent feed, just uncategorised.
    expect(status.recent).toHaveLength(2);
    expect(status.recent[0].category).toBeNull();
  });
});

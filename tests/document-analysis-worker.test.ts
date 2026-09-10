import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The cron worker's authorization.
 *
 * This route mutates data and calls a paid provider, so the tests that matter
 * are the refusals — particularly that an unset CRON_SECRET closes the route
 * rather than opening it.
 */

const runNextAnalysisJob = vi.fn();

vi.mock("@/lib/server/document-analysis-jobs", () => ({
  runNextAnalysisJob,
}));

afterEach(() => {
  runNextAnalysisJob.mockReset();
  vi.resetModules();
  delete process.env.CRON_SECRET;
});

async function callWorker(headers: Record<string, string> = {}) {
  const { GET } = await import("../app/api/cron/document-analysis/route");
  const request = new Request("https://example.com/api/cron/document-analysis", { headers });
  return GET(request as never);
}

describe("cron worker authorization", () => {
  it("refuses when CRON_SECRET is not configured, rather than defaulting open", async () => {
    const response = await callWorker({ authorization: "Bearer anything" });
    expect(response.status).toBe(404);
    expect(runNextAnalysisJob).not.toHaveBeenCalled();
  });

  it("refuses a request with no Authorization header", async () => {
    process.env.CRON_SECRET = "s3cret";
    const response = await callWorker();
    expect(response.status).toBe(404);
    expect(runNextAnalysisJob).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    const response = await callWorker({ authorization: "Bearer wrong" });
    expect(response.status).toBe(404);
    expect(runNextAnalysisJob).not.toHaveBeenCalled();
  });

  /** 404 rather than 401 so an unauthenticated caller learns nothing. */
  it("hides the route's existence from an unauthorized caller", async () => {
    process.env.CRON_SECRET = "s3cret";
    const response = await callWorker({ authorization: "Bearer wrong" });
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(JSON.stringify(body)).not.toMatch(/cron|secret|unauthor/i);
  });

  it("runs jobs for a correct secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    runNextAnalysisJob
      .mockResolvedValueOnce({ ran: true, analysisId: "a1", status: "READY", storedLines: 3, willRetry: false })
      .mockResolvedValueOnce({ ran: false, analysisId: null, status: null, storedLines: null, willRetry: false });

    const response = await callWorker({ authorization: "Bearer s3cret" });
    const body = (await response.json()) as { ok: boolean; processed: number };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(1);
  });

  it("stops as soon as the queue is empty", async () => {
    process.env.CRON_SECRET = "s3cret";
    runNextAnalysisJob.mockResolvedValue({ ran: false, analysisId: null, status: null, storedLines: null, willRetry: false });

    const response = await callWorker({ authorization: "Bearer s3cret" });
    const body = (await response.json()) as { processed: number };
    expect(body.processed).toBe(0);
    expect(runNextAnalysisJob).toHaveBeenCalledTimes(1);
  });

  /** An unbounded drain would be killed mid-job — the failure this removes. */
  it("drains at most three jobs per invocation", async () => {
    process.env.CRON_SECRET = "s3cret";
    runNextAnalysisJob.mockResolvedValue({ ran: true, analysisId: "a", status: "READY", storedLines: 1, willRetry: false });

    const response = await callWorker({ authorization: "Bearer s3cret" });
    const body = (await response.json()) as { processed: number };
    expect(body.processed).toBe(3);
    expect(runNextAnalysisJob).toHaveBeenCalledTimes(3);
  });

  /**
   * A non-2xx would make Vercel retry the whole tick and re-lease work that is
   * already in hand; the job itself has already persisted its own failure.
   */
  it("returns 200 even when a job throws, so the tick is not retried", async () => {
    process.env.CRON_SECRET = "s3cret";
    runNextAnalysisJob.mockRejectedValue(new Error("provider exploded"));

    const response = await callWorker({ authorization: "Bearer s3cret" });
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(false);
  });
});

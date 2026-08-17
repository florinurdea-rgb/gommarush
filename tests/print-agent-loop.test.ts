import { describe, expect, it, vi } from "vitest";
// @ts-expect-error - the agent is plain ESM JavaScript, deliberately unbuilt so
// it can be copied to a Windows machine and run with `npm start`.
import { createJobLoop } from "../print-agent/src/job-loop.js";

/**
 * Print Agent job loop, with a mocked Supabase and a mocked printer.
 *
 * Physical printing cannot be tested here, so the printer adapter is mocked —
 * which is exactly why the adapter abstraction exists. What IS tested is
 * everything that determines whether a label is lost, duplicated, or stuck:
 * claiming, completion reporting, failure handling and crash recovery.
 */

interface FakeJob {
  id: string;
  label_data: Record<string, unknown>;
  attempts: number;
}

function createFakeSupabase(jobs: FakeJob[]) {
  const claimed: string[] = [];
  const completed: { jobId: string; success: boolean; error: string | null }[] = [];
  let requeued = 0;

  const supabase = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "gorush_claim_print_job") {
        const job = jobs.shift();
        if (!job) return { data: { ok: true, code: "NO_JOB" }, error: null };
        claimed.push(job.id);
        // Mirrors the real RPC: the claim itself increments attempts.
        return {
          data: { ok: true, code: "CLAIMED", job: { ...job, attempts: job.attempts + 1 } },
          error: null,
        };
      }

      if (name === "gorush_complete_print_job") {
        completed.push({
          jobId: args.p_job_id as string,
          success: args.p_success as boolean,
          error: (args.p_error as string) ?? null,
        });
        return { data: { ok: true }, error: null };
      }

      if (name === "gorush_requeue_stale_print_jobs") {
        return { data: requeued, error: null };
      }

      throw new Error(`unexpected rpc ${name}`);
    }),
  };

  return {
    supabase,
    claimed,
    completed,
    setRequeued: (count: number) => {
      requeued = count;
    },
  };
}

const config = {
  agentId: "test-agent",
  printerName: "Toshiba-Test",
  label: { widthMm: 100, heightMm: 70, marginMm: 4 },
  pollIntervalMs: 1000,
  staleJobMinutes: 5,
};

const silentLogger = { log: () => undefined, error: () => undefined };

function labelData(token: string) {
  return {
    inventory_unit_id: "unit-1",
    unit_token: token,
    order_number: 1,
    stand_code: "A",
    customer: "Rossi Gomme SRL",
    product: "Michelin Primacy 4",
    brand: "Michelin",
    size: "225/55 R18",
    load_speed: "98V",
  };
}

describe("print agent job loop", () => {
  it("claims a job, renders a real PDF, prints it, and reports success", async () => {
    const fake = createFakeSupabase([
      { id: "job-1", label_data: labelData("GRUAAA111"), attempts: 0 },
    ]);

    const printed: Buffer[] = [];
    const printer = {
      name: "mock",
      print: async ({ pdf }: { pdf: Buffer }) => {
        printed.push(pdf);
        return { ok: true, detail: "mock printed" };
      },
    };

    const loop = createJobLoop({ supabase: fake.supabase, printer, config, logger: silentLogger });
    expect(await loop.processOne()).toBe(true);

    expect(fake.claimed).toEqual(["job-1"]);
    expect(fake.completed).toEqual([{ jobId: "job-1", success: true, error: null }]);

    // A genuine PDF, not a stub.
    expect(printed).toHaveLength(1);
    expect(printed[0].subarray(0, 5).toString()).toBe("%PDF-");
    expect(printed[0].length).toBeGreaterThan(1000);
  });

  it("returns false when the queue is empty instead of spinning", async () => {
    const fake = createFakeSupabase([]);
    const printer = { name: "mock", print: async () => ({ ok: true, detail: "" }) };
    const loop = createJobLoop({ supabase: fake.supabase, printer, config, logger: silentLogger });

    expect(await loop.processOne()).toBe(false);
    expect(fake.completed).toHaveLength(0);
  });

  it("records a print failure WITH its reason, so the label stays recoverable", async () => {
    const fake = createFakeSupabase([
      { id: "job-1", label_data: labelData("GRUBBB222"), attempts: 0 },
    ]);
    const printer = {
      name: "mock",
      print: async () => ({ ok: false, detail: "printer offline" }),
    };

    const loop = createJobLoop({ supabase: fake.supabase, printer, config, logger: silentLogger });
    await loop.processOne();

    expect(fake.completed[0].success).toBe(false);
    expect(fake.completed[0].error).toContain("printer offline");
  });

  it("does not wedge the queue on a malformed job", async () => {
    // No unit_token: unrenderable. It must fail and let the next job through.
    const fake = createFakeSupabase([
      { id: "bad", label_data: { order_number: 1 }, attempts: 0 },
      { id: "good", label_data: labelData("GRUCCC333"), attempts: 0 },
    ]);

    const printer = { name: "mock", print: async () => ({ ok: true, detail: "ok" }) };
    const loop = createJobLoop({ supabase: fake.supabase, printer, config, logger: silentLogger });

    const processed = await loop.drain();

    expect(processed).toBe(2);
    expect(fake.completed[0]).toMatchObject({ jobId: "bad", success: false });
    expect(fake.completed[0].error).toContain("unit_token");
    expect(fake.completed[1]).toMatchObject({ jobId: "good", success: true });
  });

  it("drains every queued job exactly once", async () => {
    const fake = createFakeSupabase(
      ["j1", "j2", "j3"].map((id) => ({ id, label_data: labelData(`GRU${id}`), attempts: 0 }))
    );

    let printCount = 0;
    const printer = {
      name: "mock",
      print: async () => {
        printCount += 1;
        return { ok: true, detail: "ok" };
      },
    };

    const loop = createJobLoop({ supabase: fake.supabase, printer, config, logger: silentLogger });
    expect(await loop.drain()).toBe(3);

    expect(printCount).toBe(3);
    expect(fake.claimed).toEqual(["j1", "j2", "j3"]);
    // Idempotency: no job completed twice.
    expect(new Set(fake.completed.map((c) => c.jobId)).size).toBe(3);
  });

  it("requeues jobs a crashed agent left claimed", async () => {
    const fake = createFakeSupabase([]);
    fake.setRequeued(2);

    const printer = { name: "mock", print: async () => ({ ok: true, detail: "" }) };
    const loop = createJobLoop({ supabase: fake.supabase, printer, config, logger: silentLogger });

    expect(await loop.requeueStale()).toBe(2);
    expect(fake.supabase.rpc).toHaveBeenCalledWith("gorush_requeue_stale_print_jobs", {
      p_stale_after: "5 minutes",
    });
  });

  it("survives a Supabase outage without crashing the agent", async () => {
    // A warehouse LAN drops. The queue is durable, so the loop must keep going.
    const supabase = {
      rpc: vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    };
    const printer = { name: "mock", print: async () => ({ ok: true, detail: "" }) };
    const loop = createJobLoop({ supabase, printer, config, logger: silentLogger });

    await expect(loop.tick()).resolves.toBeUndefined();
  });
});

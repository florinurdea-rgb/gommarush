import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  canTransition,
  SALES_ORDER_STATUSES,
  SALES_ORDER_TRANSITIONS,
  transitionRequiresNote,
} from "@/lib/commerce/sales-order-status";

/**
 * The sales-order commercial lifecycle (M23).
 *
 *   requested -> confirmed | rejected | cancelled
 *   confirmed -> pending_payment | cancelled
 *   pending_payment -> cancelled
 *
 * Confirmation is GommaRush accepting the order — never a supplier purchase.
 */

const read = (path: string) => readFileSync(path, "utf8");
const MIGRATION = "supabase/pending-approval/0008_sales_order_workflow.sql";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: (name: string, args: unknown) => rpc(name, args) }),
}));

afterEach(() => vi.clearAllMocks());

describe("the lifecycle table", () => {
  it("allows exactly the approved moves", () => {
    expect(SALES_ORDER_TRANSITIONS).toEqual({
      requested: ["confirmed", "rejected", "cancelled"],
      confirmed: ["pending_payment", "cancelled"],
      pending_payment: ["cancelled"],
      rejected: [],
      cancelled: [],
    });
  });

  it("refuses skipping, reversing and leaving a final state", () => {
    expect(canTransition("requested", "pending_payment")).toBe(false);
    expect(canTransition("confirmed", "requested")).toBe(false);
    expect(canTransition("rejected", "confirmed")).toBe(false);
    expect(canTransition("cancelled", "confirmed")).toBe(false);
    expect(canTransition("requested", "deleted")).toBe(false);
  });

  it("requires a reason to reject or cancel, not to confirm", () => {
    expect(transitionRequiresNote("rejected")).toBe(true);
    expect(transitionRequiresNote("cancelled")).toBe(true);
    expect(transitionRequiresNote("confirmed")).toBe(false);
    expect(transitionRequiresNote("pending_payment")).toBe(false);
  });

  /** The database function and the app must never disagree about a move. */
  it("matches the database function and status CHECK exactly", () => {
    const sql = read(MIGRATION);
    const fn = sql.slice(sql.indexOf("if not ((p_from, p_to) in ("), sql.indexOf("SALES_ORDER_TRANSITION_NOT_ALLOWED"));
    const pairs = [...fn.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}->${m[2]}`).sort();
    const expected = Object.entries(SALES_ORDER_TRANSITIONS)
      .flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`))
      .sort();
    expect(pairs).toEqual(expected);
    for (const status of SALES_ORDER_STATUSES) expect(sql).toContain(`'${status}'`);
  });
});

describe("the migration", () => {
  const sql = read(MIGRATION);
  const fnStart = sql.indexOf("create or replace function");
  const fnEnd = sql.indexOf("\n$$;", fnStart) + 4;

  it("is one transaction with pre-flight and post-flight assertions", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toContain("PREFLIGHT:");
    expect(sql).toContain("POSTFLIGHT:");
  });

  it("changes no existing data and deletes nothing", () => {
    expect(sql).not.toMatch(/^\s*delete\s+from/im);
    expect(sql).not.toMatch(/^\s*truncate/im);
    const outsideFunction = sql.slice(0, fnStart) + sql.slice(fnEnd);
    expect(outsideFunction).not.toMatch(/^\s*update\s+public\./im);
  });

  it("compare-and-sets on the current status and writes history in the same function", () => {
    const fn = sql.slice(fnStart, fnEnd);
    expect(fn).toContain("and so.status = p_from");
    expect(fn).toContain("SALES_ORDER_STATUS_CONFLICT");
    expect(fn).toContain("insert into public.sales_order_status_history");
  });

  it("keeps the function and history table away from browser roles", () => {
    expect(sql).toContain("revoke all on function public.transition_sales_order(uuid, text, text, text, uuid, text) from anon");
    expect(sql).toContain("revoke all on function public.transition_sales_order(uuid, text, text, text, uuid, text) from authenticated");
    expect(sql).toContain("alter table public.sales_order_status_history enable row level security;");
  });
});

describe("transitionSalesOrder", () => {
  const base = { orderId: "o-1", actorUserId: "admin-1", actorLabel: "Operatore" };

  it("refuses an illegal move before calling the database", async () => {
    const { transitionSalesOrder } = await import("@/lib/server/sales-order-workflow");
    await expect(
      transitionSalesOrder({ ...base, from: "requested", to: "pending_payment", note: null })
    ).rejects.toMatchObject({ code: "TRANSITION_NOT_ALLOWED" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a rejection without a reason before calling the database", async () => {
    const { transitionSalesOrder } = await import("@/lib/server/sales-order-workflow");
    await expect(
      transitionSalesOrder({ ...base, from: "requested", to: "rejected", note: "   " })
    ).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the status the operator saw, the target, the reason and the actor", async () => {
    const { transitionSalesOrder } = await import("@/lib/server/sales-order-workflow");
    rpc.mockResolvedValue({ data: [{ order_id: "o-1", new_status: "rejected" }], error: null });
    const result = await transitionSalesOrder({ ...base, from: "requested", to: "rejected", note: " Misura non disponibile " });
    expect(rpc).toHaveBeenCalledWith("transition_sales_order", {
      p_order_id: "o-1",
      p_from: "requested",
      p_to: "rejected",
      p_note: "Misura non disponibile",
      p_actor_user_id: "admin-1",
      p_actor_label: "Operatore",
    });
    expect(result).toEqual({ orderId: "o-1", status: "rejected" });
  });

  it("reports a concurrent change as a conflict, not a success", async () => {
    const { transitionSalesOrder } = await import("@/lib/server/sales-order-workflow");
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "SALES_ORDER_STATUS_CONFLICT" } });
    await expect(
      transitionSalesOrder({ ...base, from: "requested", to: "confirmed", note: null })
    ).rejects.toMatchObject({ code: "STATUS_CONFLICT" });
  });

  it("reports an unapplied 0008 as not activated", async () => {
    const { transitionSalesOrder } = await import("@/lib/server/sales-order-workflow");
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.transition_sales_order" },
    });
    await expect(
      transitionSalesOrder({ ...base, from: "requested", to: "confirmed", note: null })
    ).rejects.toMatchObject({ code: "WORKFLOW_NOT_ACTIVATED" });
  });
});

describe("the admin screens", () => {
  it("only an authenticated admin can move an order, recorded as that admin", () => {
    const route = read("app/api/admin/sales-orders/[id]/status/route.ts");
    expect(route).toContain("runAdminRoute(async (session)");
    expect(route).toContain("actorUserId: session.subject");
  });

  it("keeps supplier ordering a separate, disabled control", () => {
    const actions = read("src/components/logistics/SalesOrderActions.tsx");
    expect(actions).toMatch(/<Button[^>]*disabled title=\{tr\("Ordinazione fornitore non ancora attiva"\)\}>/);
    expect(actions).not.toMatch(/gateway|placeOrder|protocol|104/i);
    expect(read("app/admin/(secure)/sales-orders/page.tsx")).not.toContain("Conferma e invia ordine");
  });

  it("never renders raw service, payment or status values", () => {
    const detail = read("app/admin/(secure)/sales-orders/[id]/page.tsx");
    expect(detail).not.toMatch(/\{order\.fulfilment_class\}|\{order\.payment_method\}|\{order\.status\}/);
    const list = read("app/admin/(secure)/sales-orders/page.tsx");
    expect(list).not.toMatch(/\{order\.fulfilment_class\}|\{order\.payment_method\}/);
  });

  it("offers no delete", () => {
    for (const file of [
      "src/components/logistics/SalesOrderActions.tsx",
      "app/api/admin/sales-orders/[id]/status/route.ts",
      "src/lib/server/sales-order-workflow.ts",
    ]) {
      expect(read(file)).not.toMatch(/\.delete\(|export async function DELETE/);
    }
  });
});

describe("the customer sees the new status in words", () => {
  it("labels pending_payment", () => {
    const tag = read("src/components/customer/OrderStatusTag.tsx");
    expect(tag).toContain("pending_payment: {");
    expect(tag).toContain('label: "In attesa di pagamento"');
  });
});

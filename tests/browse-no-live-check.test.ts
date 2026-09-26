import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * OWNER DECISION, 2026-09-26: the live supplier check runs ONLY at final order
 * confirmation. Browsing, adding, editing quantities, the basket and entering
 * checkout re-price from catalogue data and never reach the supplier.
 *
 * The UI side (the browser calls only the catalogue and the preview) is
 * pinned in tests/ui/catalogue-basket.test.tsx. This pins the server side.
 */

const verifyBasketLive = vi.fn();
const stockByEan = vi.fn();
vi.mock("@/lib/server/live-availability", () => ({
  verifyBasketLive: (...a: unknown[]) => verifyBasketLive(...a),
  liveVerificationMissing: () => false,
}));
vi.mock("@/lib/server/supplier-gateway", () => ({
  getGatewayClient: () => ({ stockByEan: (...a: unknown[]) => stockByEan(...a) }),
}));
vi.mock("@/lib/auth/customer-session", () => ({
  requireCustomerSession: async () => ({ customerId: "c-1", subject: "u-1", accountId: "a-1", email: null }),
}));
vi.mock("@/lib/server/customer-basket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/customer-basket")>();
  return {
    ...actual,
    resolveBasket: async (lines: { productId: string; oldDot: boolean; quantity: number }[]) =>
      lines.map((input) => ({
        input,
        tyre: { sizeDisplay: "175/65 R15" },
        customer: {
          tyre: { brand: "LANDSAIL", modelPattern: "RAPIDDR", sizeDisplay: "175/65 R15" },
          availability: "in_stock",
          tyreSaleNetCents: 3826,
          pfuStatus: "ESTIMATED",
          pfuEstimated: true,
          pfuEstimateVersion: "v1",
          pfuAmountCents: 300,
          vatAmountCents: 908,
          customerTotalCents: 5034,
        },
        internal: { supplierCostCents: 3000, supplierName: "SECRET", laneCode: "intersprint", ean: "123" },
        availability: { state: "available" },
        provenance: { source: "feed", observedAt: "2026-09-26T06:00:00Z" },
      })),
  };
});

afterEach(() => vi.clearAllMocks());

async function preview(lines: unknown) {
  const { POST } = await import("../app/api/account/basket/preview/route");
  const { NextRequest } = await import("next/server");
  const response = await POST(
    new NextRequest("https://gommarush.test/api/account/basket/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines }),
    })
  );
  return { status: response.status, json: await response.json() };
}

describe("the basket preview", () => {
  it("never calls the live verification or the supplier gateway", async () => {
    const r = await preview([{ productId: "33333333-3333-3333-3333-333333333333", oldDot: false, quantity: 4 }]);
    expect(r.status).toBe(200);
    expect(verifyBasketLive).not.toHaveBeenCalled();
    expect(stockByEan).not.toHaveBeenCalled();
    expect(r.json.basket.lines[0].unitTyreNetCents).toBe(3826);
  });

  it("returns no verification provenance and nothing internal", async () => {
    const r = await preview([{ productId: "33333333-3333-3333-3333-333333333333", oldDot: false, quantity: 4 }]);
    const text = JSON.stringify(r.json);
    for (const banned of ["verifiedSource", "verifiedAt", "observedAt", "supplierCostCents", "SECRET", "laneCode", "intersprint"]) {
      expect(text, banned).not.toContain(banned);
    }
  });
});

describe("customer responses carry no provenance", () => {
  it("customerBasketView strips the basket and line sources", async () => {
    const { customerBasketView } = await import("@/lib/server/customer-basket");
    const view = customerBasketView({
      verifiedSource: "live",
      lines: [{ productId: "p", verifiedSource: "live", verifiedAt: "t", quantity: 1 }],
      orderable: true,
    } as never);
    expect(JSON.stringify(view)).not.toMatch(/verified/);
  });

  it("the order route uses it for every refusal it returns", () => {
    const route = readFileSync("app/api/account/orders/route.ts", "utf8");
    expect(route).toContain("basket: customerBasketView(error.basket)");
  });
});

describe("the final order is still the authoritative, force-fresh, fail-closed check", () => {
  const orders = readFileSync("src/lib/server/sales-orders.ts", "utf8");

  it("verifies every line fresh, before any order is written", () => {
    expect(orders).toContain("verifyBasketLive(resolved, Date.now, { forceFresh: true })");
    const verify = orders.indexOf("verifyBasketLive(resolved, Date.now, { forceFresh: true })");
    expect(verify).toBeLessThan(orders.indexOf('admin.rpc("create_portal_sales_order"'));
  });

  it("refuses on a missing check, a short line and a changed total — in that order", () => {
    const missing = orders.indexOf('throw new OrderRefusal("LIVE_VERIFICATION_UNAVAILABLE", basket)');
    const short = orders.indexOf('throw new OrderRefusal("BASKET_NOT_ORDERABLE", basket)');
    const price = orders.indexOf('throw new OrderRefusal("PRICE_CHANGED", basket)');
    expect(missing).toBeGreaterThan(-1);
    expect(missing).toBeLessThan(short);
    expect(short).toBeLessThan(price);
  });

  it("is the only caller of the live check", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const callers = execSync("grep -rl 'verifyBasketLive(' app src --include=*.ts --include=*.tsx")
      .toString()
      .trim()
      .split("\n")
      .sort();
    expect(callers).toEqual(["src/lib/server/live-availability.ts", "src/lib/server/sales-orders.ts"]);
  });
});

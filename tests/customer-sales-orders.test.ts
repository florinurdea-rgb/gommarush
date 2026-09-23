import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The order path: what it refuses, whose data it can reach, and what it writes.
 *
 * These exercise `resolveBasket` and `createPortalSalesOrder` against a mocked
 * PostgREST surface that RECORDS the filters applied. Recording matters more
 * than the returned rows here: the tenant-isolation properties are statements
 * about the predicates that reach the database, and a mock that ignores them
 * would pass whether or not they were ever sent.
 *
 * The transactional and uniqueness properties live in the database itself and
 * are verified against a real PostgreSQL by applying
 * supabase/pending-approval/0006_sales_orders.sql — they cannot be asserted
 * here, because a mock cannot roll anything back.
 */

const from = vi.fn();
const rpc = vi.fn();

interface Capture {
  table: string;
  filters: [string, unknown][];
}
let captured: Capture[] = [];

vi.mock("@/lib/supabase/server-admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => from(table),
    rpc: (name: string, args: unknown) => rpc(name, args),
  }),
}));

const CUSTOMER = "11111111-1111-1111-1111-111111111111";
const OTHER_CUSTOMER = "99999999-9999-9999-9999-999999999999";
const LOCATION = "22222222-2222-2222-2222-222222222222";
const PRODUCT = "33333333-3333-3333-3333-333333333333";

const SESSION = {
  subject: "auth-user-1",
  accountId: "acc-1",
  customerId: CUSTOMER,
  email: "cliente@example.com",
};

function product() {
  return {
    id: PRODUCT,
    brand: "ALPHA",
    model_pattern: "M",
    description: null,
    size_display: "205/55 R16",
    width_mm: 205,
    aspect_ratio: 55,
    rim_inch: 16,
    load_index: "91",
    speed_rating: "V",
    load_speed_raw: "91V",
    season: "summer",
    product_class: "passenger_car",
    xl: false,
    run_flat: false,
    old_dot: false,
    eprel_id: null,
    weight_kg: 8.5,
    active: true,
  };
}

function listing(id: string, price: string, stock: number) {
  return {
    id,
    supplier_article_id: `ART-${id}`,
    old_dot: false,
    catalogue_products: product(),
    suppliers: { name: "asdas" },
    catalogue_import_runs: { adapter: "intersprint-feed" },
    supplier_listing_prices: [
      {
        purchase_price: price,
        currency: "EUR",
        stock_raw: String(stock),
        stock_exact: stock,
        stock_minimum: stock,
        observed_at: "2026-09-22T14:00:00Z",
      },
    ],
  };
}

function builder(table: string, data: unknown, count = 0) {
  const entry: Capture = { table, filters: [] };
  captured.push(entry);
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.not = self;
  chain.or = self;
  chain.order = self;
  chain.update = self;
  chain.insert = self;
  chain.eq = (column: string, value: unknown) => {
    entry.filters.push([column, value]);
    return chain;
  };
  chain.in = (column: string, value: unknown) => {
    entry.filters.push([column, value]);
    return chain;
  };
  chain.maybeSingle = () =>
    Promise.resolve({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null });
  chain.single = () =>
    Promise.resolve({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null });
  // Returns the chain, not a promise: PostgREST builders stay chainable after
  // .limit() and are awaited at the end. The chain is thenable, so a caller
  // that awaits straight after .limit() still resolves.
  chain.limit = self;
  chain.range = () => Promise.resolve({ data, error: null, count });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

interface Scenario {
  listings?: unknown[];
  customer?: unknown;
  location?: unknown;
  existingOrder?: unknown;
}

function mockAll(scenario: Scenario = {}) {
  captured = [];
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: [{ id: "order-1", order_number: 1000, status: "requested" }],
    error: null,
  });
  from.mockImplementation((table: string) => {
    if (table === "supplier_product_listings") {
      return builder(table, scenario.listings ?? [listing("l-1", "100.00", 20)]);
    }
    if (table === "customers") {
      return builder(table, scenario.customer ?? { id: CUSTOMER, name: "Cliente", active: true });
    }
    if (table === "customer_locations") {
      return builder(
        table,
        scenario.location === undefined
          ? { id: LOCATION, address_line1: "Via Roma 1", city: "Verona", is_primary: true }
          : scenario.location
      );
    }
    if (table === "sales_orders") return builder(table, scenario.existingOrder ?? null);
    return builder(table, []);
  });
}

function orderInput(overrides: Record<string, unknown> = {}) {
  return {
    session: SESSION,
    lines: [{ productId: PRODUCT, oldDot: false, quantity: 4 }],
    locationId: LOCATION,
    paymentMethod: "bank_transfer" as const,
    fulfilmentClass: "standard" as const,
    note: null,
    idempotencyKey: "idem-key-0001",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("basket resolution against live supplier data", () => {
  it("refuses a quantity the supplier cannot evidence", async () => {
    const { resolveBasket } = await import("@/lib/server/customer-basket");
    mockAll({ listings: [listing("l-1", "100.00", 6)] });

    await expect(
      resolveBasket([{ productId: PRODUCT, oldDot: false, quantity: 20 }])
    ).rejects.toThrow("BASKET_QUANTITY_UNAVAILABLE");
  });

  it("sources from a dearer listing that can actually fill the order", async () => {
    const { resolveBasket } = await import("@/lib/server/customer-basket");
    // Cheapest holds 6; the order is for 20, which only the dearer one holds.
    mockAll({ listings: [listing("cheap-but-short", "100.00", 6), listing("dearer", "150.00", 40)] });

    const resolved = await resolveBasket([{ productId: PRODUCT, oldDot: false, quantity: 20 }]);
    expect(resolved[0].internal.supplierListingId).toBe("dearer");
  });

  it("prefers the cheapest listing that can fill the order", async () => {
    const { resolveBasket } = await import("@/lib/server/customer-basket");
    mockAll({ listings: [listing("dearer", "150.00", 40), listing("cheaper", "100.00", 40)] });

    const resolved = await resolveBasket([{ productId: PRODUCT, oldDot: false, quantity: 4 }]);
    expect(resolved[0].internal.supplierListingId).toBe("cheaper");
    expect(resolved[0].customer.tyreSaleNetCents).toBe(12_000);
  });

  it("refuses a product below the minimum offer quantity", async () => {
    const { resolveBasket } = await import("@/lib/server/customer-basket");
    mockAll({ listings: [listing("l-1", "100.00", 3)] });

    await expect(
      resolveBasket([{ productId: PRODUCT, oldDot: false, quantity: 1 }])
    ).rejects.toThrow("BASKET_ITEM_UNAVAILABLE");
  });

  it("pairs the customer line with the listing it actually sourced", async () => {
    const { resolveBasket } = await import("@/lib/server/customer-basket");
    // Two listings quoted identically: a price-equality match could pair the
    // customer line with the wrong one.
    mockAll({ listings: [listing("l-a", "100.00", 40), listing("l-b", "100.00", 40)] });

    const resolved = await resolveBasket([{ productId: PRODUCT, oldDot: false, quantity: 4 }]);
    expect(resolved[0].internal.supplierListingId).toBe("l-a");
    expect(resolved[0].customer.tyreSaleNetCents).toBe(resolved[0].internal.tyreSaleNetCents);
  });
});

describe("order creation records how its money was arrived at", () => {
  /**
   * Since the owner's 2026-09-23 decision an order CAN be created, because PFU
   * resolves to a temporary estimate. What must be true is that the order
   * records that fact permanently, so these orders can be found and re-quoted
   * when a verified tariff arrives.
   */
  it("creates the order and snapshots the PFU provenance as columns", async () => {
    const { createPortalSalesOrder } = await import("@/lib/server/sales-orders");
    const { PFU_ESTIMATE_VERSION } = await import("@/lib/pricing/pfu-estimate");
    mockAll();

    const order = await createPortalSalesOrder(orderInput());
    expect(order.order_number).toBe(1000);

    const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("create_portal_sales_order");
    expect(args.p_pfu_status).toBe("ESTIMATED");
    expect(args.p_pfu_estimate_version).toBe(PFU_ESTIMATE_VERSION);
    expect(args.p_vat_rate_percent).toBe(22);
    expect(args.p_delivery_promise_max_days).toBe(7);
  });

  it("snapshots the PFU provenance on every line as well as the header", async () => {
    const { createPortalSalesOrder } = await import("@/lib/server/sales-orders");
    const { PFU_ESTIMATE_VERSION } = await import("@/lib/pricing/pfu-estimate");
    mockAll();

    await createPortalSalesOrder(orderInput());
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    const items = args.p_items as Record<string, unknown>[];

    expect(items).toHaveLength(1);
    expect(items[0].pfu_status).toBe("ESTIMATED");
    expect(items[0].pfu_estimate_version).toBe(PFU_ESTIMATE_VERSION);
    expect(items[0].vat_rate_percent).toBe(22);
    // 3.00 estimated PFU, 120.00 net, 22% of 123.00 = 27.06.
    expect(items[0].unit_pfu_cents).toBe(300);
    expect(items[0].unit_tyre_net_cents).toBe(12_000);
    expect(items[0].unit_vat_cents).toBe(2_706);
    expect(items[0].unit_total_cents).toBe(15_006);
  });

  /** The fail-closed path has not been deleted, only moved behind a flag. */
  it("still refuses with PRICING_NOT_FINAL when no PFU amount can be had", async () => {
    const { createPortalSalesOrder } = await import("@/lib/server/sales-orders");
    const settings = await import("@/lib/pricing/settings");
    mockAll();

    const spy = vi
      .spyOn(settings, "DEFAULT_PRICING_SETTINGS", "get")
      .mockReturnValue({ ...settings.DEFAULT_PRICING_SETTINGS, pfuVatBase: "unresolved" });

    try {
      await expect(createPortalSalesOrder(orderInput())).rejects.toThrow("PRICING_NOT_FINAL");
      expect(rpc).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("order creation is scoped to the session's customer", () => {
  it("looks the delivery location up under the SESSION's customer id", async () => {
    const { createPortalSalesOrder } = await import("@/lib/server/sales-orders");
    mockAll();

    await createPortalSalesOrder(orderInput());

    const locationQuery = captured.find((c) => c.table === "customer_locations");
    expect(locationQuery).toBeDefined();
    expect(locationQuery?.filters).toEqual(
      expect.arrayContaining([
        ["id", LOCATION],
        ["customer_id", CUSTOMER],
        ["active", true],
      ])
    );
  });

  it("cannot be pointed at another customer's location", async () => {
    const { createPortalSalesOrder } = await import("@/lib/server/sales-orders");
    // The filter finds nothing, because the row belongs to someone else.
    mockAll({ location: null });

    await expect(createPortalSalesOrder(orderInput({ locationId: "someone-elses" }))).rejects.toThrow(
      "DELIVERY_ADDRESS_INVALID"
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a placeholder address even though the row exists and is owned", async () => {
    const { createPortalSalesOrder } = await import("@/lib/server/sales-orders");
    mockAll({ location: { id: LOCATION, address_line1: "—", city: "—", is_primary: true } });

    await expect(createPortalSalesOrder(orderInput())).rejects.toThrow("DELIVERY_ADDRESS_INVALID");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("scopes the idempotency lookup to the customer, never to the key alone", async () => {
    const { createPortalSalesOrder } = await import("@/lib/server/sales-orders");
    mockAll();

    await createPortalSalesOrder(orderInput());

    for (const query of captured.filter((c) => c.table === "sales_orders")) {
      const columns = query.filters.map(([column]) => column);
      if (columns.includes("idempotency_key")) {
        expect(columns, "an idempotency lookup must carry customer_id").toContain("customer_id");
      }
    }
  });

  it("lists only the given customer's orders", async () => {
    const { listCustomerSalesOrders } = await import("@/lib/server/sales-orders");
    mockAll();

    await listCustomerSalesOrders(OTHER_CUSTOMER);
    const query = captured.find((c) => c.table === "sales_orders");
    expect(query?.filters).toEqual(expect.arrayContaining([["customer_id", OTHER_CUSTOMER]]));
  });
});

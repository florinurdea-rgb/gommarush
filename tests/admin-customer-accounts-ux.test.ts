import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * REGRESSION: portal account management must be REACHABLE, and the customer
 * list must not break because of it.
 *
 * The reported failure: an operator opened Admin → Customers → a customer and
 * could not find "Accesso area clienti". The panel was deployed and the list
 * did link to the detail page, but the section sat underneath the locations
 * editor — a long, multi-branch form — so it was reached only by scrolling
 * past every delivery address the company had.
 *
 * These pin the three things that fix depends on: the list links to the
 * section, the section is rendered before the editor, and the list keeps
 * working when `customer_accounts` is absent.
 */

const from = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({
  createSupabaseAdminClient: () => ({ from: (table: string) => from(table) }),
}));

const LIST_PAGE = "app/admin/(secure)/customers/page.tsx";
const DETAIL_PAGE = "app/admin/(secure)/customers/[id]/page.tsx";
const PANEL = "src/components/logistics/CustomerAccountsPanel.tsx";
const ANCHOR = "accesso-area-clienti";

const read = (path: string) => readFileSync(path, "utf8");

describe("portal access is reachable from the customers list", () => {
  it("links every row straight to the portal-access section", () => {
    const source = read(LIST_PAGE);
    expect(source).toContain(`#${ANCHOR}`);
    expect(source).toContain("/admin/customers/${customer.id}");
  });

  it("names the section on the list, so it is findable without prior knowledge", () => {
    expect(read(LIST_PAGE)).toContain("Area clienti");
  });

  it("renders the panel ABOVE the locations editor on the detail page", () => {
    const source = read(DETAIL_PAGE);
    const panelAt = source.indexOf("CustomerAccountsPanel customerId");
    const editorAt = source.indexOf("CustomerEditor customer");

    expect(panelAt, "the panel must be rendered").toBeGreaterThan(-1);
    expect(editorAt, "the editor must be rendered").toBeGreaterThan(-1);
    expect(
      panelAt,
      "portal access must come before the long locations editor, or it is found only by scrolling"
    ).toBeLessThan(editorAt);
  });

  it("gives the section the anchor the list links to", () => {
    expect(read(PANEL)).toContain(`id="${ANCHOR}"`);
  });

  /** The heading must render even when the list cannot be read. */
  it("never hides the section behind a failed read", () => {
    const source = read(PANEL);
    const headingAt = source.indexOf('tr("Accesso area clienti")');
    const errorBranchAt = source.indexOf("{loadError ? (");

    expect(headingAt).toBeGreaterThan(-1);
    expect(errorBranchAt).toBeGreaterThan(-1);
    expect(
      headingAt,
      "the heading is outside the error branch, so the section is always visible"
    ).toBeLessThan(errorBranchAt);
  });

  /**
   * The misleading message this removes: ANY failure used to claim the schema
   * was missing, which after the migrations were applied would send an
   * operator to re-run migrations already in place.
   */
  it("only blames the schema when the server actually said so", () => {
    const source = read(PANEL);
    expect(source).toContain('j.code === "SCHEMA_NOT_READY"');
    expect(source).toContain("schemaMissing");
  });

  it("reports a missing table distinctly from other failures in the route", () => {
    const source = read("app/api/admin/customers/[id]/accounts/route.ts");
    expect(source).toContain("SCHEMA_NOT_READY");
    expect(source).toContain("isMissingSchemaError");
  });
});

// ---------------------------------------------------------------------------

function builder(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.or = self;
  chain.order = () => Promise.resolve({ data, error });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return chain;
}

function customerRow(extra: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    name: "Gommista Verona",
    legal_name: null,
    vat_number: "IT123",
    fiscal_code: null,
    email: null,
    phone: null,
    notes: null,
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    customer_locations: [{ id: "l-1" }],
    orders: [],
    ...extra,
  };
}

afterEach(() => vi.clearAllMocks());

describe("the customers list survives a missing customer_accounts table", () => {
  it("counts only ACTIVE portal logins when the table is present", async () => {
    const { listCustomers } = await import("@/lib/server/customers");
    from.mockReturnValue(
      builder([
        customerRow({
          customer_accounts: [
            { id: "a-1", active: true },
            { id: "a-2", active: true },
            { id: "a-3", active: false },
          ],
        }),
      ])
    );

    const [row] = await listCustomers();
    expect(row.portal_account_count).toBe(2);
  });

  it("reports zero, not null, for a customer with no logins", async () => {
    const { listCustomers } = await import("@/lib/server/customers");
    from.mockReturnValue(builder([customerRow({ customer_accounts: [] })]));

    const [row] = await listCustomers();
    expect(row.portal_account_count).toBe(0);
  });

  /**
   * The customers list is core existing functionality. Embedding a table that
   * only exists after migration 0005 must never be able to break it.
   */
  it("still returns the list when the table is absent, with an unknown count", async () => {
    const { listCustomers } = await import("@/lib/server/customers");
    let call = 0;
    from.mockImplementation(() => {
      call += 1;
      return call === 1
        ? builder(null, { code: "42P01", message: 'relation "customer_accounts" does not exist' })
        : builder([customerRow()]);
    });

    const rows = await listCustomers();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Gommista Verona");
    expect(rows[0].location_count).toBe(1);
    // Null, never 0: "we could not look" is not "this company has no login".
    expect(rows[0].portal_account_count).toBeNull();
    expect(call, "it retries once without the embed").toBe(2);
  });

  it("does NOT swallow a real failure behind the fallback", async () => {
    const { listCustomers } = await import("@/lib/server/customers");
    from.mockReturnValue(builder(null, { code: "42501", message: "permission denied" }));

    await expect(listCustomers()).rejects.toMatchObject({ code: "42501" });
  });
});

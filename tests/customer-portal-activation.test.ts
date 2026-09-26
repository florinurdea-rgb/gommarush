import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * Customer portal activation (M22).
 *
 * The release blocker: an operator could not create a customer test account.
 * Root cause: no Admin screen could create a customer at all (customers only
 * arose from the logistics document flow), and after the production reset
 * there were none — so the portal-access panel was unreachable.
 *
 * These pin: explicit auth_user_id → customer_id binding (never inferred from
 * email), the location prerequisite, no password ever passing through Admin,
 * the activation route's order of checks, and the reachable admin path.
 */

const read = (path: string) => readFileSync(path, "utf8");

// ---------------------------------------------------------------------------
// Supabase admin mock that records what reached each table
// ---------------------------------------------------------------------------

type Result = { data: unknown; error: unknown };
const tables: Record<string, Result> = {};
const inserts: { table: string; row: Record<string, unknown> }[] = [];
const filters: { table: string; column: string; value: unknown }[] = [];
const generateLink = vi.fn();
const deleteUser = vi.fn();
const getUserById = vi.fn();

function chain(table: string) {
  const result = () => tables[table] ?? { data: null, error: null };
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = self;
  c.order = self;
  c.eq = (column: string, value: unknown) => {
    filters.push({ table, column, value });
    return c;
  };
  c.insert = (row: Record<string, unknown>) => {
    inserts.push({ table, row });
    return c;
  };
  c.single = () => Promise.resolve(tables[`${table}:insert`] ?? result());
  c.maybeSingle = () => Promise.resolve(result());
  c.then = (resolve: (v: Result) => unknown) => Promise.resolve(result()).then(resolve);
  return c;
}

vi.mock("@/lib/supabase/server-admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => chain(table),
    auth: { admin: { generateLink, deleteUser, getUserById } },
  }),
}));

const verifyOtp = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp, updateUser, signOut } }),
}));

const CUSTOMER = "11111111-1111-1111-1111-111111111111";
const AUTH_USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  inserts.length = 0;
  filters.length = 0;
  tables.customers = { data: { id: CUSTOMER, active: true }, error: null };
  tables.customer_locations = {
    data: [{ address_line1: "Via Roma 1", city: "Verona", active: true }],
    error: null,
  };
  tables["customer_accounts:insert"] = { data: { id: "acc-1" }, error: null };
  generateLink.mockResolvedValue({
    data: { user: { id: AUTH_USER }, properties: { hashed_token: "hashed-token-123456" } },
    error: null,
  });
  deleteUser.mockResolvedValue({ error: null });
});

afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Granting access
// ---------------------------------------------------------------------------

describe("granting portal access", () => {
  it("binds the NEW auth identity to the customer named in the URL, never one found by email", async () => {
    const { grantPortalAccess } = await import("@/lib/server/customer-accounts");
    const result = await grantPortalAccess({
      customerId: CUSTOMER,
      email: "  Officina@Example.IT ",
      origin: "https://gommarush.com",
    });

    expect(generateLink).toHaveBeenCalledWith({ type: "invite", email: "officina@example.it" });
    const binding = inserts.find((i) => i.table === "customer_accounts");
    expect(binding?.row).toEqual({ auth_user_id: AUTH_USER, customer_id: CUSTOMER, active: true });
    // No customer is ever looked up BY email.
    expect(filters.some((f) => f.column === "email")).toBe(false);

    expect(result.activationUrl).toBe(
      "https://gommarush.com/account/attiva?token_hash=hashed-token-123456&type=invite"
    );
    expect(JSON.stringify(result).toLowerCase()).not.toContain("password");
  });

  it("refuses a malformed email before touching Auth", async () => {
    const { grantPortalAccess } = await import("@/lib/server/customer-accounts");
    await expect(
      grantPortalAccess({ customerId: CUSTOMER, email: "not-an-email", origin: "https://x" })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("refuses an unknown or inactive customer", async () => {
    const { grantPortalAccess } = await import("@/lib/server/customer-accounts");
    tables.customers = { data: { id: CUSTOMER, active: false }, error: null };
    await expect(
      grantPortalAccess({ customerId: CUSTOMER, email: "a@b.it", origin: "https://x" })
    ).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
    expect(generateLink).not.toHaveBeenCalled();
  });

  /** A login that can never complete checkout is not access. */
  it("requires a deliverable location, and a placeholder address does not count", async () => {
    const { grantPortalAccess } = await import("@/lib/server/customer-accounts");
    tables.customer_locations = { data: [{ address_line1: "—", city: "—", active: true }], error: null };
    await expect(
      grantPortalAccess({ customerId: CUSTOMER, email: "a@b.it", origin: "https://x" })
    ).rejects.toMatchObject({ code: "LOCATION_REQUIRED" });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("reports an email that already has a login, instead of re-binding it", async () => {
    const { grantPortalAccess } = await import("@/lib/server/customer-accounts");
    generateLink.mockResolvedValue({
      data: { user: null, properties: null },
      error: { code: "email_exists", message: "A user with this email address has already been registered" },
    });
    await expect(
      grantPortalAccess({ customerId: CUSTOMER, email: "admin@gommarush.it", origin: "https://x" })
    ).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });
    expect(inserts.filter((i) => i.table === "customer_accounts")).toHaveLength(0);
  });

  it("removes the auth identity when the binding cannot be written", async () => {
    const { grantPortalAccess } = await import("@/lib/server/customer-accounts");
    tables["customer_accounts:insert"] = { data: null, error: { code: "23505", message: "duplicate" } };
    await expect(
      grantPortalAccess({ customerId: CUSTOMER, email: "a@b.it", origin: "https://x" })
    ).rejects.toMatchObject({ code: "CUSTOMER_ACCOUNT_LINK_FAILED" });
    expect(deleteUser).toHaveBeenCalledWith(AUTH_USER);
  });
});

describe("reissuing an activation link", () => {
  it("is scoped to the customer in the URL and uses a recovery link", async () => {
    const { reissueActivationLink } = await import("@/lib/server/customer-accounts");
    tables.customer_accounts = { data: { id: "acc-1", auth_user_id: AUTH_USER, active: true }, error: null };
    getUserById.mockResolvedValue({ data: { user: { email: "officina@example.it" } }, error: null });

    const result = await reissueActivationLink({ customerId: CUSTOMER, accountId: "acc-1", origin: "https://g" });
    expect(filters).toContainEqual({ table: "customer_accounts", column: "customer_id", value: CUSTOMER });
    expect(generateLink).toHaveBeenCalledWith({ type: "recovery", email: "officina@example.it" });
    expect(result.activationUrl).toContain("type=recovery");
  });

  it("refuses a disabled login", async () => {
    const { reissueActivationLink } = await import("@/lib/server/customer-accounts");
    tables.customer_accounts = { data: { id: "acc-1", auth_user_id: AUTH_USER, active: false }, error: null };
    await expect(
      reissueActivationLink({ customerId: CUSTOMER, accountId: "acc-1", origin: "https://g" })
    ).rejects.toMatchObject({ code: "CUSTOMER_ACCOUNT_NOT_FOUND" });
  });
});

describe("portal access state shown to the operator", () => {
  it("distinguishes active, awaiting activation and disabled", async () => {
    const { portalAccessState } = await import("@/lib/server/customer-accounts");
    expect(portalAccessState(true, "2026-09-25T10:00:00Z")).toBe("active");
    expect(portalAccessState(true, null)).toBe("invited");
    expect(portalAccessState(false, "2026-09-25T10:00:00Z")).toBe("disabled");
  });
});

// ---------------------------------------------------------------------------
// The activation route
// ---------------------------------------------------------------------------

async function activate(body: unknown) {
  const { POST } = await import("../app/api/account/activate/route");
  const { NextRequest } = await import("next/server");
  const response = await POST(
    new NextRequest("https://gommarush.test/api/account/activate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify(body),
    })
  );
  return { status: response.status, json: await response.json() };
}

describe("the activation route", () => {
  const good = { token_hash: "hashed-token-123456", type: "invite", password: "una-password-lunga" };

  it("rejects a short password or an unknown link type without verifying anything", async () => {
    expect((await activate({ ...good, password: "short" })).status).toBe(400);
    expect((await activate({ ...good, type: "signup" })).status).toBe(400);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("reports an invalid or expired link", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    const r = await activate(good);
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("ACTIVATION_LINK_INVALID");
    expect(updateUser).not.toHaveBeenCalled();
  });

  /** A token for an identity that is not a portal customer changes nothing. */
  it("requires an active customer binding BEFORE setting any password", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: AUTH_USER } }, error: null });
    tables.customer_accounts = { data: null, error: null };
    const r = await activate(good);
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("CUSTOMER_ACCOUNT_NOT_LINKED");
    expect(updateUser).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });

  it("sets the customer's own password when the link and binding are valid", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: AUTH_USER } }, error: null });
    tables.customer_accounts = { data: { id: "acc-1", customer_id: CUSTOMER }, error: null };
    updateUser.mockResolvedValue({ error: null });
    const r = await activate(good);
    expect(r.status).toBe(200);
    expect(verifyOtp).toHaveBeenCalledWith({ type: "invite", token_hash: "hashed-token-123456" });
    expect(updateUser).toHaveBeenCalledWith({ password: "una-password-lunga" });
    expect(filters).toContainEqual({ table: "customer_accounts", column: "auth_user_id", value: AUTH_USER });
  });
});

// ---------------------------------------------------------------------------
// Structure: the path exists, and nothing takes a shortcut
// ---------------------------------------------------------------------------

describe("the admin path to a customer login exists", () => {
  it("lets an operator create a customer from the customers list", () => {
    expect(read("app/admin/(secure)/customers/page.tsx")).toContain("<CustomerCreateForm />");
    expect(read("src/components/logistics/CustomerCreateForm.tsx")).toContain('fetch("/api/admin/customers", {');
    expect(read("app/api/admin/customers/route.ts")).toContain("export async function POST");
  });

  it("passes the deliverable-location count to the portal panel", () => {
    const page = read("app/admin/(secure)/customers/[id]/page.tsx");
    expect(page).toContain("isDeliverableLocation");
    expect(page).toContain("deliverableLocationCount={deliverable}");
  });

  it("shows ACTIVE / NOT ACTIVE and the mapped login emails", () => {
    const panel = read("src/components/logistics/CustomerAccountsPanel.tsx");
    expect(panel).toContain('tr("Accesso ATTIVO")');
    expect(panel).toContain('tr("Accesso NON ATTIVO")');
    expect(panel).toContain("account.email");
  });

  it("never accepts, generates or displays a password in Admin", () => {
    const panel = read("src/components/logistics/CustomerAccountsPanel.tsx");
    const route = read("app/api/admin/customers/[id]/accounts/route.ts");
    expect(panel).not.toMatch(/type="password"|suggestPassword|setPassword/);
    expect(route).not.toContain("createUser");
    // The body it reads carries no password field at all.
    expect(route).toContain("const { email, accountId, reissue } = body");
    expect(route).not.toMatch(/\{[^}]*\bpassword\b[^}]*\}\s*=\s*body/);
  });

  it("keeps the activation page public and the rest of /account protected", () => {
    const middleware = read("middleware.ts");
    expect(middleware).toContain('const PUBLIC_CUSTOMER_PATHS = ["/account/login", "/account/attiva"];');
    expect(middleware).toContain('return NextResponse.redirect(new URL("/account/login", request.url))');
  });

  it("resolves the customer session by auth_user_id only", () => {
    const session = read("src/lib/auth/customer-session.ts");
    expect(session).toContain('.eq("auth_user_id", data.user.id)');
    expect(session).toContain('.eq("active", true)');
    expect(session).not.toMatch(/\.eq\("email"/);
    expect(existsSync("app/account/attiva/page.tsx")).toBe(true);
  });
});

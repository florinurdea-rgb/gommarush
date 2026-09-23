import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError, logEvent } from "@/lib/logger";
import { fail, ok, readJsonBody, runAdminRoute } from "@/lib/server/route-helpers";
import { listCustomerAccounts } from "@/lib/server/customer-accounts";
import { isMissingSchemaError } from "@/lib/server/schema-errors";

export const runtime = "nodejs";

/**
 * Portal logins for one customer company.
 *
 * IDENTITY IS EXPLICIT. A Supabase auth user becomes a customer only through a
 * row in `customer_accounts` created here by an operator. Nothing anywhere
 * infers a customer from an email address or an email domain — two companies
 * can share a billing contact, a person can change employer, and a customer
 * binding decides whose prices and whose orders someone sees.
 *
 * There is no public registration. This route is the only way an account is
 * created, and it is admin-authenticated.
 */

/** Long enough that a temporary password is not the weak link. */
const MIN_PASSWORD_LENGTH = 12;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return runAdminRoute(async () => {
    const { id: customerId } = await params;
    try {
      // Never the password, and never a hash of it: nothing here can echo a
      // credential back, because nothing here reads one.
      return ok({ accounts: await listCustomerAccounts(customerId) });
    } catch (error) {
      // "0005 has not been applied" is the one failure with a specific remedy,
      // so it gets its own code. Everything else keeps the generic handling —
      // reporting a permissions or network fault as a missing migration sends
      // an operator to re-run migrations that are already in place.
      if (isMissingSchemaError(error as { code?: string | null; message?: string | null }))
        return fail(503, "SCHEMA_NOT_READY");
      throw error;
    }
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return runAdminRoute(async () => {
    const { id: customerId } = await params;
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object") return fail(400, "VALIDATION_FAILED");

    const { email, password } = body as Record<string, unknown>;
    if (
      typeof email !== "string" ||
      !email.includes("@") ||
      typeof password !== "string" ||
      password.length < MIN_PASSWORD_LENGTH
    ) {
      return fail(400, "VALIDATION_FAILED", [
        `Email e una password temporanea di almeno ${MIN_PASSWORD_LENGTH} caratteri sono obbligatorie.`,
      ]);
    }

    const admin = createSupabaseAdminClient();
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .select("id,active")
      .eq("id", customerId)
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customer || !customer.active) return fail(404, "CUSTOMER_NOT_FOUND");

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
    });
    if (createError) return fail(409, "CUSTOMER_AUTH_CREATE_FAILED", [createError.message]);

    const user = created.user;
    const { data: account, error: linkError } = await admin
      .from("customer_accounts")
      .insert({ auth_user_id: user.id, customer_id: customerId, active: true })
      .select("id")
      .single();

    if (linkError) {
      // An auth user with no customer binding can sign in and resolve to no
      // customer, so it must not survive a failed link. Best-effort: if the
      // delete also fails, the session layer still refuses the user, because
      // it requires the binding rather than merely checking for its absence.
      const { error: cleanupError } = await admin.auth.admin.deleteUser(user.id);
      if (cleanupError) logError("customer_account_cleanup_failed", cleanupError);
      return fail(409, "CUSTOMER_ACCOUNT_LINK_FAILED", [linkError.message]);
    }

    logEvent("customer_account_created", { customerId, accountId: account.id });
    return ok({ accountId: account.id, authUserId: user.id, email: user.email }, 201);
  });
}

/**
 * Enables or disables a login without destroying it.
 *
 * Deactivation is the reversible control and the one an operator actually
 * wants: `getCustomerSession` requires `active = true`, so a disabled account
 * stops resolving to a customer immediately, while its past orders keep their
 * binding. Deleting the auth user instead would be irreversible and would not
 * be any safer.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return runAdminRoute(async () => {
    const { id: customerId } = await params;
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object") return fail(400, "VALIDATION_FAILED");

    const { accountId, active } = body as Record<string, unknown>;
    if (typeof accountId !== "string" || typeof active !== "boolean") {
      return fail(400, "VALIDATION_FAILED");
    }

    const admin = createSupabaseAdminClient();
    // Scoped by customer id so an account cannot be toggled through another
    // customer's URL.
    const { data, error } = await admin
      .from("customer_accounts")
      .update({ active, updated_at: new Date().toISOString() })
      .eq("id", accountId)
      .eq("customer_id", customerId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail(404, "CUSTOMER_ACCOUNT_NOT_FOUND");

    logEvent("customer_account_active_changed", { customerId, accountId, active });
    return ok({ accountId, active });
  });
}

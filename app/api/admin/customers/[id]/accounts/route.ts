import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logEvent } from "@/lib/logger";
import { fail, ok, readJsonBody, runAdminRoute } from "@/lib/server/route-helpers";
import {
  ActivationError,
  grantPortalAccess,
  listCustomerAccounts,
  reissueActivationLink,
} from "@/lib/server/customer-accounts";
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
 * created, and it is admin-authenticated. The operator never handles a
 * customer password: access is activated through a single-use link.
 */

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return runAdminRoute(async () => {
    const { id: customerId } = await params;
    try {
      // Never a password, and never a hash of it: nothing here can echo a
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

/**
 * Grants portal access (`{ email }`) or reissues an activation link for an
 * existing login (`{ accountId, reissue: true }`).
 *
 * Returns an activation URL for the operator to pass on. No password is
 * accepted, generated or returned — the customer chooses their own on
 * /account/attiva. See src/lib/server/customer-accounts.ts.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return runAdminRoute(async () => {
    const { id: customerId } = await params;
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object") return fail(400, "VALIDATION_FAILED");
    const { email, accountId, reissue } = body as Record<string, unknown>;
    // The admin's own origin: the link must open on the domain the operator
    // is using, which is the production domain for a production admin.
    const origin = new URL(request.url).origin;

    try {
      const result =
        reissue === true
          ? await reissueActivationLink({ customerId, accountId, origin })
          : await grantPortalAccess({ customerId, email, origin });
      return ok(result, reissue === true ? 200 : 201);
    } catch (error) {
      if (error instanceof ActivationError) return fail(error.status, error.code);
      if (isMissingSchemaError(error as { code?: string | null; message?: string | null }))
        return fail(503, "SCHEMA_NOT_READY");
      throw error;
    }
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

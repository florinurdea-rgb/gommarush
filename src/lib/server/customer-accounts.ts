import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { isDeliverableLocation } from "@/lib/commerce/delivery-address";
import { logError, logEvent } from "@/lib/logger";

/**
 * Customer portal access: who can sign in for a customer company, and how a
 * login is activated.
 *
 * IDENTITY IS EXPLICIT. A Supabase Auth identity belongs to a customer only
 * through a `customer_accounts` row an operator created for THAT customer.
 * Nothing here — or anywhere — infers a customer from an email address or a
 * domain. The email is only the address the activation link is issued for.
 *
 * ACTIVATION WITHOUT A PASSWORD IN ADMIN. The operator never sees, types or
 * handles a customer password. Access is granted by:
 *
 *   1. `auth.admin.generateLink({ type: "invite" })` — creates the Auth
 *      identity (unconfirmed, no password) and returns a single-use hashed
 *      token. Supabase sends NO email for a generated link, so this does not
 *      depend on the project's mail setup.
 *   2. The binding row `auth_user_id → customer_id`, written immediately.
 *   3. An activation URL on OUR domain carrying only the hashed token. The
 *      operator passes it to the customer. On /account/attiva the customer
 *      chooses their own password; the server verifies the token
 *      (`verifyOtp`) and sets the password in the same request.
 *
 * The token is verified on SUBMIT, not on page load, so a mail scanner or a
 * link preview that fetches the URL cannot consume it.
 *
 * A lost or expired link is replaced with a fresh one (`recovery` type), which
 * is also how a customer who forgot their password is let back in.
 */

export type PortalAccessState = "active" | "invited" | "disabled";

export interface CustomerAccountSummary {
  id: string;
  auth_user_id: string;
  active: boolean;
  created_at: string;
  /** The auth identity's email, for recognition only. Null if unreadable. */
  email: string | null;
  /**
   * `active`   binding on, and the customer has activated (set a password)
   * `invited`  binding on, activation link issued but not yet used
   * `disabled` binding switched off by an operator
   */
  state: PortalAccessState;
  lastSignInAt: string | null;
}

export function portalAccessState(active: boolean, emailConfirmedAt: string | null | undefined): PortalAccessState {
  if (!active) return "disabled";
  return emailConfirmedAt ? "active" : "invited";
}

/**
 * Portal logins bound to one customer company.
 *
 * The email and activation state are READ from the auth identity rather than
 * copied onto `customer_accounts`: a second copy would go silently stale. No
 * password or credential material is read, because none is readable.
 */
export async function listCustomerAccounts(customerId: string): Promise<CustomerAccountSummary[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("customer_accounts")
    .select("id,auth_user_id,active,created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return Promise.all(
    (data ?? []).map(async (row) => {
      try {
        const { data: user } = await admin.auth.admin.getUserById(row.auth_user_id);
        return {
          ...row,
          email: user?.user?.email ?? null,
          state: portalAccessState(row.active, user?.user?.email_confirmed_at),
          lastSignInAt: user?.user?.last_sign_in_at ?? null,
        };
      } catch (lookupError) {
        // A missing auth identity must not make the whole panel unavailable:
        // the binding still exists and the operator must be able to disable it.
        logError("customer_account_email_lookup_failed", lookupError);
        return { ...row, email: null, state: portalAccessState(row.active, null), lastSignInAt: null };
      }
    })
  );
}

export type ActivationRefusal =
  | "VALIDATION_FAILED"
  | "CUSTOMER_NOT_FOUND"
  | "LOCATION_REQUIRED"
  | "EMAIL_ALREADY_REGISTERED"
  | "CUSTOMER_AUTH_CREATE_FAILED"
  | "CUSTOMER_ACCOUNT_LINK_FAILED"
  | "CUSTOMER_ACCOUNT_NOT_FOUND"
  | "ACTIVATION_LINK_FAILED";

export class ActivationError extends Error {
  constructor(readonly code: ActivationRefusal, readonly status: number) {
    super(code);
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseLoginEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) && email.length <= 254 ? email : null;
}

/** The URL the customer opens. Only the hashed, single-use token travels in it. */
export function activationUrl(origin: string, hashedToken: string, type: "invite" | "recovery"): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/account/attiva?token_hash=${encodeURIComponent(hashedToken)}&type=${type}`;
}

/**
 * Supabase reports "that email already has an identity" in more than one way
 * across versions. Matched on the stable code first, then the message.
 */
function isEmailTaken(error: { code?: string; status?: number; message?: string }): boolean {
  if (error.code === "email_exists" || error.code === "user_already_exists") return true;
  return /already (been )?registered|already exists/i.test(error.message ?? "");
}

/**
 * Grants portal access to a customer: creates an unactivated Auth identity for
 * `email`, binds it to `customerId`, and returns the activation URL.
 *
 * REQUIRES A DELIVERABLE LOCATION. A login for a company with no real delivery
 * address can browse and fill a basket but can never complete checkout — the
 * order engine refuses placeholder addresses. Refusing here tells the operator
 * the one thing still missing, instead of the customer discovering it at the
 * last step.
 */
export async function grantPortalAccess(input: {
  customerId: string;
  email: unknown;
  origin: string;
}): Promise<{ accountId: string; email: string; activationUrl: string }> {
  const email = normaliseLoginEmail(input.email);
  if (!email) throw new ActivationError("VALIDATION_FAILED", 400);

  const admin = createSupabaseAdminClient();

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("id,active")
    .eq("id", input.customerId)
    .maybeSingle();
  if (customerError) throw customerError;
  if (!customer || !customer.active) throw new ActivationError("CUSTOMER_NOT_FOUND", 404);

  const { data: locations, error: locationError } = await admin
    .from("customer_locations")
    .select("address_line1,city,active")
    .eq("customer_id", input.customerId)
    .eq("active", true);
  if (locationError) throw locationError;
  if (!(locations ?? []).some((l) => isDeliverableLocation(l))) {
    throw new ActivationError("LOCATION_REQUIRED", 409);
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "invite", email });
  if (linkError || !link?.user || !link.properties?.hashed_token) {
    if (linkError && isEmailTaken(linkError)) throw new ActivationError("EMAIL_ALREADY_REGISTERED", 409);
    if (linkError) logError("customer_auth_create_failed", linkError);
    throw new ActivationError("CUSTOMER_AUTH_CREATE_FAILED", 502);
  }

  const { data: account, error: bindError } = await admin
    .from("customer_accounts")
    .insert({ auth_user_id: link.user.id, customer_id: input.customerId, active: true })
    .select("id")
    .single();

  if (bindError || !account) {
    // An identity with no binding resolves to no customer and must not
    // survive. Best effort: if this also fails, the session layer still
    // refuses it, because it REQUIRES a binding.
    const { error: cleanupError } = await admin.auth.admin.deleteUser(link.user.id);
    if (cleanupError) logError("customer_account_cleanup_failed", cleanupError);
    if (bindError) logError("customer_account_link_failed", bindError);
    throw new ActivationError("CUSTOMER_ACCOUNT_LINK_FAILED", 409);
  }

  logEvent("customer_portal_access_granted", { customerId: input.customerId, accountId: account.id });
  return {
    accountId: account.id,
    email,
    activationUrl: activationUrl(input.origin, link.properties.hashed_token, "invite"),
  };
}

/**
 * A fresh activation link for an existing, enabled login: the original was
 * lost or expired, or the customer forgot their password. Scoped by customer
 * id, so an account cannot be reached through another customer's URL.
 */
export async function reissueActivationLink(input: {
  customerId: string;
  accountId: unknown;
  origin: string;
}): Promise<{ accountId: string; email: string; activationUrl: string }> {
  if (typeof input.accountId !== "string") throw new ActivationError("VALIDATION_FAILED", 400);

  const admin = createSupabaseAdminClient();
  const { data: account, error } = await admin
    .from("customer_accounts")
    .select("id,auth_user_id,active")
    .eq("id", input.accountId)
    .eq("customer_id", input.customerId)
    .maybeSingle();
  if (error) throw error;
  if (!account || !account.active) throw new ActivationError("CUSTOMER_ACCOUNT_NOT_FOUND", 404);

  const { data: user, error: userError } = await admin.auth.admin.getUserById(account.auth_user_id);
  const email = user?.user?.email;
  if (userError || !email) throw new ActivationError("CUSTOMER_ACCOUNT_NOT_FOUND", 404);

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (linkError || !link?.properties?.hashed_token) {
    if (linkError) logError("customer_activation_link_failed", linkError);
    throw new ActivationError("ACTIVATION_LINK_FAILED", 502);
  }

  logEvent("customer_activation_link_reissued", { customerId: input.customerId, accountId: account.id });
  return {
    accountId: account.id,
    email,
    activationUrl: activationUrl(input.origin, link.properties.hashed_token, "recovery"),
  };
}

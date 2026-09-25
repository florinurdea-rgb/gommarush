import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { checkLoginRateLimit, getClientIp, recordLoginFailure, resetLoginFailures } from "@/lib/rate-limit";
import { fail, readJsonBody } from "@/lib/server/route-helpers";
import { logEvent } from "@/lib/logger";
import {
  isActivationType,
  MAX_CUSTOMER_PASSWORD_LENGTH,
  MIN_CUSTOMER_PASSWORD_LENGTH,
} from "@/lib/customer/activation";

export const runtime = "nodejs";

/**
 * Activates a portal login from the single-use link an operator issued.
 *
 * ORDER MATTERS:
 *   1. verify the token (this is what proves the visitor holds the link);
 *   2. require an ACTIVE customer binding for that identity — BEFORE touching
 *      the password, so a token for an identity that is not a portal customer
 *      changes nothing and leaves no session;
 *   3. set the password the customer chose.
 *
 * Verification happens on submit, not when the page is opened, so a mail
 * scanner or link preview that fetches the URL cannot consume the token.
 */
export async function POST(request: NextRequest) {
  const key = `customer-activate:${getClientIp(request.headers)}`;
  const limit = checkLoginRateLimit(key);
  if (limit.limited) {
    const response = fail(429, "RATE_LIMITED", [String(limit.retryAfterSeconds)]);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  const body = await readJsonBody(request);
  const { token_hash, type, password } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof token_hash !== "string" ||
    token_hash.length < 10 ||
    !isActivationType(type) ||
    typeof password !== "string" ||
    password.length < MIN_CUSTOMER_PASSWORD_LENGTH ||
    password.length > MAX_CUSTOMER_PASSWORD_LENGTH
  ) {
    return fail(400, "VALIDATION_FAILED");
  }

  const supabase = await createSupabaseServerClient();
  const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
    type,
    token_hash,
  });
  if (verifyError || !verified.user) {
    recordLoginFailure(key);
    return fail(400, "ACTIVATION_LINK_INVALID");
  }

  const admin = createSupabaseAdminClient();
  const { data: account, error: accountError } = await admin
    .from("customer_accounts")
    .select("id,customer_id")
    .eq("auth_user_id", verified.user.id)
    .eq("active", true)
    .maybeSingle();
  if (accountError || !account) {
    await supabase.auth.signOut();
    return fail(403, "CUSTOMER_ACCOUNT_NOT_LINKED");
  }

  const { error: passwordError } = await supabase.auth.updateUser({ password });
  if (passwordError) {
    // Supabase's own password policy (length/complexity/leaked-password
    // checks) may refuse it. The link is spent, so the session is dropped and
    // the operator can issue a new one.
    await supabase.auth.signOut();
    return fail(400, "PASSWORD_REJECTED");
  }

  resetLoginFailures(key);
  logEvent("customer_account_activated", { accountId: account.id, customerId: account.customer_id });
  return NextResponse.json({ ok: true });
}

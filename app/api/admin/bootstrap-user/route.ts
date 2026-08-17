import { NextRequest, NextResponse } from "next/server";
import { bootstrapAdminSchema } from "@/lib/validation/logistics";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { fail, readJsonBody } from "@/lib/server/route-helpers";
import { logError, logEvent } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * One-time admin-account bootstrap.
 *
 * Creates (or resets the password of) a Supabase Auth user directly through
 * the Admin API, bypassing the dashboard's "Invite user" flow entirely —
 * that flow sends a real email and rejects addresses its mail step considers
 * undeliverable, which has nothing to do with whether the account should
 * exist. This route never sends email; the account is created pre-confirmed.
 *
 * Trust boundary: gated by SUPABASE_SERVICE_ROLE_KEY itself rather than a
 * separate bootstrap secret. Whoever can read that value already has full
 * read/write access to the entire database (it bypasses Row Level Security),
 * so requiring it here grants nothing beyond what its holder already has.
 *
 * Delete this route once the first admin account is confirmed working.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (isRateLimited(`admin-bootstrap:${ip}`)) {
    logEvent("admin_bootstrap_rate_limited", { ip });
    return fail(429, "RATE_LIMITED");
  }

  const body = await readJsonBody(request);
  if (body === null) return fail(400, "VALIDATION_FAILED");

  const parsed = bootstrapAdminSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_FAILED");

  const expectedSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expectedSecret || parsed.data.secret !== expectedSecret) {
    logEvent("admin_bootstrap_wrong_secret", { ip });
    return fail(401, "UNAUTHORIZED");
  }

  const { email, password } = parsed.data;

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return fail(500, "SUPABASE_NOT_CONFIGURED");
  }

  try {
    // Look for an existing account with this email first: creating one that
    // already exists fails, and the operator's actual intent when re-running
    // this form is almost always "set/reset this account's password."
    let existingUserId: string | null = null;
    let page = 1;
    while (existingUserId === null) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
      if (match) existingUserId = match.id;
      if (data.users.length < 200) break;
      page += 1;
    }

    if (existingUserId) {
      const { error } = await admin.auth.admin.updateUserById(existingUserId, {
        password,
        email_confirm: true,
      });
      if (error) throw error;
      logEvent("admin_bootstrap_password_reset", { ip });
      return NextResponse.json({ ok: true, action: "password_reset" });
    }

    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    logEvent("admin_bootstrap_user_created", { ip });
    return NextResponse.json({ ok: true, action: "created" });
  } catch (error) {
    logError("admin_bootstrap_failed", error, { ip });
    return fail(500, "SAVE_FAILED");
  }
}

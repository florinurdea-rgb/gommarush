import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { checkLoginRateLimit, getClientIp, recordLoginFailure, resetLoginFailures } from "@/lib/rate-limit";
import { fail, readJsonBody } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const key = `customer-login:${ip}`;
  const limit = checkLoginRateLimit(key);
  if (limit.limited) {
    const response = fail(429, "RATE_LIMITED", [String(limit.retryAfterSeconds)]);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") return fail(400, "VALIDATION_FAILED");
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string" || !email.includes("@") || !password) {
    return fail(400, "VALIDATION_FAILED");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error || !data.user || !data.session) {
    recordLoginFailure(key);
    return fail(401, "INVALID_CREDENTIALS");
  }

  const admin = createSupabaseAdminClient();
  const { data: account } = await admin.from("customer_accounts").select("id")
    .eq("auth_user_id", data.user.id).eq("active", true).maybeSingle();

  if (!account) {
    await supabase.auth.signOut();
    return fail(403, "CUSTOMER_ACCOUNT_NOT_LINKED");
  }

  resetLoginFailures(key);
  return NextResponse.json({ ok: true });
}

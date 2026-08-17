import { NextResponse } from "next/server";
import { clearedAdminSessionCookie } from "@/lib/auth/admin-session";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(clearedAdminSessionCookie());
  return response;
}

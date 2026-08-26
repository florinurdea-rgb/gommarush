import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // No session to clear either way — must never block the client from
    // treating itself as signed out.
  }

  return NextResponse.json({ ok: true });
}

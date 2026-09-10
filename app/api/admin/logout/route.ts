import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // Missing Supabase config, etc. — there is no session to clear either
    // way, so this must never block the client from treating itself as
    // signed out.
  }

  return NextResponse.json({ ok: true });
}

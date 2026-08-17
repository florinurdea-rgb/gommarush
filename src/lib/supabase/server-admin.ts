import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses Row Level Security, so this file
 * must never be imported from a client component — the `server-only`
 * import above makes that a build-time error rather than a runtime leak.
 */
export function createSupabaseAdminClient() {
  // Trimmed: a stray trailing space/newline pasted into Vercel's env var UI
  // doesn't make the value "missing", but a newline inside an HTTP header
  // makes the whole request fail at the network layer — see the identical
  // comment in src/lib/supabase/config.ts.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase server configuration");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client.
 *
 * Safe here and ONLY here: this process runs on a trusted warehouse machine, not
 * in a browser. The web app never sees this key.
 */
export function createSupabase(config) {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Resolves the public (browser-safe) Supabase project config shared by the
 * server client and middleware.
 *
 * Supabase is migrating from "anon key" to "publishable key" naming; both
 * grant the same (RLS-governed, no-secret) access, so this prefers the new
 * name and falls back to the old one rather than forcing a rename on
 * whichever env the deployment already has configured.
 *
 * No "server-only" import here deliberately: middleware.ts runs on the Edge
 * runtime, which cannot import that package, and these two values are
 * intentionally public (NEXT_PUBLIC_) so there is nothing to protect.
 */
export interface SupabasePublicConfig {
  url: string;
  key: string;
}

export function resolveSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

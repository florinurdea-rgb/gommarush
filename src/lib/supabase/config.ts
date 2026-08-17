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

/**
 * Trims env values before use. A stray trailing space or newline from
 * copy-pasting into Vercel's env var UI is a real, recurring failure mode:
 * it doesn't make the value "missing" (so the app looks configured), but a
 * newline inside an HTTP header value makes the *entire request* fail at
 * the network layer with an opaque "fetch failed" — nothing about
 * credentials, just an error before the request is even sent.
 */
function trimmedEnv(name: string): string | undefined {
  const value = process.env[name];
  return value ? value.trim() : value;
}

export function resolveSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = trimmedEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = trimmedEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? trimmedEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  return { url, key };
}

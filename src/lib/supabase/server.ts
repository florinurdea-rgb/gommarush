import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveSupabasePublicConfig } from "@/lib/supabase/config";

/**
 * The Supabase client for Server Components and Route Handlers, backed by
 * the standard @supabase/ssr cookie adapter. This is what makes a session
 * survive navigation and refresh: the client reads/writes the same
 * sb-*-auth-token cookie pair that middleware.ts refreshes on every request,
 * instead of a hand-rolled cookie holding only a short-lived access token.
 *
 * `auth.getUser()` (not `auth.getSession()`) is the call to use against this
 * client for anything security-sensitive: getSession() only reads the
 * cookie, while getUser() revalidates it against Supabase.
 */
export async function createSupabaseServerClient() {
  const config = resolveSupabasePublicConfig();
  if (!config) throw new Error("Missing Supabase client configuration");

  const cookieStore = await cookies();

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Thrown when called during a Server Component render, where
          // cookies() is read-only. Harmless here: middleware.ts runs on
          // every request and is what actually persists a refreshed
          // session — this client only needs to read cookies in that case.
        }
      },
    },
  });
}

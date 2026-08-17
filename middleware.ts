import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { resolveSupabasePublicConfig } from "@/lib/supabase/config";
import { isAdminEmailAllowed } from "@/lib/auth/admin-authorization";

/**
 * Refreshes the Supabase session cookie on every /admin request and gates
 * access to everything under it except the pages that must stay reachable
 * without a session.
 *
 * This is the fix for "logged in, then refresh/navigate and it's gone":
 * `supabase.auth.getUser()` here revalidates the access token and, when it's
 * expired, uses the refresh token to mint a new pair and rewrites the
 * cookies on the response — the standard @supabase/ssr refresh pattern.
 * Without this running on every request, a Server Component page can read
 * an expired cookie and see no session even though the user is still
 * genuinely signed in.
 *
 * Scoped to page routes only (see `matcher` below) — API routes under
 * /api/admin/* enforce their own session check and return 401 JSON, which a
 * `fetch()` caller can handle; redirecting an API response would just break
 * response parsing instead of taking the user anywhere.
 */
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/bootstrap"];

function isPublicAdminPath(pathname: string): boolean {
  return PUBLIC_ADMIN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const config = resolveSupabasePublicConfig();
  if (!config) {
    // Nothing to refresh. Let the page itself surface SUPABASE_NOT_CONFIGURED
    // rather than failing the whole request here.
    return response;
  }

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isPublicAdminPath(request.nextUrl.pathname) && !isAdminEmailAllowed(user?.email)) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};

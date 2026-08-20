import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { resolveSupabasePublicConfig } from "@/lib/supabase/config";
import { isAdminEmailAllowed } from "@/lib/auth/admin-authorization";

/**
 * Refreshes the Supabase session cookie on every /admin and /driver request
 * and gates access to everything under them except the pages that must
 * stay reachable without a session.
 *
 * This is the fix for "logged in, then refresh/navigate and it's gone":
 * `supabase.auth.getUser()` here revalidates the access token and, when it's
 * expired, uses the refresh token to mint a new pair and rewrites the
 * cookies on the response — the standard @supabase/ssr refresh pattern.
 * Without this running on every request, a Server Component page can read
 * an expired cookie and see no session even though the user is still
 * genuinely signed in. Driver auth (src/lib/auth/driver-session.ts) uses
 * the exact same Supabase session, so it needs the same refresh.
 *
 * Only /admin additionally gates on the admin allowlist here — /driver has
 * no equivalent Edge-safe check (whether a Supabase user is also a linked
 * driver is a database lookup, done server-side per-page/route via
 * getDriverSession()/requireDriverSession()); this layer only redirects a
 * visitor with no Supabase session at all to /driver/login, the same way
 * an unauthenticated /admin visitor is redirected to /admin/login.
 *
 * Scoped to page routes only (see `matcher` below) — API routes under
 * /api/admin/* and /api/driver/* enforce their own session check and
 * return 401 JSON, which a `fetch()` caller can handle; redirecting an API
 * response would just break response parsing instead of taking the user
 * anywhere.
 */
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/bootstrap"];
const PUBLIC_DRIVER_PATHS = ["/driver/login"];

function matchesPublicPath(pathname: string, publicPaths: string[]): boolean {
  return publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
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

  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin")) {
    if (!matchesPublicPath(pathname, PUBLIC_ADMIN_PATHS) && !isAdminEmailAllowed(user?.email)) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  } else if (pathname.startsWith("/driver")) {
    if (!matchesPublicPath(pathname, PUBLIC_DRIVER_PATHS) && !user) {
      return NextResponse.redirect(new URL("/driver/login", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/driver/:path*"],
};

import { seedDemoOrders } from "@/lib/server/demo-seed";
import { ok, runAdminRoute } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * Explicitly requested one-off test-data seeding — see demo-seed.ts for why
 * this exists and how the resulting orders are labeled so they're easy to
 * find and delete afterward. Deliberately admin-only, and deliberately not
 * something the app does automatically.
 */
export async function POST() {
  return runAdminRoute(async (session) => {
    const result = await seedDemoOrders(session.subject);
    return ok(result);
  });
}

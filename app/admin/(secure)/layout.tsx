import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/admin-session";
import { AdminShell } from "@/components/logistics/AdminShell";
import { ToastProvider } from "@/components/ui/Toast";
import { countOrdersToPrepare } from "@/lib/server/orders";
import { countOpenQuoteRequests } from "@/lib/server/quote-requests";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * The server-side gate for every authenticated /admin page.
 *
 * It runs on the server before any admin markup is produced, so an
 * unauthenticated request never receives admin data — the protection is not
 * "hide the buttons". Every API route re-checks independently, because a layout
 * guard alone would not protect direct calls.
 *
 * `(secure)` is a route group: it does not appear in the URL, but it keeps
 * /admin/login outside this layout so the login page stays reachable without a
 * session (a guard covering it would redirect to itself forever).
 */
export default async function SecureAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  // Both counts feed nav badges. Either failing degrades to 0 rather than
  // taking down every admin page — a missing badge is not worth a 500.
  const [prepareCount, newQuoteCount] = await Promise.all([
    countOrdersToPrepare().catch((error) => {
      logError("admin_layout_prepare_count_failed", error);
      return 0;
    }),
    countOpenQuoteRequests().catch((error) => {
      logError("admin_layout_quote_count_failed", error);
      return 0;
    }),
  ]);

  return (
    <ToastProvider>
      <AdminShell
        displayName={session.displayName}
        prepareCount={prepareCount}
        quoteRequestCount={newQuoteCount}
      >
        {children}
      </AdminShell>
    </ToastProvider>
  );
}

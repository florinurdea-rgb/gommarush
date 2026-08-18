import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/admin-session";
import { AdminShell } from "@/components/logistics/AdminShell";
import { ToastProvider } from "@/components/ui/Toast";

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

  return (
    <ToastProvider>
      <AdminShell displayName={session.displayName}>{children}</AdminShell>
    </ToastProvider>
  );
}

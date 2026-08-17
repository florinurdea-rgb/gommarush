import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth/admin-session";
import { Logo } from "@/components/Logo";
import { LoginForm } from "@/components/logistics/LoginForm";
import { t } from "@/lib/i18n/logistics";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin" };

export default async function AdminLoginPage() {
  // Already signed in: skip the form.
  if (await getAdminSession()) redirect("/admin");

  return (
    <div className="flex min-h-screen flex-col bg-surface-soft">
      <header className="mx-auto w-full max-w-content px-4 pt-6 sm:px-6">
        <Link href="/">
          <Logo iconClassName="h-12 w-12" textClassName="text-2xl" />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-extrabold tracking-tight text-ink">{t("adminLogin")}</h1>
          <p className="mt-1 text-sm text-ink-soft">GoRush Logistică</p>

          <LoginForm />

          <p className="mt-6 text-xs leading-relaxed text-ink-soft">
            Autentificare prin Supabase Auth. Contul se creează din Supabase
            dashboard → Authentication → Users.
          </p>
        </div>
      </main>
    </div>
  );
}

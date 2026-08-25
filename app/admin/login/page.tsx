import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth/admin-session";
import { Logo } from "@/components/Logo";
import { LoginForm } from "@/components/logistics/LoginForm";
import { t } from "@/lib/i18n/logistics";
import { getOpsLocale } from "@/lib/i18n/ops-server";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";

// Keep Production deployments pinned to the current Supabase Auth login flow.
export const metadata = { title: "Admin" };

export default async function AdminLoginPage() {
  const tr = getTr();
  const locale = getOpsLocale();
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
          <h1 className="text-xl font-extrabold tracking-tight text-ink">{t("adminLogin", locale)}</h1>
          <p className="mt-1 text-sm text-ink-soft">{tr("GommaRush Logistica")}</p>

          <LoginForm />

          <p className="mt-6 text-xs leading-relaxed text-ink-soft">
            {tr("Autenticazione tramite Supabase Auth. L'account si crea dal dashboard Supabase → Authentication → Users.")}
          </p>
        </div>
      </main>
    </div>
  );
}

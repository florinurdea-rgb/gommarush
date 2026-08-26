import { redirect } from "next/navigation";
import { getDriverSession } from "@/lib/auth/driver-session";
import { Logo } from "@/components/Logo";
import { DriverLoginForm } from "@/components/logistics/DriverLoginForm";
import { t } from "@/lib/i18n/logistics";
import { getOpsLocale } from "@/lib/i18n/ops-server";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Autista" };

export default async function DriverLoginPage() {
  const tr = getTr();
  const locale = getOpsLocale();
  if (await getDriverSession()) redirect("/driver");

  return (
    <div className="flex min-h-screen flex-col bg-ink px-4 py-6 text-white">
      <div className="mx-auto w-full max-w-md">
        <Logo iconClassName="h-12 w-12" textClassName="text-2xl [&>span]:!text-white" />

        <h1 className="mt-8 text-2xl font-extrabold">{t("driverLogin", locale)}</h1>
        <p className="mt-1 text-sm text-white/60">{tr("GommaRush Logistica")}</p>

        <DriverLoginForm />

        <p className="mt-6 text-xs leading-relaxed text-white/40">
          {tr("L'account si crea dal dashboard Supabase → Authentication → Users, con lo stesso indirizzo email presente nella scheda dell'autista.")}
        </p>
      </div>
    </div>
  );
}

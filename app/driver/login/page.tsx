import { redirect } from "next/navigation";
import { getDriverSession } from "@/lib/auth/driver-session";
import { Logo } from "@/components/Logo";
import { DriverLoginForm } from "@/components/logistics/DriverLoginForm";
import { t } from "@/lib/i18n/logistics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Șofer" };

export default async function DriverLoginPage() {
  if (await getDriverSession()) redirect("/driver");

  return (
    <div className="flex min-h-screen flex-col bg-ink px-4 py-6 text-white">
      <div className="mx-auto w-full max-w-md">
        <Logo iconClassName="h-12 w-12" textClassName="text-2xl [&>span]:!text-white" />

        <h1 className="mt-8 text-2xl font-extrabold">{t("driverLogin")}</h1>
        <p className="mt-1 text-sm text-white/60">GoRush Logistică</p>

        <DriverLoginForm />

        <p className="mt-6 text-xs leading-relaxed text-white/40">
          Contul se creează din Supabase dashboard → Authentication → Users, cu
          aceeași adresă de email ca în fișa șoferului.
        </p>
      </div>
    </div>
  );
}

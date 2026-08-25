import Link from "next/link";
import { Logo } from "@/components/Logo";
import { BootstrapForm } from "@/components/logistics/BootstrapForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Configurare cont admin" };

/**
 * One-time page: creates or resets the password of a Supabase Auth admin
 * account without going through the Supabase dashboard's "Invite user" flow
 * (which sends a real email and can reject addresses for unrelated deliverability
 * reasons). Delete app/admin/bootstrap and app/api/admin/bootstrap-user once
 * the first admin account is confirmed working.
 */
export default function AdminBootstrapPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-soft">
      <header className="mx-auto w-full max-w-content px-4 pt-6 sm:px-6">
        <Link href="/">
          <Logo iconClassName="h-12 w-12" textClassName="text-2xl" />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-extrabold tracking-tight text-ink">Configurare cont admin</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Crea o reimposta la password di un account amministratore, direttamente — senza email di
            confirmare.
          </p>

          <BootstrapForm />

          <p className="mt-6 text-xs leading-relaxed text-ink-soft">
            La chiave service_role si trova in Supabase → Project Settings → API Keys →
            la riga <strong>service_role</strong> (segreta). Non viene inviata da nessuna parte
            altrove se non verso questo server.
          </p>
        </div>
      </main>
    </div>
  );
}

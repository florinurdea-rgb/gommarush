import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CustomerActivationForm } from "@/components/customer/CustomerActivationForm";
import { isActivationType } from "@/lib/customer/activation";
import { ROUTES, CUSTOMER_ROUTES } from "@/lib/site-routes";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attiva accesso | GommaRush", robots: { index: false } };

/**
 * Portal activation: the page a single-use link from GommaRush opens.
 *
 * Opening it does NOTHING to the account. The token is only verified when the
 * customer submits a password (see /api/account/activate), so a link preview
 * or mail scanner fetching this URL cannot spend it.
 *
 * Same frame as the sign-in page — logo, one card — so the step between an
 * operator's message and the portal looks like GommaRush, not like a
 * third-party auth screen.
 */
export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const tr = getTr();
  const { token_hash, type } = await searchParams;
  const valid = typeof token_hash === "string" && token_hash.length >= 10 && isActivationType(type);

  return (
    <div className="flex min-h-screen flex-col bg-surface-soft">
      <header className="mx-auto w-full max-w-content px-4 pt-6 sm:px-6">
        <Link href={ROUTES.home} aria-label="GommaRush">
          <Logo iconClassName="h-12 w-12" textClassName="text-2xl" />
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-sm rounded-2xl border border-ink/10 bg-white p-6 sm:p-8">
          <h1 className="text-xl font-extrabold tracking-tight text-ink">
            {type === "recovery" ? tr("Imposta la tua password") : tr("Attiva il tuo accesso")}
          </h1>
          {valid ? (
            <>
              <p className="mt-1 text-sm text-ink-soft">
                {tr("Scegli la password con cui accederai all'area clienti GommaRush.")}
              </p>
              <CustomerActivationForm tokenHash={token_hash as string} type={type as "invite" | "recovery"} />
            </>
          ) : (
            <>
              <p role="alert" className="mt-3 text-sm text-ink">
                {tr("Il link non è valido o è scaduto. Chiedi a GommaRush un nuovo link di attivazione.")}
              </p>
              <Link
                href={CUSTOMER_ROUTES.account}
                className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-ink/15 px-4 text-sm font-bold text-ink"
              >
                {tr("Vai all'accesso")}
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { CustomerLoginForm } from "@/components/customer/CustomerLoginForm";
import { getCustomerSession } from "@/lib/auth/customer-session";
import { ROUTES } from "@/lib/site-routes";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Area clienti | GommaRush" };

/**
 * The customer entry point.
 *
 * PRIMARY: sign in. SECONDARY: create an account, which is deliberately shown
 * as a real future option and deliberately not available.
 *
 * Presenting it as a disabled control with an explanation, rather than hiding
 * it, is the honest arrangement: a visitor who has no account learns that one
 * is created by GommaRush rather than concluding the portal is broken or
 * hunting for a signup form that does not exist. It is NOT a form that collects
 * details and silently discards them — nothing here accepts a registration.
 *
 * Authentication remains Supabase Auth, and identity remains the explicit
 * auth_user_id -> customer_id binding in `customer_accounts`. Nothing on this
 * page infers a customer from an email address.
 */
export default async function CustomerLoginPage() {
  const tr = getTr();
  if (await getCustomerSession()) redirect("/account");

  return (
    <div className="flex min-h-screen flex-col bg-surface-soft">
      <header className="mx-auto w-full max-w-content px-4 pt-6 sm:px-6">
        <Link href={ROUTES.home} aria-label="GommaRush">
          <Logo iconClassName="h-12 w-12" textClassName="text-2xl" />
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-sm">
          <div className="rounded-2xl border border-ink/10 bg-white p-6 sm:p-8">
            <h1 className="text-xl font-extrabold tracking-tight text-ink">{tr("Area clienti")}</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {tr("Accedi per consultare il catalogo, i prezzi riservati e i tuoi ordini.")}
            </p>
            <CustomerLoginForm />
          </div>

          {/*
            Secondary, and drawn as such: no second card competing with the
            sign-in one, just a quiet section underneath it.
          */}
          <div className="mt-6 px-1">
            <h2 className="text-sm font-bold text-ink">{tr("Non hai un account?")}</h2>
            <p className="mt-1 text-sm text-ink-soft">
              {tr("La registrazione online non è ancora attiva. Gli accessi vengono creati da GommaRush: contattaci e attiviamo il tuo account.")}
            </p>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="mt-3 inline-flex min-h-[44px] w-full cursor-not-allowed items-center justify-center rounded-xl border border-ink/15 bg-surface-soft px-4 text-sm font-bold text-ink/40"
            >
              {tr("Registrati — prossimamente")}
            </button>
            <p className="mt-3 text-xs text-ink-soft">
              <Link className="font-semibold underline" href={ROUTES.quote}>
                {tr("Richiedi un\u2019offerta")}
              </Link>{" "}
              {tr("oppure")}{" "}
              <Link className="font-semibold underline" href={ROUTES.register}>
                {tr("lascia i tuoi dati")}
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

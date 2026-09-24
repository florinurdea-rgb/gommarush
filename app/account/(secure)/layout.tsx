import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { CustomerSignOutButton } from "@/components/customer/CustomerSignOutButton";
import { CustomerHeaderNav, CustomerMobileNav } from "@/components/customer/CustomerShellNav";
import { getCustomerSession } from "@/lib/auth/customer-session";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";

/**
 * The customer area shell.
 *
 * It deliberately mirrors the PUBLIC header — same sticky white strip, same
 * steel hairline, same logo at the same size, same accent for the one primary
 * thing. Signing in should feel like going further into GommaRush, not like
 * arriving at a different product, and the previous shell (a single dense line
 * of unstyled links) was the sharpest edge in the whole journey.
 *
 * THE LOGO IS UNTOUCHED. `Logo` is rendered exactly as the public header
 * renders it; nothing here redraws, recolours or regenerates it.
 *
 * Navigation appears twice by design — a header row from `md`, a fixed bar
 * below it — and `CustomerShellNav` explains why. The spacer under `main` is
 * what stops that fixed bar covering the last row of a list.
 */
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const tr = getTr();
  const session = await getCustomerSession();
  if (!session) redirect("/account/login");

  return (
    <div className="min-h-screen bg-surface-soft">
      <header className="sticky top-0 z-40 border-b border-steel-soft bg-white">
        <div className="mx-auto flex w-full max-w-content items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            href="/account/catalogue"
            aria-label={tr("Area clienti")}
            className="min-w-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <Logo iconClassName="h-9 w-9 sm:h-10 sm:w-10" textClassName="text-lg sm:text-xl" />
          </Link>

          <div className="flex flex-none items-center gap-2 sm:gap-3">
            <CustomerHeaderNav />
            <CustomerSignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-content px-4 py-6 sm:px-6 sm:py-8">{children}</main>

      {/* Clears the fixed phone bar, plus the home indicator beneath it. */}
      <div className="h-[calc(56px+env(safe-area-inset-bottom))] md:hidden" aria-hidden="true" />
      <CustomerMobileNav />
    </div>
  );
}

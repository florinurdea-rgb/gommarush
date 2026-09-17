import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SignOutButton } from "@/components/logistics/SignOutButton";
import { BackButton } from "@/components/logistics/BackButton";
import { AdminNav } from "@/components/logistics/AdminNav";
import { HamburgerMenu } from "@/components/site/HamburgerMenu";

/**
 * Chrome for every admin screen. Two nav levels: the top bar carries only
 * global/account elements, and the operational nav lives in its own bar
 * directly below it (AdminNav) — never mixed together.
 *
 * The top bar also carries the SAME hamburger menu as the public site, so
 * an operator in the dashboard can reach the homepage, the quote form, the
 * driver area and the language switch without first signing out or typing a
 * URL. It is the identical component, not a copy — the two menus cannot
 * drift apart.
 */
export function AdminShell({
  children,
  displayName,
  prepareCount,
  quoteRequestCount,
}: {
  children: React.ReactNode;
  displayName: string;
  prepareCount: number;
  quoteRequestCount: number;
}) {
  return (
    <div className="min-h-screen bg-surface-soft">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/admin" className="flex-none">
            <Logo iconClassName="h-9 w-9" textClassName="text-xl" />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden text-sm text-ink-soft sm:inline">{displayName}</span>
            <SignOutButton />
            <HamburgerMenu />
          </div>
        </div>
      </header>

      <AdminNav prepareCount={prepareCount} quoteRequestCount={quoteRequestCount} />

      <main className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

export function PageHeading({
  title,
  description,
  action,
  back,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Shows "← Indietro" above the title. Only for secondary/drill-down pages
   *  (order detail, new order, customer detail, …) — never the primary nav
   *  destinations, which have nowhere more "back" to go. */
  back?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        {back && <BackButton />}
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
      </div>
      {action}
    </div>
  );
}

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { t } from "@/lib/i18n/logistics";
import { SignOutButton } from "@/components/logistics/SignOutButton";

/**
 * Chrome for every admin screen: navigation, the dev-auth notice, and the
 * sign-out control. Desktop-first (this is an office tool), but the nav wraps
 * cleanly on a tablet.
 */

const NAV = [
  { href: "/admin", labelKey: "ordersInProgress" as const },
  { href: "/admin/hold", labelKey: "ordersOnHold" as const },
  { href: "/admin/customers", labelKey: "customerList" as const },
  { href: "/admin/print-jobs", labelKey: "printQueue" as const },
  { href: "/admin/stands", labelKey: "standQrCodes" as const },
];

export function AdminShell({
  children,
  displayName,
  active,
}: {
  children: React.ReactNode;
  displayName: string;
  active?: string;
}) {
  return (
    <div className="min-h-screen bg-surface-soft">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex w-full max-w-admin flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/admin" className="flex-none">
            <Logo iconClassName="h-9 w-9" textClassName="text-xl" />
          </Link>

          <nav className="flex flex-1 flex-wrap items-center gap-1">
            {NAV.map((item) => {
              const isActive = active === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    isActive
                      ? "bg-accent-light text-accent-dark"
                      : "text-ink-soft hover:bg-surface-soft hover:text-ink"
                  }`}
                >
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-soft sm:inline">{displayName}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-admin px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
      </div>
      {action}
    </div>
  );
}

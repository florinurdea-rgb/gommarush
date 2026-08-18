"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Two nav levels: Livrări and Sumar are the two screens someone reaches for
 * dozens of times a day, so they're never hidden behind "Mai multe" even on
 * a narrow phone — everything else collapses there on mobile instead.
 * Active state is derived from the URL (usePathname) rather than threaded
 * through every page, so every admin screen highlights correctly for free.
 */

interface NavItem {
  href: string;
  label: string;
}

const PRIMARY_NAV: NavItem[] = [
  { href: "/admin", label: "Livrări" },
  { href: "/admin/summary", label: "Sumar" },
];

const SECONDARY_NAV: NavItem[] = [
  { href: "/admin/hold", label: "În așteptare" },
  { href: "/admin/customers", label: "Clienți" },
  { href: "/admin/print-jobs", label: "Coadă printare" },
  { href: "/admin/stands", label: "Coduri QR" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex-none rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
        active ? "bg-accent-light text-accent-dark" : "text-ink-soft hover:bg-surface-soft hover:text-ink"
      }`}
    >
      {item.label}
    </Link>
  );
}

export function AdminNav() {
  const pathname = usePathname() ?? "/admin";

  return (
    <nav className="border-b border-ink/10 bg-white">
      <div className="mx-auto flex w-full max-w-[1760px] items-center gap-1 overflow-x-auto px-4 py-1.5 sm:px-6">
        {PRIMARY_NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
        <div className="mx-1 h-5 flex-none border-l border-ink/10" aria-hidden="true" />
        {SECONDARY_NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </div>
    </nav>
  );
}

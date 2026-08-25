"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Two nav levels: Consegne and Sumar are the two screens someone reaches for
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
  { href: "/admin", label: "Consegne" },
  { href: "/admin/summary", label: "Riepilogo" },
];

const PREPARE_HREF = "/admin/prepare";
const PREPARE_SEEN_KEY = "admin_prepare_seen_count";

const QUOTES_HREF = "/admin/richieste-offerta";

const SECONDARY_NAV: NavItem[] = [
  { href: PREPARE_HREF, label: "Da preparare" },
  { href: QUOTES_HREF, label: "Richieste di offerta" },
  { href: "/admin/customers", label: "Clienti" },
  { href: "/admin/suppliers", label: "Fornitori" },
  { href: "/admin/sistema", label: "Sistema" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  pathname,
  badgeCount,
  badgeLabel,
}: {
  item: NavItem;
  pathname: string;
  badgeCount?: number;
  /** Announced by screen readers; defaults to a generic "N new" for this tab. */
  badgeLabel?: string;
}) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`relative flex-none rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
        active ? "bg-accent-light text-accent-dark" : "text-ink-soft hover:bg-surface-soft hover:text-ink"
      }`}
    >
      {item.label}
      {!!badgeCount && badgeCount > 0 && (
        <span
          className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white"
          aria-label={badgeLabel ?? `${badgeCount} nuovi elementi in ${item.label}`}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </Link>
  );
}

export function AdminNav({
  prepareCount,
  quoteRequestCount,
}: {
  prepareCount: number;
  quoteRequestCount: number;
}) {
  const pathname = usePathname() ?? "/admin";
  // null until read from localStorage — avoids a hydration mismatch by not
  // rendering any badge state until we know what's actually been "seen".
  const [seenCount, setSeenCount] = useState<number | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(PREPARE_SEEN_KEY);
    setSeenCount(stored === null ? 0 : Number(stored) || 0);
  }, []);

  useEffect(() => {
    if (!pathname.startsWith(PREPARE_HREF)) return;
    window.localStorage.setItem(PREPARE_SEEN_KEY, String(prepareCount));
    setSeenCount(prepareCount);
  }, [pathname, prepareCount]);

  const prepareBadge = seenCount !== null && prepareCount > seenCount ? prepareCount : undefined;

  return (
    <nav className="border-b border-ink/10 bg-white">
      <div className="mx-auto flex w-full max-w-[1760px] items-center gap-1 overflow-x-auto px-4 py-1.5 sm:px-6">
        {PRIMARY_NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
        <div className="mx-1 h-5 flex-none border-l border-ink/10" aria-hidden="true" />
        {SECONDARY_NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            pathname={pathname}
            badgeCount={
              item.href === PREPARE_HREF
                ? prepareBadge
                : item.href === QUOTES_HREF
                  ? quoteRequestCount || undefined
                  : undefined
            }
            badgeLabel={
              item.href === PREPARE_HREF
                ? `${prepareBadge ?? 0} nuovi ordini da preparare`
                : item.href === QUOTES_HREF
                  ? `${quoteRequestCount} richieste di offerta nuove`
                  : undefined
            }
          />
        ))}
      </div>
    </nav>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  CommerceCartIcon,
  CommerceLocationIcon,
  CommerceSearchIcon,
  CommerceTruckIcon,
} from "@/components/customer/CommerceIcons";
import { BASKET_CHANGED_EVENT, basketQuantity } from "@/lib/customer/basket";
import { useTr } from "@/lib/i18n/tr";

/**
 * Customer-area navigation: a desktop row in the header, a fixed bar on a
 * phone.
 *
 * WHY TWO SHAPES RATHER THAN ONE THAT SHRINKS. A tyre shop ordering on a
 * phone moves between catalogue and basket constantly, and a link in a
 * collapsed header menu costs two taps every time. The same four destinations
 * are therefore a persistent bottom bar under `md`, which is one tap and lands
 * under the thumb, and an ordinary header row above it.
 *
 * The count is live: it listens for the basket's own change event, for
 * `storage` (another tab), and for focus (a tab that changed while hidden).
 * It renders only after mount — the basket lives in the browser, so a server
 * render of 0 that becomes 3 would be a hydration mismatch.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly Icon: (props: { className?: string }) => JSX.Element;
  readonly badge?: boolean;
  /** `/account` matches exactly; the others match their whole section. */
  readonly exact?: boolean;
}

const ITEMS: readonly NavItem[] = [
  { href: "/account/catalogue", label: "Catalogo", Icon: CommerceSearchIcon },
  { href: "/account/basket", label: "Carrello", Icon: CommerceCartIcon, badge: true },
  { href: "/account/orders", label: "Ordini", Icon: CommerceTruckIcon },
  { href: "/account", label: "Account", Icon: CommerceLocationIcon, exact: true },
];

function useBasketCount() {
  const [count, setCount] = useState<number | null>(null);
  const [bumped, setBumped] = useState(false);
  const previous = useRef<number | null>(null);

  useEffect(() => {
    const sync = () => {
      const next = basketQuantity();
      setCount(next);
      // Only on an increase: shrinking the badge when a line is removed would
      // celebrate the wrong event.
      if (previous.current !== null && next > previous.current) {
        setBumped(true);
        window.setTimeout(() => setBumped(false), 420);
      }
      previous.current = next;
    };
    sync();
    window.addEventListener(BASKET_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(BASKET_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  return { count, bumped };
}

function Badge({ count, bumped }: { count: number; bumped: boolean }) {
  const tr = useTr();
  return (
    <span
      aria-label={`${count} ${tr("articoli nel carrello")}`}
      className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold leading-none text-white transition-transform duration-200 ease-out ${
        bumped ? "scale-125" : "scale-100"
      }`}
    >
      {count}
    </span>
  );
}

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname.startsWith(href);
}

/** The header row, from `md` up. */
export function CustomerHeaderNav() {
  const tr = useTr();
  const pathname = usePathname() ?? "";
  const { count, bumped } = useBasketCount();

  return (
    <nav aria-label={tr("Area clienti")} className="hidden md:block">
      <ul className="flex items-center gap-1">
        {ITEMS.map(({ href, label, Icon, badge, exact }) => {
          const active = isActive(pathname, href, exact);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3 text-[14.5px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                  active ? "bg-accent-light text-accent" : "text-ink-soft hover:bg-surface-soft hover:text-ink"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                {tr(label)}
                {badge && count !== null && count > 0 && <Badge count={count} bumped={bumped} />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The phone bar.
 *
 * `pb-[env(safe-area-inset-bottom)]` keeps it clear of the home indicator, and
 * the matching spacer in the layout keeps it from covering the last row of a
 * list — a fixed bar that hides the thing it sits on is worse than no bar.
 */
export function CustomerMobileNav() {
  const tr = useTr();
  const pathname = usePathname() ?? "";
  const { count, bumped } = useBasketCount();

  return (
    <nav
      aria-label={tr("Area clienti")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto flex max-w-content items-stretch">
        {ITEMS.map(({ href, label, Icon, badge, exact }) => {
          const active = isActive(pathname, href, exact);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 text-[11px] font-bold transition-colors focus:outline-none focus-visible:bg-accent-light ${
                  active ? "text-accent" : "text-ink-soft"
                }`}
              >
                {/* A thin rule over the current tab: obvious, not heavy, and not colour alone. */}
                {active && (
                  <span className="absolute inset-x-5 top-0 h-0.5 rounded-b bg-accent" aria-hidden="true" />
                )}
                <span className="relative">
                  <Icon className="h-[22px] w-[22px]" />
                  {badge && count !== null && count > 0 && (
                    <span className="absolute -right-2.5 -top-1.5">
                      <Badge count={count} bumped={bumped} />
                    </span>
                  )}
                </span>
                {tr(label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

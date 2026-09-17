"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { HamburgerMenu } from "@/components/site/HamburgerMenu";
import { useLocale } from "@/components/site/LocaleProvider";
import { BUTTON_STYLES } from "@/components/site/Section";
import { ROUTES, REGISTER_HREF } from "@/lib/site-routes";

/**
 * The public header: logo, marketing navigation, the primary CTA, and the
 * hamburger.
 *
 * The hamburger is rendered at EVERY breakpoint, not just on mobile. It is the
 * only route to the admin dashboard, the driver area and the language switch,
 * and hiding it behind a media query on desktop would make three working
 * operational entry points unreachable for the audience most likely to use
 * them. The marketing nav sits alongside it from `lg` rather than replacing it.
 *
 * `showBack` is preserved from the previous header for sub-pages such as the
 * quote form.
 */
export function GlobalHeader({ showBack = false }: { showBack?: boolean }) {
  const { copy } = useLocale();

  const nav = [
    { href: ROUTES.tyres, label: copy.navTyres },
    { href: ROUTES.howItWorks, label: copy.navHowItWorks },
    { href: ROUTES.why, label: copy.navWhy },
    { href: ROUTES.suppliers, label: copy.navSuppliers },
  ];

  // Solid white, and deliberately NO backdrop-blur.
  //
  // `backdrop-filter` makes an element the containing block for its
  // fixed-position descendants, so with a blur here the hamburger's
  // `fixed inset-0` panel resolved against this ~60px header strip instead of
  // the viewport -- it opened clipped underneath the hero. Any transform,
  // filter, perspective, contain or will-change on this element would do the
  // same thing. Do not add one.
  return (
    <header className="sticky top-0 z-40 border-b border-steel-soft bg-white">
      <div className="mx-auto flex w-full max-w-shell items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8 lg:py-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          {showBack && (
            <Link
              href={ROUTES.home}
              aria-label={copy.back}
              className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-steel text-ink-soft transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                <path
                  d="M12 4l-6 6 6 6"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          )}

          {/* The logo is always a link home, on every page. */}
          <Link
            href={ROUTES.home}
            aria-label={copy.siteName}
            className="min-w-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <Logo iconClassName="h-9 w-9 sm:h-11 sm:w-11" textClassName="text-lg sm:text-xl" />
          </Link>
        </div>

        {/* Marketing navigation, desktop only. Additive: the same destinations
            plus the operational ones stay in the hamburger. */}
        <nav aria-label={copy.footerNavTitle} className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex min-h-[40px] items-center rounded-lg px-3 text-[14.5px] font-semibold text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex flex-none items-center gap-2 sm:gap-3">
          {/*
            Visible at every breakpoint, including the narrowest phone. The
            header is sticky, so hiding this below `sm` meant that once a
            mobile visitor scrolled past the hero there was no way to register
            until the footer -- on the one surface where the brief asks for an
            obvious Register CTA. It shrinks rather than disappearing.
          */}
          <Link
            href={REGISTER_HREF}
            className={`${BUTTON_STYLES.primary} !min-h-[40px] !px-3 !text-[13.5px] sm:!px-4 sm:!text-[14.5px]`}
          >
            {copy.ctaRegister}
          </Link>
          <HamburgerMenu />
        </div>
      </div>
    </header>
  );
}

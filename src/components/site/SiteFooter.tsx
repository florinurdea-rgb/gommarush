"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { useLocale } from "@/components/site/LocaleProvider";
import { ROUTES, OPERATIONAL_ROUTES, REGISTER_HREF, CUSTOMER_ROUTES } from "@/lib/site-routes";

/**
 * The site footer.
 *
 * Deliberately incomplete, and honestly so. The brief asks to include existing
 * verified company and contact information and to retain existing privacy and
 * legal links -- but the public site has never had any: no registered address,
 * no VAT number, no telephone number, no privacy policy. Inventing a
 * plausible-looking "Via ... , P.IVA ..." would be fabricating legal identity,
 * which is worse than a footer that is short.
 *
 * So the legal row carries only the copyright line, and the slot for those
 * links is marked in the markup below. Adding them is one edit once the real
 * details exist.
 *
 * The access column links the operational entry points at their existing
 * routes. They are also in the hamburger; having them here as well is
 * deliberate, since a returning trade customer looks for "login" in a footer.
 */
export function SiteFooter() {
  const { copy } = useLocale();
  const year = new Date().getFullYear();

  const navLinks = [
    { href: ROUTES.tyres, label: copy.navTyres },
    { href: ROUTES.howItWorks, label: copy.navHowItWorks },
    { href: ROUTES.why, label: copy.navWhy },
    { href: ROUTES.suppliers, label: copy.navSuppliers },
  ];

  const accessLinks = [
    // The working customer entry leads, ahead of the registration funnel that
    // is not open yet.
    { href: CUSTOMER_ROUTES.account, label: copy.navClientArea },
    { href: REGISTER_HREF, label: copy.ctaRegister },
    { href: ROUTES.quote, label: copy.navQuote },
    // Existing operational routes. Never renamed here.
    { href: OPERATIONAL_ROUTES.admin, label: copy.navAdmin },
    { href: OPERATIONAL_ROUTES.driver, label: copy.navDriver },
  ];

  const linkClass =
    "inline-flex min-h-[32px] items-center text-[14.5px] text-ink-soft transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 rounded";

  return (
    <footer className="border-t border-steel-soft bg-surface-soft">
      <div className="mx-auto w-full max-w-shell px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <Logo iconClassName="h-10 w-10" textClassName="text-lg" />
            <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-ink-soft">
              {copy.footerTagline}
            </p>
          </div>

          <nav aria-labelledby="footer-nav-title">
            <h2
              id="footer-nav-title"
              className="text-[12px] font-bold uppercase tracking-[0.1em] text-ink"
            >
              {copy.footerNavTitle}
            </h2>
            <ul className="mt-4 flex flex-col gap-1">
              {navLinks.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-access-title">
            <h2
              id="footer-access-title"
              className="text-[12px] font-bold uppercase tracking-[0.1em] text-ink"
            >
              {copy.footerAccessTitle}
            </h2>
            <ul className="mt-4 flex flex-col gap-1">
              {accessLinks.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/*
          LEGAL ROW. The privacy policy, cookie policy, registered office and
          VAT number belong here. They are omitted rather than invented -- see
          the note at the top of this file.
        */}
        <div className="mt-12 flex flex-col gap-2 border-t border-steel-soft pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-ink-soft">
            &copy; {year} {copy.siteName}. {copy.footerRights}
          </p>
        </div>
      </div>
    </footer>
  );
}

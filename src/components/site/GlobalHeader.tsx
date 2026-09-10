"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { HamburgerMenu } from "@/components/site/HamburgerMenu";
import { useLocale } from "@/components/site/LocaleProvider";

/**
 * The public header: logo on the left, hamburger on the right, nothing else.
 * Used on every public page so navigation is identical everywhere.
 *
 * `showBack` adds a back control for sub-pages (the quote form), keeping the
 * logo as a permanent route home from anywhere.
 */
export function GlobalHeader({ showBack = false }: { showBack?: boolean }) {
  const { copy } = useLocale();

  return (
    <header className="border-b border-ink/10 bg-white">
      <div className="mx-auto flex w-full max-w-content items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          {showBack && (
            <Link
              href="/"
              aria-label={copy.back}
              className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-ink/15 text-ink-soft transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
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
            href="/"
            aria-label={copy.siteName}
            className="min-w-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <Logo
              iconClassName="h-10 w-10 sm:h-12 sm:w-12"
              textClassName="text-xl sm:text-2xl"
            />
          </Link>
        </div>

        <HamburgerMenu />
      </div>
    </header>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/site/LocaleProvider";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/locale";

/**
 * The single navigation control for every viewport — there is deliberately
 * no horizontal desktop nav bar. Everything lives behind this one button,
 * on phone and on a 1440px monitor alike.
 *
 * Accessibility work that is easy to get wrong and is done here explicitly:
 *   * the trigger owns aria-expanded / aria-controls
 *   * the panel is a labelled dialog
 *   * ESC closes, and focus returns to the trigger that opened it
 *   * Tab is trapped inside the panel while it's open
 *   * the page behind cannot scroll while the overlay is up
 *   * an outside click closes, but a click that STARTED inside and ended
 *     outside (a drag/selection) does not
 */

interface NavDestination {
  href: string;
  label: string;
}

export function HamburgerMenu() {
  const { locale, copy, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerDownInside = useRef(false);

  const destinations: NavDestination[] = [
    { href: "/", label: copy.navHome },
    { href: "/richiedi-offerta", label: copy.navQuote },
    { href: "/driver", label: copy.navDriver },
    { href: "/admin", label: copy.navAdmin },
  ];

  const close = useCallback(() => {
    setOpen(false);
    // Return focus to where the user was, not to the top of the document.
    triggerRef.current?.focus();
  }, []);

  // ESC to close + Tab trapping, bound only while open.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables || focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Lock background scrolling. Restores the previous value rather than
  // assuming it was "" — another overlay may already have set it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Move focus into the panel when it opens.
  useEffect(() => {
    if (!open) return;
    const firstLink = panelRef.current?.querySelector<HTMLElement>("a[href], button");
    firstLink?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="site-menu-panel"
        aria-label={open ? copy.menuClose : copy.menuOpen}
        className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-ink/15 bg-white text-ink transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        {/* Two bars that cross into an X — restrained, no bounce. */}
        <span aria-hidden="true" className="relative block h-4 w-5">
          <span
            className={`absolute left-0 block h-0.5 w-5 rounded-full bg-current transition-transform duration-200 ${
              open ? "top-1/2 -translate-y-1/2 rotate-45" : "top-0.5"
            }`}
          />
          <span
            className={`absolute left-0 block h-0.5 w-5 rounded-full bg-current transition-all duration-200 ${
              open ? "top-1/2 -translate-y-1/2 opacity-0" : "top-1/2 -translate-y-1/2 opacity-100"
            }`}
          />
          <span
            className={`absolute left-0 block h-0.5 w-5 rounded-full bg-current transition-transform duration-200 ${
              open ? "top-1/2 -translate-y-1/2 -rotate-45" : "bottom-0.5"
            }`}
          />
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-ink/40 backdrop-blur-[2px]"
          onPointerDown={(event) => {
            pointerDownInside.current = panelRef.current?.contains(event.target as Node) ?? false;
          }}
          onClick={(event) => {
            // Only a click that both started and ended on the backdrop closes.
            if (event.target === event.currentTarget && !pointerDownInside.current) close();
            pointerDownInside.current = false;
          }}
        >
          <div
            ref={panelRef}
            id="site-menu-panel"
            role="dialog"
            aria-modal="true"
            aria-label={copy.menuTitle}
            className="flex h-full w-full max-w-sm animate-[menu-in_180ms_ease-out] flex-col overflow-y-auto bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4">
              <span className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                {copy.menuTitle}
              </span>
              <button
                type="button"
                onClick={close}
                aria-label={copy.menuClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none">
                  <path
                    d="M5 5l10 10M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <nav aria-label={copy.menuTitle} className="flex flex-col gap-1 px-3 py-4">
              {destinations.map((destination) => (
                <Link
                  key={destination.href}
                  href={destination.href}
                  onClick={close}
                  className="rounded-lg px-4 py-3 text-base font-semibold text-ink transition-colors hover:bg-accent-light hover:text-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {destination.label}
                </Link>
              ))}
            </nav>

            <div className="mt-auto border-t border-ink/10 px-5 py-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                {copy.language}
              </div>
              <div role="group" aria-label={copy.language} className="flex gap-2">
                {LOCALES.map((option: Locale) => {
                  const active = option === locale;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setLocale(option)}
                      aria-pressed={active}
                      className={`min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        active
                          ? "border-accent bg-accent-light text-accent-dark"
                          : "border-ink/15 bg-white text-ink-soft hover:border-accent hover:text-accent"
                      }`}
                    >
                      {LOCALE_LABELS[option]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <style>{`
            @keyframes menu-in {
              from { transform: translateX(12px); opacity: 0; }
              to   { transform: translateX(0);    opacity: 1; }
            }
            @media (prefers-reduced-motion: reduce) {
              #site-menu-panel { animation: none !important; }
            }
          `}</style>
        </div>
      )}
    </>
  );
}

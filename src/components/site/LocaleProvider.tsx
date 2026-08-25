"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from "@/lib/i18n/locale";
import { getCopy, type SiteCopy } from "@/lib/i18n/site-content";

/**
 * Holds the active locale for the public surface.
 *
 * The initial value comes from the SERVER (read from the cookie in the root
 * layout), so the first paint is already in the right language — no flash of
 * Italian before switching to English.
 *
 * Switching writes the cookie and calls router.refresh() so server components
 * re-render with the new locale too. Local state updates immediately, so the
 * UI doesn't wait on the round trip.
 */

interface LocaleContextValue {
  locale: Locale;
  copy: SiteCopy;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      // SameSite=Lax keeps it on normal navigations; no Secure flag so it
      // still works on http://localhost during development.
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
      document.documentElement.lang = next;
      router.refresh();
    },
    [router]
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, copy: getCopy(locale), setLocale }),
    [locale, setLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Throws when used outside the provider rather than silently falling back to
 * Italian — a component rendering the wrong language is a bug worth surfacing
 * loudly in development.
 */
export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside <LocaleProvider>");
  return context;
}

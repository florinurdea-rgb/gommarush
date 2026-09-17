import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { LocaleProvider } from "@/components/site/LocaleProvider";
import { LOCALE_COOKIE, normaliseLocale } from "@/lib/i18n/locale";
import { getCopy } from "@/lib/i18n/site-content";

/**
 * Resolved per request from the locale cookie, so the tab title and the
 * description follow the language switch. These were fixed Italian strings,
 * which meant an English visitor still saw an Italian tab.
 *
 * The template stays outside the dictionary: "%s | GommaRush" is a brand
 * lockup, not prose, and reads the same in both languages.
 */
export async function generateMetadata(): Promise<Metadata> {
  const copy = getCopy(normaliseLocale(cookies().get(LOCALE_COOKIE)?.value));

  return {
    title: {
      default: copy.metaHomeTitle,
      template: "%s | GommaRush",
    },
    description: copy.metaHomeDesc,
    icons: {
      icon: "/images/logo.jpg",
    },
  };
}

/**
 * The locale is read from the cookie HERE, on the server, and handed to the
 * provider as its initial value — so the first HTML the browser receives is
 * already in the right language and `<html lang>` is correct for screen
 * readers. Anything unrecognised (or absent) falls back to Italian; the
 * browser's Accept-Language is deliberately never consulted.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = normaliseLocale(cookies().get(LOCALE_COOKIE)?.value);

  return (
    <html lang={locale}>
      <body>
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}

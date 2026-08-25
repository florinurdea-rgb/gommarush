import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { LocaleProvider } from "@/components/site/LocaleProvider";
import { LOCALE_COOKIE, normaliseLocale } from "@/lib/i18n/locale";

export const metadata: Metadata = {
  title: {
    default: "GommaRush | Fornitore di pneumatici per aziende a Verona",
    template: "%s | GommaRush",
  },
  description:
    "GommaRush fornisce pneumatici ad autofficine, gomme e aziende del settore automotive entro 50 km da Verona, con consegna in 24-48 ore.",
  icons: {
    icon: "/images/logo.jpg",
  },
};

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

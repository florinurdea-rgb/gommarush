import type { Metadata } from "next";

/**
 * Metadata lives in a route layout because the page itself is a client
 * component (it reads the locale from context), and a "use client" module
 * cannot export `metadata`.
 *
 * Written in Italian: it is the default locale and the one search engines will
 * index, since the language switch is a cookie rather than a separate URL.
 */
export const metadata: Metadata = {
  title: "Pneumatici",
  description:
    "Cerca lo pneumatico che ti serve e ordinalo da un solo partner. Prezzi B2B per gommisti e officine, con consegna in 48 ore o entro 7 giorni.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

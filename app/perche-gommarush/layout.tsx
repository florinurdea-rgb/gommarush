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
  title: "Perche GommaRush",
  description:
    "Ordini semplici, prezzi competitivi, piu disponibilita e tempi di consegna dichiarati prima di ordinare. Il partner con cui e piu semplice lavorare.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

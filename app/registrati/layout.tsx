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
  title: "Registrati",
  description:
    "Stiamo completando l'area riservata ai clienti professionali. Nel frattempo puoi richiedere un'offerta con prezzi e tempi di consegna.",
  // Not indexed: an interim page that will be replaced by the real funnel.
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

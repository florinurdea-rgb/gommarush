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
  title: "Come funziona",
  description:
    "Registrati, trova la misura, scegli prezzo e disponibilita, ordina e ricevi. Acquistare pneumatici per la tua attivita in pochi passaggi.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

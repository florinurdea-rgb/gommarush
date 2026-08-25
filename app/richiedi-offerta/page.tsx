import type { Metadata } from "next";
import { QuotePageShell } from "@/components/quote/QuotePageShell";

export const metadata: Metadata = {
  title: "Richiedi un'offerta",
  description:
    "Richiedi un'offerta per pneumatici e ricambi: aggiungi i prodotti che ti servono e ti inviamo la nostra migliore offerta.",
};

/**
 * The public quote-request page.
 *
 * The route is Italian (/richiedi-offerta) because Italian is the platform's
 * default language and its primary market; the English UI serves the same
 * route rather than duplicating it under a second path.
 */
export default function QuoteRequestPage() {
  return <QuotePageShell />;
}

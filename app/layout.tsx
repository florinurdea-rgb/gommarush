import type { Metadata } from "next";
import "./globals.css";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}

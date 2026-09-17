import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, normaliseLocale } from "@/lib/i18n/locale";
import { getCopy } from "@/lib/i18n/site-content";

/**
 * Metadata lives in a route layout because the page itself is a client
 * component (it reads the locale from context), and a "use client" module
 * cannot export `metadata`.
 *
 * Resolved per request from the locale cookie rather than hardcoded, so the
 * browser tab follows the language switch. It used to be a fixed Italian
 * string, which left the tab reading Italian on an otherwise English page.
 */
export async function generateMetadata(): Promise<Metadata> {
  const copy = getCopy(normaliseLocale(cookies().get(LOCALE_COOKIE)?.value));
  return {
    title: copy.metaRegisterTitle,
    description: copy.metaRegisterDesc,
    // Interim page, replaced by the real funnel.
    robots: { index: false, follow: true },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

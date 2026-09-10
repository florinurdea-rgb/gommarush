import { EN_STRINGS } from "@/lib/i18n/admin-strings.data";
import type { Locale } from "@/lib/i18n/logistics";

/**
 * Translation for operational strings written directly into components.
 *
 * The dashboard grew as a single-language product, so a few hundred strings
 * live in the JSX rather than in a keyed dictionary. Rather than invent a
 * key for each one — which would make every call site less readable and the
 * diff enormous — the ITALIAN TEXT IS THE KEY. `tr("Salva")` returns
 * "Salva" in Italian and "Save" in English.
 *
 * The trade-off is deliberate: a typo in the source string silently falls
 * back to Italian instead of failing at compile time. In exchange the JSX
 * still reads as the copy it renders, and adding a language is one data
 * file. `npm run test` covers the map for duplicate and empty entries.
 *
 * Anything not in the map falls through unchanged, so an untranslated
 * string shows Italian rather than a missing-key placeholder.
 */
export function translate(text: string, locale: Locale): string {
  if (locale === "it") return text;
  return EN_STRINGS[text] ?? text;
}

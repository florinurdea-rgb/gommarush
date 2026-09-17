/**
 * Site-wide locale primitives for the public/marketing surface.
 *
 * Deliberately separate from src/lib/i18n/logistics.ts, which is the
 * operational (warehouse/driver) dictionary and is Romanian-only by design —
 * that audience is internal staff, this one is Italian tyre shops.
 *
 * Italian is the default and the fallback. The browser's Accept-Language is
 * intentionally NOT consulted: an English-speaking visitor still gets Italian
 * until they choose otherwise, which is the stated business requirement.
 *
 * Storage is a plain cookie rather than localStorage so the SERVER can read
 * it while rendering. That is what keeps the first paint in the right
 * language instead of flashing Italian and then swapping to English.
 */

export const LOCALES = ["it", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "it";

/** Cookie name. Readable by JS (not httpOnly) — the switcher writes it client-side. */
export const LOCALE_COOKIE = "gr_locale";

/** One year: a returning visitor keeps the language they chose. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Never throws and never guesses — anything unrecognised becomes Italian. */
export function normaliseLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export const LOCALE_LABELS: Record<Locale, string> = {
  it: "Italiano",
  en: "English",
};

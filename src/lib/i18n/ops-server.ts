import "server-only";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, normaliseLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/logistics";

/**
 * The active locale for a SERVER component.
 *
 * Same source of truth as the client provider — the `gr_locale` cookie the
 * language switcher writes — read here directly because a server component
 * cannot subscribe to React context. Anything unrecognised falls back to
 * Italian, matching normaliseLocale.
 */
export function getOpsLocale(): Locale {
  return normaliseLocale(cookies().get(LOCALE_COOKIE)?.value) as Locale;
}

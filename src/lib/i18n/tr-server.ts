import "server-only";
import { getOpsLocale } from "@/lib/i18n/ops-server";
import { translate } from "@/lib/i18n/admin-strings";

/**
 * Server-component accessor for the operational string map. Reads the same
 * gr_locale cookie the switcher writes.
 */
export function getTr(): (text: string) => string {
  const locale = getOpsLocale();
  return (text: string) => translate(text, locale);
}

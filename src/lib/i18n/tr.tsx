"use client";

import { useCallback } from "react";
import { useLocale } from "@/components/site/LocaleProvider";
import { translate } from "@/lib/i18n/admin-strings";

/**
 * Client-side accessor for the operational string map. Bound to the live
 * locale, so a component calls tr("Salva") and gets the right language.
 */
export function useTr() {
  const { locale } = useLocale();
  return useCallback((text: string) => translate(text, locale), [locale]);
}

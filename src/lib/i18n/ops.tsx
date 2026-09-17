"use client";

import { useMemo } from "react";
import { useLocale } from "@/components/site/LocaleProvider";
import {
  errorMessage,
  incidentTypeLabel,
  itemTypeLabel,
  orderStatusMeta,
  scanTypeLabel,
  t,
  unitStatusMeta,
  type UiKey,
} from "@/lib/i18n/logistics";

/**
 * The operational dictionary, bound to the locale the user actually chose.
 *
 * Every function in i18n/logistics.ts takes an optional locale that defaults
 * to Italian. Calling them bare — `t("save")` — therefore always returned
 * Italian no matter what the language switcher said, which is exactly why
 * the dashboard only ever changed its menu labels. This hook closes over
 * the live locale from LocaleProvider so client components get the right
 * language without threading a parameter through every call site.
 *
 * Server components cannot use a hook; they read the cookie instead, via
 * getOpsLocale() in ./ops-server.ts.
 */
export function useOps() {
  const { locale } = useLocale();

  return useMemo(
    () => ({
      locale,
      t: (key: UiKey) => t(key, locale),
      orderStatusMeta: (status: string) => orderStatusMeta(status, locale),
      unitStatusMeta: (status: string) => unitStatusMeta(status, locale),
      itemTypeLabel: (type: string) => itemTypeLabel(type, locale),
      scanTypeLabel: (type: string) => scanTypeLabel(type, locale),
      incidentTypeLabel: (type: string) => incidentTypeLabel(type, locale),
      errorMessage: (code: string | null | undefined) => errorMessage(code, locale),
    }),
    [locale]
  );
}

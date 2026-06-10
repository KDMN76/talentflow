"use client";

import { I18nextProvider } from "react-i18next";
import { getI18nClient } from "@/lib/i18n/client";
import type { Locale } from "@talentflow/i18n";

/**
 * Maakt de gedeelde i18next-instance beschikbaar voor de hele app. `initialLocale`
 * komt server-side uit de taal-cookie (zie app/layout.tsx) zodat de server- en
 * client-render dezelfde taal gebruiken → geen hydration-mismatch.
 */
export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const i18n = getI18nClient(initialLocale);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

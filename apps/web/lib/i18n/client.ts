"use client";

import i18next, { type i18n as I18nType } from "i18next";
import { initReactI18next } from "react-i18next";
import { i18nInitOptions, FALLBACK_LOCALE, type Locale } from "@talentflow/i18n";

/**
 * Eén client-side i18next-instance, geïnitialiseerd met de gedeelde catalogs
 * uit `@talentflow/i18n`. Resources zitten inline (geen async backend), dus
 * `init()` is synchroon → `t()` werkt direct bij de eerste render.
 *
 * NB (hardening, later): voor Server-Component-vertaling is een per-request
 * instance nodig; deze module-singleton is voldoende voor de (overwegend
 * client-side) dashboard-app. Zie de i18n-spec, risico "Server Components".
 */
let initialized = false;

export function getI18nClient(lng: Locale = FALLBACK_LOCALE): I18nType {
  if (!initialized) {
    void i18next.use(initReactI18next).init(i18nInitOptions(lng));
    initialized = true;
  } else if (i18next.language !== lng) {
    void i18next.changeLanguage(lng);
  }
  return i18next;
}

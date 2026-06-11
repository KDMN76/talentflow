/**
 * @talentflow/i18n — gedeelde i18next-config + vertaalcatalogs.
 *
 * Framework-agnostisch: exporteert alleen plain resources + i18next-opties en
 * types. De web-app (react-i18next) en de toekomstige React Native-app maken
 * elk hun eigen i18next-instance met deze gedeelde input, zodat één set
 * vertalingen beide platforms voedt.
 *
 * Een taal toevoegen:
 *   1. maak `locales/<code>/*.json` (kopie van de NL-structuur, vertaald),
 *   2. importeer + registreer ze hieronder in `resources` en `SUPPORTED_LOCALES`.
 * Geen verdere code-wijzigingen nodig.
 */

import nlCommon from "../locales/nl/common.json";
import enCommon from "../locales/en/common.json";
import nlAuth from "../locales/nl/auth.json";
import enAuth from "../locales/en/auth.json";
import nlDashboard from "../locales/nl/dashboard.json";
import enDashboard from "../locales/en/dashboard.json";
import nlJobs from "../locales/nl/jobs.json";
import enJobs from "../locales/en/jobs.json";
import nlCandidates from "../locales/nl/candidates.json";
import enCandidates from "../locales/en/candidates.json";
import nlPipeline from "../locales/nl/pipeline.json";
import enPipeline from "../locales/en/pipeline.json";
import nlInterviews from "../locales/nl/interviews.json";
import enInterviews from "../locales/en/interviews.json";
import nlCrmPage from "../locales/nl/crmPage.json";
import enCrmPage from "../locales/en/crmPage.json";
import nlComms from "../locales/nl/comms.json";
import enComms from "../locales/en/comms.json";
import nlHm from "../locales/nl/hm.json";
import enHm from "../locales/en/hm.json";

export const SUPPORTED_LOCALES = ["nl", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Taal waarop we terugvallen als een sleutel/locale ontbreekt. */
export const FALLBACK_LOCALE: Locale = "nl";

/** Default namespace (gedeelde labels: navigatie, knoppen). */
export const DEFAULT_NS = "common";

/** Menselijke labels voor de taalkiezer. */
export const LOCALE_LABELS: Record<Locale, string> = {
  nl: "Nederlands",
  en: "English",
};

/**
 * Alle catalogs per taal/namespace. Bij een nieuwe namespace: voeg het JSON-
 * bestand toe aan ELKE taal en registreer het hier.
 */
export const resources = {
  nl: {
    common: nlCommon,
    auth: nlAuth,
    dashboard: nlDashboard,
    jobs: nlJobs,
    candidates: nlCandidates,
    pipeline: nlPipeline,
    interviews: nlInterviews,
    crmPage: nlCrmPage,
    comms: nlComms,
    hm: nlHm,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    dashboard: enDashboard,
    jobs: enJobs,
    candidates: enCandidates,
    pipeline: enPipeline,
    interviews: enInterviews,
    crmPage: enCrmPage,
    comms: enComms,
    hm: enHm,
  },
} as const;

/** Lijst van geregistreerde namespaces (afgeleid van de NL-resources). */
export const NAMESPACES = Object.keys(resources.nl) as Array<keyof typeof resources.nl>;

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Gedeelde i18next-init-opties. Web/mobiel voegen hun eigen binding toe
 * (`initReactI18next`) en geven dit als basis mee aan `.init()`.
 */
export function i18nInitOptions(lng: Locale = FALLBACK_LOCALE) {
  return {
    resources,
    lng,
    fallbackLng: FALLBACK_LOCALE,
    defaultNS: DEFAULT_NS,
    ns: NAMESPACES as string[],
    interpolation: { escapeValue: false },
    returnNull: false as const,
  };
}

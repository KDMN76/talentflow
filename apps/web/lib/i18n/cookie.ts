import { isSupportedLocale, FALLBACK_LOCALE, type Locale } from "@talentflow/i18n";

/** Cookie waarin de actieve UI-taal staat (client-cache van de voorkeur). */
export const LOCALE_COOKIE = "tf_lang";

/** 1 jaar — de taalkeuze is plakkerig tot de gebruiker hem wijzigt. */
const ONE_YEAR = 60 * 60 * 24 * 365;

export function parseLocale(value: string | undefined | null): Locale {
  return isSupportedLocale(value) ? value : FALLBACK_LOCALE;
}

/**
 * Bepaalt de initiële taal voor de eerste server-render:
 *   1. cookie (eerder gekozen / door login geseed),
 *   2. Accept-Language van de browser (eerste ondersteunde primary tag),
 *   3. NL-fallback.
 * De user→tenant-resolutie gebeurt daarna client-side zodra /users/me geladen
 * is (useLanguageSync) — die data is op de eerste render nog niet beschikbaar.
 */
export function resolveInitialLocale(
  cookieValue: string | undefined | null,
  acceptLanguage: string | undefined | null
): Locale {
  if (isSupportedLocale(cookieValue)) return cookieValue;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const primary = part.split(";")[0]?.trim().split("-")[0]?.toLowerCase();
    if (isSupportedLocale(primary)) return primary;
  }
  return FALLBACK_LOCALE;
}

/** Zet de taal-cookie client-side (zodat de volgende server-render hem ziet). */
export function setLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

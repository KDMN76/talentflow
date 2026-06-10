"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { isSupportedLocale } from "@talentflow/i18n";
import { setLocaleCookie } from "@/lib/i18n/cookie";
import { useCurrentUser } from "@/hooks/useUsers";

/**
 * Past de opgeslagen taalvoorkeur (users.language → tenants.default_language)
 * toe zodra /users/me binnen is. Draait maximaal één keer per page-load:
 * daarna is de cookie leidend en mag een handmatige switch (LanguageSwitcher)
 * nooit teruggevochten worden door verlate/gecachte user-data.
 */
export function useLanguageSync(): void {
  const { i18n } = useTranslation();
  const { data: user } = useCurrentUser();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current || !user) return;
    applied.current = true;

    const preferred = user.language ?? user.tenant_default_language;
    if (isSupportedLocale(preferred) && preferred !== i18n.language) {
      setLocaleCookie(preferred);
      void i18n.changeLanguage(preferred);
    }
  }, [user, i18n]);
}

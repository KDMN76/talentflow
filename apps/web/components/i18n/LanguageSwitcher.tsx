"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { SUPPORTED_LOCALES, isSupportedLocale, type Locale } from "@talentflow/i18n";
import { setLocaleCookie } from "@/lib/i18n/cookie";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Taalkiezer (NL/EN/…). Wisselt de UI direct via i18next, bewaart de keuze in
 * een cookie (volgende server-render) én persisteert naar het profiel
 * (users.language) zodat de voorkeur op elk apparaat geldt.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const current: Locale = isSupportedLocale(i18n.language) ? i18n.language : "nl";

  const change = (loc: Locale) => {
    if (loc === current) return;
    setLocaleCookie(loc);
    void i18n.changeLanguage(loc);
    // Cache direct bijwerken zodat useLanguageSync bij een remount nooit met
    // verouderde user-data terugwisselt; daarna best-effort persisteren.
    queryClient.setQueryData(["users", "me"], (old: unknown) =>
      old && typeof old === "object" ? { ...old, language: loc } : old
    );
    api.patch("/users/me", { language: loc }).catch(() => {
      // Stil falen is hier OK: cookie + i18next zijn al omgezet; bij de
      // volgende sessie geldt dan de oude server-voorkeur.
    });
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border border-border p-0.5",
        className
      )}
      role="group"
      aria-label="Taal"
    >
      <Globe className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {SUPPORTED_LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => change(loc)}
          aria-pressed={current === loc}
          className={cn(
            "rounded-md px-2 py-1 text-[11px] font-semibold uppercase transition-colors",
            current === loc
              ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400"
              : "text-muted-foreground hover:text-zinc-900 dark:hover:text-zinc-100"
          )}
        >
          {loc}
        </button>
      ))}
    </div>
  );
}

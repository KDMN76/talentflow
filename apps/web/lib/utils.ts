import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import i18next from "i18next";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Datums volgen de actieve UI-taal (i18next-singleton). Op de server of vóór
// i18n-init is `language` leeg → val terug op NL (zelfde gedrag als voorheen).
// Componenten die deze helpers gebruiken re-renderen bij een taalwissel via
// hun eigen useTranslation-hook, dus de output wisselt netjes mee.
function activeLocale(): string {
  return i18next.language || "nl";
}

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(activeLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatRelativeDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // `numeric: "auto"` levert "vandaag"/"gisteren" (nl) en "today"/"yesterday"
  // (en) — identiek aan de oude hardcoded NL-copy.
  const rtf = new Intl.RelativeTimeFormat(activeLocale(), { numeric: "auto" });
  if (diffDays <= 0) return rtf.format(0, "day");
  if (diffDays === 1) return rtf.format(-1, "day");
  if (diffDays < 7) return rtf.format(-diffDays, "day");
  if (diffDays < 30) return rtf.format(-Math.floor(diffDays / 7), "week");
  if (diffDays < 365) return rtf.format(-Math.floor(diffDays / 30), "month");
  return rtf.format(-Math.floor(diffDays / 365), "year");
}

export function getInitials(name: string | null | undefined): string {
  // Null-safe: records zonder gekoppelde recruiter/user (recruiter_id NULL)
  // crashten met `Cannot read properties of null (reading 'split')`.
  if (!name) return "?";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return initials || "?";
}

export function getScoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600 bg-emerald-50";
  if (score >= 60) return "text-amber-600 bg-amber-50";
  return "text-red-600 bg-red-50";
}

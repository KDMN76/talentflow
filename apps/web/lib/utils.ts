import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("nl-NL", {
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

  if (diffDays === 0) return "Vandaag";
  if (diffDays === 1) return "Gisteren";
  if (diffDays < 7) return `${diffDays} dagen geleden`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weken geleden`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} maanden geleden`;
  return `${Math.floor(diffDays / 365)} jaar geleden`;
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

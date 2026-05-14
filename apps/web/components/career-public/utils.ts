/**
 * Helpers shared across public career-page components — Sprint Q2.2.
 */

import type { Locale, PublicBranding, PublicJob } from "./types";

export function formatSalary(
  job: Pick<PublicJob, "salary_min" | "salary_max" | "salary_currency">,
  locale: Locale
): string | null {
  const { salary_min: min, salary_max: max } = job;
  if (!min && !max) return null;

  const currency = job.salary_currency || "EUR";
  const localeTag = locale === "en" ? "en-GB" : "nl-NL";
  const fmt = (n: number) =>
    new Intl.NumberFormat(localeTag, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);

  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return locale === "en" ? `From ${fmt(min)}` : `Vanaf ${fmt(min)}`;
  if (max) return locale === "en" ? `Up to ${fmt(max)}` : `Tot ${fmt(max)}`;
  return null;
}

export function employmentTypeLabel(
  value: string | null | undefined,
  locale: Locale
): string | null {
  if (!value) return null;
  const map: Record<string, { nl: string; en: string }> = {
    fulltime: { nl: "Fulltime", en: "Full-time" },
    parttime: { nl: "Parttime", en: "Part-time" },
    contract: { nl: "Contract", en: "Contract" },
    temporary: { nl: "Tijdelijk", en: "Temporary" },
    internship: { nl: "Stage", en: "Internship" },
    freelance: { nl: "Freelance", en: "Freelance" },
  };
  const entry = map[value.toLowerCase()];
  if (entry) return entry[locale];
  return value;
}

/**
 * Build a `style` string for the `<style>` tag injected into <head> so
 * blocks can use `var(--brand-primary)` etc.
 *
 * Uses CSS custom properties on `:root` so they cascade everywhere
 * including portals (radix dialogs).
 */
export function buildBrandingCss(branding: PublicBranding): string {
  const primary = sanitizeColor(branding.primary_color) ?? "#6366f1";
  const accent = sanitizeColor(branding.accent_color) ?? primary;
  const fontFamily = sanitizeFontFamily(branding.font_family);

  return `:root{--brand-primary:${primary};--brand-accent:${accent};${
    fontFamily ? `--brand-font:${fontFamily};` : ""
  }}body{${fontFamily ? `font-family:${fontFamily};` : ""}}`;
}

/**
 * Allow only `#rrggbb`, `#rgb`, `rgb(...)`, `rgba(...)` and `hsl(...)`
 * colour notations — anything else is silently dropped to avoid CSS
 * injection through tenant-controlled branding.
 */
export function sanitizeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.test(v))
    return v;
  if (/^hsla?\(\s*\d{1,3}(\s*,\s*\d{1,3}%){2}(\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.test(v))
    return v;
  return null;
}

/**
 * Permit a comma-separated list of font names and generic family
 * keywords. Disallow anything containing `;`, `{`, `}`, `<`, `>` or
 * url() to prevent stylesheet escape.
 */
export function sanitizeFontFamily(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v || /[<>{};]|url\(/i.test(v)) return null;
  return v;
}

/**
 * Best-effort sanitiser for tenant-controlled HTML used inside the
 * `custom_html` block. We strip <script>, <iframe>, on*-handlers and
 * `javascript:` URLs. This is a defence-in-depth layer — the backend
 * MUST also sanitise on save (DOMPurify in the builder).
 *
 * Pure-JS implementation so it works in Server Components (no DOM).
 */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  let out = html;
  // Remove <script>...</script> and <style>...</style> entirely
  out = out.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  out = out.replace(/<\s*style[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, "");
  out = out.replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, "");
  out = out.replace(/<\s*object[^>]*>[\s\S]*?<\s*\/\s*object\s*>/gi, "");
  out = out.replace(/<\s*embed[^>]*>/gi, "");
  // Strip on* event handlers
  out = out.replace(/\son[a-z]+\s*=\s*"(?:\\.|[^"])*"/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*'(?:\\.|[^'])*'/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
  // Strip javascript: URLs
  out = out.replace(/(href|src|action)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"');
  out = out.replace(/(href|src|action)\s*=\s*'\s*javascript:[^']*'/gi, "$1='#'");
  return out;
}

export function getBrandName(branding: PublicBranding): string {
  return branding.brand_name?.trim() || "Careers";
}

/**
 * Convert raw plain-text job descriptions into safe paragraphs. We split
 * on double newlines for paragraphs and single newlines into <br/>.
 */
export function plainTextToHtml(text: string): string {
  return text
    .split(/\n\n+/)
    .map(
      (para) =>
        `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`
    )
    .join("");
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

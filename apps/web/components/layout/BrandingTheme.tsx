"use client";

/**
 * BrandingTheme — past de tenant-accentkleur toe als CSS-vars op :root.
 *
 * Zet (alleen wanneer de tenant een geldige accent_color heeft):
 *   --brand-accent            de accentkleur (hex, zelfde conventie als het
 *                             klantportaal — zie app/portal/[token]/layout.tsx)
 *   --brand-accent-foreground contrast-gevalideerde tekstkleur erop (wit of
 *                             donker, WCAG-relative-luminance — lib/color.ts)
 *
 * De fallback-waarden staan in globals.css; zonder tenant-accent worden de
 * properties verwijderd zodat de CSS-defaults gelden. Consumers gebruiken de
 * Tailwind-tokens `bg-brand-accent` / `text-brand-accent-foreground`
 * (tailwind.config.ts) of direct `var(--brand-accent)`.
 *
 * Rendert zelf niets; wordt gemount in de dashboard-layout.
 */

import { useEffect } from "react";
import { useTenantBranding } from "@/hooks/useTenantBranding";
import { bestForegroundFor, isHexColor } from "@/lib/color";

export function BrandingTheme() {
  const { data: branding } = useTenantBranding();
  const accent = branding?.accent_color ?? null;

  useEffect(() => {
    const root = document.documentElement;
    if (accent && isHexColor(accent)) {
      root.style.setProperty("--brand-accent", accent);
      root.style.setProperty("--brand-accent-foreground", bestForegroundFor(accent));
    } else {
      root.style.removeProperty("--brand-accent");
      root.style.removeProperty("--brand-accent-foreground");
    }
    return () => {
      root.style.removeProperty("--brand-accent");
      root.style.removeProperty("--brand-accent-foreground");
    };
  }, [accent]);

  return null;
}

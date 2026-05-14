/**
 * Portal layout — white-label root voor de klant-facing portaal-pagina's.
 *
 * Nota bene: het echte <html>/<body>-element wordt door `app/layout.tsx`
 * gerenderd (Next.js App Router laat slechts één root-layout toe). We injecteren
 * branding hier via:
 *   1. `generateMetadata`  — zet title + favicon + robots: noindex/nofollow
 *   2. Een inline <style>  — schrijft `--brand-primary` / `--brand-accent`
 *      CSS-vars in de scope van de portal-page (geërfd door alle children)
 *   3. PortalHeader / PortalFooter — geen TalentFlow-branding standaard.
 *
 * Branding wordt server-side opgehaald (geen flash-of-default-style). Bij
 * netwerk-fout valt het terug op default-branding zodat de pagina altijd rendert.
 */

import type { Metadata } from "next";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { PortalFooter } from "@/components/portal/PortalFooter";
import {
  fetchPortalBrandingServer,
  PORTAL_BRANDING_DEFAULTS,
} from "@/hooks/usePortal";

interface LayoutProps {
  children: React.ReactNode;
  params: { token: string };
}

export async function generateMetadata({
  params,
}: {
  params: { token: string };
}): Promise<Metadata> {
  const branding = await fetchPortalBrandingServer(params.token);
  return {
    title: branding.brand_name ?? "Recruitment portaal",
    description: "Vertrouwelijke kandidaten-shortlist",
    robots: {
      index: false,
      follow: false,
      noarchive: true,
      nosnippet: true,
      noimageindex: true,
    },
    icons: branding.favicon_url
      ? [{ rel: "icon", url: branding.favicon_url }]
      : undefined,
  };
}

export default async function PortalLayout({ children, params }: LayoutProps) {
  const branding = await fetchPortalBrandingServer(params.token);
  const primary =
    branding.primary_color ?? PORTAL_BRANDING_DEFAULTS.primary_color ?? "#6366f1";
  const accent =
    branding.accent_color ?? PORTAL_BRANDING_DEFAULTS.accent_color ?? "#8b5cf6";

  // CSS-variables binnen de scope van het portaal — child-componenten gebruiken
  // var(--brand-primary) / var(--brand-accent) voor knoppen en accenten.
  const styleTag = `
    [data-portal-scope="true"] {
      --brand-primary: ${primary};
      --brand-accent: ${accent};
    }
  `;

  return (
    <div
      data-portal-scope="true"
      className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950"
    >
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: styleTag }} />
      <PortalHeader
        brandName={branding.brand_name}
        logoUrl={branding.logo_url}
        showPoweredBy={branding.show_powered_by}
      />
      <main className="flex-1">{children}</main>
      <PortalFooter
        brandName={branding.brand_name}
        showPoweredBy={branding.show_powered_by}
      />
    </div>
  );
}

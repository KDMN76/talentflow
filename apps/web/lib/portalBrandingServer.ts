/**
 * Server-side portal branding fetch — extracted from `hooks/usePortal.ts`
 * because Next.js App Router Server Components (like `app/portal/[token]/layout.tsx`)
 * cannot import from `"use client"` modules.
 *
 * The implementation mirrors the equivalents in `usePortal.ts`. Both stay
 * in sync because they hit the same backend endpoint and use the same
 * default fallbacks.
 */

export interface PortalBrandingServer {
  brand_name: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  show_powered_by: boolean;
}

const SERVER_API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:4000/api";

const DEFAULT_BRANDING_SERVER: PortalBrandingServer = {
  brand_name: null,
  logo_url: null,
  favicon_url: null,
  primary_color: "#6366f1",
  accent_color: "#8b5cf6",
  show_powered_by: true,
};

export const PORTAL_BRANDING_DEFAULTS: PortalBrandingServer = DEFAULT_BRANDING_SERVER;

function normalizeBrandingServer(raw: unknown): PortalBrandingServer {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BRANDING_SERVER };
  const r = raw as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
  return {
    brand_name: str("brand_name"),
    logo_url: str("logo_url"),
    favicon_url: str("favicon_url"),
    primary_color: str("primary_color") ?? DEFAULT_BRANDING_SERVER.primary_color,
    accent_color: str("accent_color") ?? DEFAULT_BRANDING_SERVER.accent_color,
    show_powered_by:
      typeof r["show_powered_by"] === "boolean"
        ? (r["show_powered_by"] as boolean)
        : true,
  };
}

/**
 * Fetch portal branding server-side. Never throws — falls back to defaults
 * on any failure so the portal page always renders.
 */
export async function fetchPortalBrandingServer(
  token: string
): Promise<PortalBrandingServer> {
  if (!token) return { ...DEFAULT_BRANDING_SERVER };
  try {
    const res = await fetch(`${SERVER_API_BASE}/portals/branding/${token}`, {
      cache: "no-store",
    });
    if (!res.ok) return { ...DEFAULT_BRANDING_SERVER };
    const data = (await res.json()) as unknown;
    // API antwoordt { branding: {...}, client_name } — unwrap indien genest.
    const branding =
      data && typeof data === "object" && "branding" in (data as object)
        ? (data as { branding?: unknown }).branding
        : data;
    return normalizeBrandingServer(branding);
  } catch {
    return { ...DEFAULT_BRANDING_SERVER };
  }
}

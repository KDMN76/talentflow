import { NextResponse, type NextRequest } from "next/server";
import {
  buildCareerPath,
  getAppHosts,
  isAppHost,
  normalizeHost,
} from "@/lib/customDomain";

/**
 * White-label custom-domain serving.
 *
 * Een tenant koppelt een eigen (sub)domein aan één gepubliceerde career-page.
 * Een verzoek op zo'n domein wordt geREDIRECT naar de bestaande route
 * `/careers/<slug>`. Bewust een redirect (geen onzichtbare rewrite): bij een
 * rewrite blijft de browser-URL "/" en dan koppelt de Next.js CLIENT-router die
 * aan de `(dashboard)`-route-groep (want `/` en `/jobs` zijn dashboard-routes),
 * waardoor de auth-guard alsnog naar /login navigeert. Door naar de échte route
 * `/careers/<slug>` te redirecten matcht de client-router meteen de career-tree
 * → geen /login, geen hydration-mismatch. De bezoeker blijft op het eigen
 * domein (werkenbij.kdmn.nl/careers/<slug>).
 *
 * App-eigen hosts (dashboard/API) passeren ongemoeid. De matcher (onderaan)
 * sluit /_next, /api, static assets, favicon en robots uit.
 *
 * Defensief: fetch-timeout, negatief cachen en nooit throwen — een resolve-fout
 * valt terug op de normale flow.
 */

const APP_HOSTS = getAppHosts({
  NEXT_PUBLIC_APP_HOSTS: process.env.NEXT_PUBLIC_APP_HOSTS,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

// Resolve-base = de PUBLIEKE API-URL (NEXT_PUBLIC_API_URL). Bewust niet
// request.nextUrl.origin: achter nginx geeft die in de Edge-runtime de INTERNE
// origin (http://localhost:3000 = de web-container zelf) → /api daar is 404 →
// resolve mislukt → geen redirect → "/" valt terug op de dashboard-tree →
// /login. NEXT_PUBLIC_* wordt wél build-time in de Edge-bundle geïnlined en de
// container kan de publieke API-host bereiken.
const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api"
).replace(/\/$/, "");

// Module-level cache host → slug|null (negatief cachen voorkomt hammering van
// de API bij bots/onbekende hosts). ~60s TTL.
const CACHE_TTL_MS = 60_000;
const slugCache = new Map<string, { slug: string | null; expires: number }>();

async function resolveHostToSlug(host: string): Promise<string | null> {
  const now = Date.now();
  const cached = slugCache.get(host);
  if (cached && cached.expires > now) return cached.slug;

  let slug: string | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(
      `${API_BASE}/career-pages/public/resolve-domain?host=${encodeURIComponent(host)}`,
      { signal: controller.signal, headers: { accept: "application/json" } }
    );
    clearTimeout(timeout);
    if (res.ok) {
      const data = (await res.json()) as { slug?: unknown };
      if (data && typeof data.slug === "string" && data.slug) {
        slug = data.slug;
      }
    }
  } catch {
    // timeout / netwerkfout / API down → geen match, val terug op normale flow
    slug = null;
  }
  slugCache.set(host, { slug, expires: now + CACHE_TTL_MS });
  return slug;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const host = normalizeHost(
    request.headers.get("host") ?? request.nextUrl.hostname
  );

  // App-eigen host (dashboard) → niets doen.
  if (isAppHost(host, APP_HOSTS)) {
    return NextResponse.next();
  }

  // Custom domein: resolve host → slug. Geen match/fout → normale flow.
  const slug = await resolveHostToSlug(host);
  if (!slug) {
    return NextResponse.next();
  }

  const target = buildCareerPath(slug);
  const path = request.nextUrl.pathname;

  // Al op de eigen career-route (of een subpad ervan)? Gewoon renderen.
  if (path === target || path.startsWith(`${target}/`)) {
    return NextResponse.next();
  }

  // Alle andere paden (/, /jobs, /careers/andere-slug, …) → redirect naar de
  // eigen career-route. Zo blijft het custom domein aan één career-page vast
  // (een bezoeker kan niet naar de career-page van een andere tenant) en matcht
  // de client-router de juiste route.
  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.redirect(url);
}

export const config = {
  // Alleen "echte" paginapaden lopen door de middleware. Uitgesloten:
  //   _next/*        → build-output + image optimizer
  //   api/*          → (proxy)-API-routes
  //   favicon/robots/sitemap/sw/manifest en elk pad met een bestandsextensie
  matcher: [
    "/",
    "/((?!_next/|api/|favicon.ico|robots.txt|sitemap.xml|sw.js|manifest.json|.*\\.[\\w]+$).*)",
  ],
};

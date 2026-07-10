import { NextResponse, type NextRequest } from "next/server";
import {
  buildRewritePath,
  getAppHosts,
  isAppHost,
  normalizeHost,
  CAREER_SLUG_HEADER,
} from "@/lib/customDomain";

/**
 * White-label custom-domain serving.
 *
 * Een tenant koppelt een eigen (sub)domein aan een gepubliceerde career-page.
 * Requests op zo'n domein worden server-side geREWRITE (geen redirect — de URL
 * blijft het eigen domein tonen) naar de bestaande /careers/<slug>-tree, zodat
 * er één bron van waarheid is voor de render (blokken, salarisband, AI-
 * disclosure).
 *
 * App-eigen hosts (dashboard/API) passeren ongemoeid. De matcher (onderaan)
 * sluit /_next, /api, static assets, favicon en robots uit — die mogen NOOIT
 * gerewrite worden, anders breekt de hele app.
 *
 * Defensief: fetch-timeout, negatief cachen en nooit throwen — een resolve-fout
 * valt terug op de normale flow (NextResponse.next → normale 404).
 */

const APP_HOSTS = getAppHosts({
  NEXT_PUBLIC_APP_HOSTS: process.env.NEXT_PUBLIC_APP_HOSTS,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

// Module-level cache host → slug|null (negatief cachen voorkomt hammering van
// de API bij bots/onbekende hosts). ~60s TTL.
const CACHE_TTL_MS = 60_000;
const slugCache = new Map<string, { slug: string | null; expires: number }>();

async function resolveHostToSlug(
  origin: string,
  host: string
): Promise<string | null> {
  const now = Date.now();
  const cached = slugCache.get(host);
  if (cached && cached.expires > now) return cached.slug;

  let slug: string | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    // Resolve via de EIGEN origin van het request (bv. https://werkenbij.kdmn.nl):
    // de nginx-vhost van elk custom domein proxyt /api/ naar de api-container, en
    // de matcher hieronder sluit /api/ uit (dus geen middleware-loop). Env-vrij —
    // Next inlinet in de Edge-runtime alleen NEXT_PUBLIC_-vars, dus een aparte
    // resolve-env zou toch niet aankomen.
    const res = await fetch(
      `${origin}/api/career-pages/public/resolve-domain?host=${encodeURIComponent(host)}`,
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

  // Anti-spoofing: verwijder ALTIJD een eventueel door de client meegestuurde
  // career-slug-header. Alleen deze middleware mag hem zetten; anders zou een
  // request naar een app-host met een verzonnen header de app-tree kunnen laten
  // vervangen door een career-page.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(CAREER_SLUG_HEADER);

  // App-eigen host (dashboard) → niets rewriten (wel de gestripte header
  // doorzetten).
  if (isAppHost(host, APP_HOSTS)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Custom domein: resolve host → slug en rewrite. Geen match/fout → normale
  // flow (val terug op 404 van de app).
  const slug = await resolveHostToSlug(request.nextUrl.origin, host);
  if (!slug) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Zet de opgeloste slug als header zodat de root-layout hem server-side kan
  // lezen en de host-gate de career-page rechtstreeks rendert (los van de
  // client-router-resolutie van "/").
  requestHeaders.set(CAREER_SLUG_HEADER, slug);

  const url = request.nextUrl.clone();
  url.pathname = buildRewritePath(slug);
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export const config = {
  // Alleen "echte" paginapaden lopen door de middleware. Uitgesloten:
  //   _next/*        → build-output + image optimizer
  //   api/*          → (proxy)-API-routes
  //   favicon/robots/sitemap/sw/manifest en elk pad met een bestandsextensie
  // Zonder deze exclusions zou /_next en /api ook rewriten → de hele app breekt.
  matcher: [
    // De root expliciet: de negatieve-lookahead-matcher hieronder matcht "/"
    // niet (bekende Next.js-gotcha) → zonder deze regel zou het custom domein
    // op de homepage terugvallen op app-gedrag (redirect naar /dashboard).
    "/",
    "/((?!_next/|api/|favicon.ico|robots.txt|sitemap.xml|sw.js|manifest.json|.*\\.[\\w]+$).*)",
  ],
};

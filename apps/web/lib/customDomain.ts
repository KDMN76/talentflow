/**
 * Custom-domain helpers voor de Next.js middleware (white-label career-page
 * serving). Puur + framework-vrij (geen `next/server`-import) zodat ze los
 * unit-testbaar zijn — de middleware zelf compose't deze met `fetch`.
 */

/**
 * Interne request-header waarmee de middleware de opgeloste career-slug aan de
 * server-side render doorgeeft. De root-layout leest deze via `next/headers`
 * en de host-gate rendert daarmee de career-page rechtstreeks. De middleware
 * STRIPT elke door de client meegestuurde variant (anti-spoofing) en zet hem
 * alleen zelf op een échte custom-domein-request.
 */
export const CAREER_SLUG_HEADER = "x-tf-career-slug";

/**
 * Normaliseer een hostnaam: lowercase, strip pad/query/fragment, poort en
 * trailing dot. Retourneert "" als er niets bruikbaars overblijft.
 */
export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return "";
  let host = String(raw).trim().toLowerCase();
  if (!host) return "";
  host = host.split("/")[0].split("?")[0].split("#")[0];
  host = host.split(":")[0]; // strip poort
  host = host.replace(/\.+$/, ""); // strip trailing dot
  return host;
}

/**
 * App-eigen hosts (dashboard/API) die NIET naar een career-page rewriten.
 * Afgeleid uit env: expliciete NEXT_PUBLIC_APP_HOSTS (komma-lijst) + de host
 * van NEXT_PUBLIC_API_URL + loopback. Env wordt als argument meegegeven zodat
 * de functie puur/testbaar blijft.
 */
export function getAppHosts(env: {
  NEXT_PUBLIC_APP_HOSTS?: string;
  NEXT_PUBLIC_API_URL?: string;
}): Set<string> {
  const hosts = new Set<string>(["localhost", "127.0.0.1"]);
  if (env.NEXT_PUBLIC_APP_HOSTS) {
    for (const part of env.NEXT_PUBLIC_APP_HOSTS.split(",")) {
      const h = normalizeHost(part);
      if (h) hosts.add(h);
    }
  }
  if (env.NEXT_PUBLIC_API_URL) {
    try {
      const u = new URL(env.NEXT_PUBLIC_API_URL);
      const h = normalizeHost(u.host);
      if (h) hosts.add(h);
    } catch {
      // negeer onparsebare URL
    }
  }
  return hosts;
}

/**
 * Is `hostname` een app-eigen host (dus géén custom career-domain)? Een lege
 * host wordt als app-host behandeld (veilig: geen rewrite).
 */
export function isAppHost(hostname: string, appHosts: Set<string>): boolean {
  const h = normalizeHost(hostname);
  if (!h) return true;
  return appHosts.has(h);
}

/**
 * Bouw het server-side rewrite-pad voor een custom-domein-request.
 *
 * Een white-label domein is aan precies ÉÉN career-page gekoppeld en is een
 * single-page site, dus ELK pad (`/`, `/jobs`, `/privacy`, …) rewrite't naar
 * dezelfde bestaande route `/careers/<slug>`. Voordelen:
 *   - de route bestaat → HTTP 200 op alle subpaden (geen 404 op /jobs of
 *     /privacy, wat bij per-pad-prefixen wél gebeurde omdat er geen
 *     /careers/<slug>/<sub>-routes zijn);
 *   - een bezoeker kan op het custom domein niet naar de career-page van een
 *     ándere tenant navigeren (bv. /careers/andere-slug) — alles valt terug op
 *     de eigen slug.
 *
 * De uiteindelijke render gebeurt hoe dan ook via de host-gate in de root-
 * layout (die de slug uit `CAREER_SLUG_HEADER` haalt); dit pad bepaalt vooral
 * de route-match en dus de HTTP-status.
 */
export function buildRewritePath(slug: string): string {
  return `/careers/${slug}`;
}

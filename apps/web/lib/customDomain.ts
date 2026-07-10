/**
 * Custom-domain helpers voor de Next.js middleware (white-label career-page
 * serving). Puur + framework-vrij (geen `next/server`-import) zodat ze los
 * unit-testbaar zijn — de middleware zelf compose't deze met `fetch`.
 */

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
 * Bouw het career-route-pad voor een custom-domein-slug. De middleware
 * redirect élk custom-domein-pad (`/`, `/jobs`, …) naar dit ene bestaande
 * pad `/careers/<slug>`, zodat de Next.js client-router de juiste route matcht
 * en een bezoeker op het custom domein niet naar de career-page van een andere
 * tenant kan navigeren (alles valt terug op de eigen slug).
 */
export function buildCareerPath(slug: string): string {
  return `/careers/${slug}`;
}

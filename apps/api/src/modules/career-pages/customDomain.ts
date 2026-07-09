/**
 * Custom-domain helpers for white-label career-page serving.
 *
 * Pure, dependency-light functions (no DB, no DNS) so they are trivially
 * unit-testable. The service layer (`career-pages.service.ts`) composes these
 * with the database + `dns.promises.resolve4`.
 *
 * A tenant kan een eigen (sub)domein koppelen (bv. `werkenbij.bedrijf.nl`) dat
 * de publieke career-page toont. Dat domein moet:
 *   1. een geldige hostnaam zijn (geen protocol, poort of pad);
 *   2. niet een app-eigen host zijn (talentflow.kdmn.nl / localhost / het API-
 *      host) — anders zou een tenant de app zelf kunnen kapen;
 *   3. globaal uniek zijn (één domein → precies één career-page).
 */

import { AppError } from '../../middleware/errorHandler';

/**
 * Het IP waar klant-domeinen (via een A-record) naartoe moeten wijzen: de VPS
 * die de app serveert. Env-overridebaar zodat een andere omgeving (staging /
 * toekomstige migratie) niet in code hoeft te patchen.
 */
export const CUSTOM_DOMAIN_TARGET_IP =
  process.env.CUSTOM_DOMAIN_TARGET_IP || '91.98.232.104';

/**
 * Normaliseer een hostnaam voor opslag/matching:
 *   - trim + lowercase
 *   - strip scheme (`https://…`)
 *   - strip pad/query/fragment (`/foo`, `?x`, `#y`)
 *   - strip poort (`:443`)
 *   - strip trailing dot (FQDN-root `example.com.`)
 *
 * Retourneert `null` als er na normalisatie niets bruikbaars overblijft.
 */
export function normalizeHostname(input: string | null | undefined): string | null {
  if (!input) return null;
  let host = String(input).trim().toLowerCase();
  if (!host) return null;
  // strip scheme
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  // strip alles vanaf het eerste pad-/query-/fragment-teken
  host = host.split('/')[0].split('?')[0].split('#')[0];
  // strip poort
  host = host.split(':')[0];
  // strip trailing dot
  host = host.replace(/\.+$/, '');
  return host || null;
}

// Eén DNS-label: 1-63 tekens, alfanumeriek begin/eind, koppeltekens binnenin.
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
// Volledige hostnaam: minstens twee labels (dus minstens één punt).
const HOSTNAME_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);

/**
 * Is `host` een syntactisch geldige, publiek-bruikbare hostnaam?
 * (Verwacht reeds-genormaliseerde input.)
 */
export function isValidHostname(host: string): boolean {
  if (!host || host.length > 253) return false;
  return HOSTNAME_RE.test(host);
}

/**
 * App-eigen hosts die géén tenant-custom-domain mogen zijn. Afgeleid uit env
 * (generiek — geen hardcoded productiedomein) plus de altijd-gereserveerde
 * loopback-namen.
 *
 * Bronnen (elk mag een komma-gescheiden lijst of URL zijn):
 *   - CORS_ORIGIN            (bv. https://talentflow.kdmn.nl)
 *   - NEXT_PUBLIC_API_URL    (bv. https://talentflow.kdmn.nl/api)
 *   - APP_RESERVED_HOSTS     (extra hosts, komma-gescheiden)
 */
export function getReservedHosts(): Set<string> {
  const set = new Set<string>(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
  const sources = [
    process.env.CORS_ORIGIN,
    process.env.NEXT_PUBLIC_API_URL,
    process.env.APP_RESERVED_HOSTS,
  ];
  for (const source of sources) {
    if (!source) continue;
    for (const part of source.split(',')) {
      const host = normalizeHostname(
        part.includes('://') ? part.trim() : part.trim().replace(/\/.*$/, '')
      );
      if (host) set.add(host);
    }
  }
  return set;
}

/**
 * Is `host` gereserveerd? Matcht de host zelf én subdomeinen ervan, zodat een
 * tenant ook geen `foo.talentflow.kdmn.nl` kan claimen.
 */
export function isReservedHost(
  host: string,
  reserved: Set<string> = getReservedHosts()
): boolean {
  for (const r of reserved) {
    if (host === r || host.endsWith('.' + r)) return true;
  }
  return false;
}

/**
 * Valideer + normaliseer een door de admin ingevoerd custom-domain.
 * Retourneert de genormaliseerde host, of gooit een `AppError` (400).
 */
export function validateCustomDomainInput(input: string): string {
  const host = normalizeHostname(input);
  if (!host || !isValidHostname(host)) {
    throw new AppError(
      400,
      'INVALID_DOMAIN',
      'Ongeldige domeinnaam. Gebruik een geldige hostnaam zoals werkenbij.bedrijf.nl (zonder http:// of pad).'
    );
  }
  if (isReservedHost(host)) {
    throw new AppError(
      400,
      'DOMAIN_RESERVED',
      'Dit domein is gereserveerd voor TalentFlow en kan niet als eigen domein worden gebruikt.'
    );
  }
  return host;
}

/**
 * Wijst het domein (blijkens de opgeloste A-records) naar ons doel-IP?
 */
export function ipMatchesTarget(
  resolvedIps: string[],
  target: string = CUSTOM_DOMAIN_TARGET_IP
): boolean {
  return resolvedIps.includes(target);
}

/**
 * Custom-domain middleware — Sprint Q2.1.
 *
 * Wanneer een verzoek binnenkomt met een Host-header die niet matcht met
 * onze gewone marketing-/api-domeinen, kijken we of het een geregistreerd
 * en geverifieerd custom_domain is van een portal_link. Zo ja:
 *   - vullen we req.portalContext met portal_link_id, tenant_id, branding;
 *   - zetten we beveiligingsheaders op de response;
 *   - laten we de request door naar de volgende middleware (Express router).
 *
 * Zo niet en de host is duidelijk een custom domain (geen apex of subdomein
 * van talentflow.app), dan retourneren we 404.
 *
 * Daarnaast biedt deze module `verifyDomainHandler` — de endpoint die
 * Caddy aanroept via `on_demand_tls.ask`. Caddy verwacht 200 → mag cert
 * uitgeven, 4xx → weigeren.
 */

import { Request, Response, NextFunction } from 'express';
import {
  isCustomDomainVerified,
  lookupPortalByDomain,
  type PortalBranding,
} from '../modules/portal/portal.service';
import { logger } from './errorHandler';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      portalContext?: {
        portalLinkId: string;
        tenantId: string;
        branding: PortalBranding;
      };
    }
  }
}

/**
 * Hosts die we als "eigen" beschouwen en altijd doorlaten zonder
 * custom-domain lookup. Door deze als allow-list te gebruiken voorkomen
 * we DB-roundtrips per request én onbedoelde 404's tijdens dev.
 */
const NATIVE_HOST_SUFFIXES = [
  'talentflow.app',
  'localhost',
  '127.0.0.1',
];

function isNativeHost(host: string): boolean {
  const lower = host.toLowerCase().split(':')[0];
  return NATIVE_HOST_SUFFIXES.some(
    (suffix) => lower === suffix || lower.endsWith(`.${suffix}`)
  );
}

function setPortalSecurityHeaders(res: Response): void {
  // X-Frame-Options voorkomt embedding van het portaal in een iframe
  // (clickjacking). SAMEORIGIN i.p.v. DENY zodat eigen pages erop
  // mogen embedden voor preview-doeleinden.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );
}

export async function verifyCustomDomain(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Express resolveert Host header al in req.hostname, maar we willen de
  // raw header zodat poort-info behouden blijft voor logging.
  const hostHeader = (req.headers.host ?? '').toLowerCase();
  const host = hostHeader.split(':')[0];

  if (!host || isNativeHost(host)) {
    next();
    return;
  }

  const portal = await lookupPortalByDomain(host);
  if (!portal) {
    logger.info('[customDomain] unknown host — 404', { host });
    res.status(404).json({
      error: {
        code: 'UNKNOWN_DOMAIN',
        message: 'Onbekende host',
        details: { host },
      },
    });
    return;
  }

  req.portalContext = {
    portalLinkId: portal.portal_link_id,
    tenantId: portal.tenant_id,
    branding: portal.branding,
  };
  setPortalSecurityHeaders(res);
  next();
}

/**
 * Endpoint dat Caddy via `on_demand_tls.ask` aanroept om te bepalen of
 * een TLS-certificaat mag worden uitgegeven voor een hostnaam.
 *
 *   GET /api/portal/verify-domain?domain=portaal.klantbedrijf.nl
 *
 * Caddy stuurt het domein als `?domain=` query-param. We checken óf het
 * een geregistreerd én verified portal-domein is. 200 = mag cert; 404 =
 * niet uitgeven (Caddy geeft dan 421 terug aan de client).
 */
export async function verifyDomainHandler(
  req: Request,
  res: Response
): Promise<void> {
  const domain = String(req.query.domain ?? '').toLowerCase().trim();
  if (!domain) {
    res.status(400).end();
    return;
  }

  // Alleen voor onze eigen domeinen — geen wildcards.
  if (isNativeHost(domain)) {
    // Caddy mag voor onze eigen apex/api altijd certs trekken; we
    // routeren die normaal gesproken niet via on-demand maar als iemand
    // het toch zo configureert, hier 200 retourneren.
    res.status(200).end();
    return;
  }

  const ok = await isCustomDomainVerified(domain);
  if (ok) {
    res.status(200).end();
    return;
  }
  res.status(404).end();
}

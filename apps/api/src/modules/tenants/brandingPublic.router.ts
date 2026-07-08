/**
 * Publiek logo-endpoint — GET /api/public/branding/:tenantId/logo
 *
 * Geen auth: het logo staat per definitie in publiek zichtbare contexten
 * (e-mailfooters, klantportalen, career pages). Wel strikte headers:
 *
 *   - Content-Type uit de DB (alleen png/jpeg/svg — zie migration 045-check)
 *   - X-Content-Type-Options: nosniff  → browser mag niet her-interpreteren
 *   - SVG extra: CSP `default-src 'none'; style-src 'unsafe-inline'; sandbox`
 *     zodat directe navigatie naar de URL nooit scripts in een document-
 *     context met cookies kan draaien (zie SVG-beleid in brandingLogo.service.ts)
 *   - Cross-Origin-Resource-Policy: cross-origin → helmet() zet standaard
 *     `same-origin`, wat <img> vanaf de web-origin (andere poort/host) blokkeert
 *   - Cache-Control: public, max-age=300 — de logo_url bevat een ?v=<ts>
 *     cache-buster per upload, dus korte TTL volstaat
 *
 * Presigned S3-URL's zijn hier bewust NIET gebruikt: die verlopen, en
 * e-mails/portalen embedden de URL langdurig. Dit endpoint streamt uit de
 * FileStorage-abstractie en werkt dus voor zowel MinIO/S3 als local disk.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { getStorage } from '../../lib/storage';
import { getTenantLogoForServing } from './brandingLogo.service';
import { logger } from '../../middleware/errorHandler';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
};

const router = Router();

router.get(
  '/:tenantId/logo',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tenantId } = req.params;
      if (!UUID_RE.test(tenantId)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Logo niet gevonden' } });
        return;
      }

      const logo = await getTenantLogoForServing(tenantId);
      if (!logo) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Logo niet gevonden' } });
        return;
      }

      let stream: NodeJS.ReadableStream;
      try {
        stream = await getStorage().getStream(logo.storageKey);
      } catch (err) {
        logger.warn('[branding] logo-object ontbreekt in storage', {
          tenantId,
          key: logo.storageKey,
          error: (err as Error).message,
        });
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Logo niet gevonden' } });
        return;
      }

      const ext = EXT_BY_MIME[logo.mime] ?? 'bin';
      res.setHeader('Content-Type', logo.mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `inline; filename="logo.${ext}"`);
      res.setHeader('Cache-Control', 'public, max-age=300');
      // helmet() default is same-origin — dat blokkeert <img> vanaf de web-app.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (logo.mime === 'image/svg+xml') {
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline'; sandbox"
        );
      }

      stream.on('error', (err: Error) => {
        logger.warn('[branding] logo-stream fout', { tenantId, error: err.message });
        if (!res.headersSent) {
          res.status(404).end();
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

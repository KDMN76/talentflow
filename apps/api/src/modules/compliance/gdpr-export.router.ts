/**
 * Publieke GDPR-export-download router — AVG art. 15.
 *
 * Mount-pad: `/api/gdpr-export`. **GEEN** auth-middleware: de download
 * werkt via een opaque token in het URL-pad (data_export_tokens,
 * migration 046). Tokens zijn kort-levend (24u) en hebben een
 * download-limiet (3x) — zie dsar.service.downloadDataExportByToken.
 *
 * Rate-limit: 20 requests per uur per token-pad-segment (of IP als
 * fallback). Dempt brute-force op token-strings; de 64-hex-check
 * hieronder weigert malformed tokens al vóór een DB-roundtrip.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { rateLimitStore } from '../../middleware/rateLimitStore';
import { auditCtxFromReq } from '../../lib/audit';
import { downloadDataExportByToken } from './dsar.service';

const gdprExportRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    `gdprexp:${req.params.token ?? req.ip ?? 'unknown'}`,
  store: rateLimitStore('rl:gdprexp:'),
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: {
        code: 'GDPR_EXPORT_RATE_LIMIT',
        message: 'Te veel verzoeken — probeer het over een uur opnieuw',
        details: {},
      },
    });
  },
});

const tokenParam = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, 'Ongeldig token-formaat');

async function downloadHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = tokenParam.parse(req.params.token);
    const { buffer, filename } = await downloadDataExportByToken(
      token,
      auditCtxFromReq(req)
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    // Persoonsgegevens mogen nooit door crawlers geïndexeerd worden.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
}

const router = Router();

router.use(gdprExportRateLimit);
router.get('/:token', downloadHandler);

export default router;

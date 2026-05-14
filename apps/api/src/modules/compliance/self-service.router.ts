/**
 * Candidate self-service router — Sprint Q2.3.
 *
 * Mount-pad: `/api/self-service`. **GEEN** auth-middleware: kandidaten
 * authentiseren via een token in het URL-pad. Tenant-isolatie wordt
 * verzorgd door de service (token-lookup → tenant_id → withTenant).
 *
 * Rate-limit: max 30 requests per uur per token-pad-segment. Dit
 * dempt brute-force op token-strings én voorkomt abuse als een token
 * lekt. We gebruiken Redis (zoals de andere rate-limiters) zodat het
 * cluster-wide werkt.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../../queue/queues';
import { auditCtxFromReq } from '../../lib/audit';
import {
  getCandidateSelfData,
  recordCandidateConsentChange,
  recordCandidateCorrection,
  recordCandidateDeletionRequest,
} from './selfService.service';

// ─────────────────────────────────────────────────────────────────────────────
// Rate-limit (30 req/uur per token)
// ─────────────────────────────────────────────────────────────────────────────

type RLData = boolean | number | string;
type RLRedisReply = RLData | RLData[];

function makeRedisCommand() {
  return async (...args: string[]): Promise<RLRedisReply> => {
    const [cmd, ...rest] = args;
    const result = await redis.call(cmd, ...rest);
    return result as RLRedisReply;
  };
}

const selfServiceRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Token zit in `req.params.token`; bij root-level (/:token) is dat de
    // first param. We hashen niet — keys staan binnen Redis al achter
    // namespacing.
    return `selfsvc:${req.params.token ?? req.ip ?? 'unknown'}`;
  },
  store: new RedisStore({
    sendCommand: makeRedisCommand(),
    prefix: 'rl:selfsvc:',
  }),
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: {
        code: 'SELFSERVICE_RATE_LIMIT',
        message: 'Te veel verzoeken — probeer het over een uur opnieuw',
        details: {},
      },
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const consentBody = z.object({
  type: z.enum(['gdpr', 'email']),
  granted: z.boolean(),
});

const correctionBody = z.object({
  fields: z.record(z.string(), z.unknown()),
});

const deletionBody = z.object({
  reason: z.string().max(2000).optional(),
});

const tokenParam = z.string().regex(/^[a-f0-9]{64}$/i, 'Ongeldig token-formaat');

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function viewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const token = tokenParam.parse(req.params.token);
    const data = await getCandidateSelfData(token);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function consentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const token = tokenParam.parse(req.params.token);
    const body = consentBody.parse(req.body);
    await recordCandidateConsentChange(
      token,
      body.type,
      body.granted,
      auditCtxFromReq(req)
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function correctionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const token = tokenParam.parse(req.params.token);
    const body = correctionBody.parse(req.body);
    const result = await recordCandidateCorrection(
      token,
      body.fields,
      auditCtxFromReq(req)
    );
    res.status(202).json({ data: result });
  } catch (err) {
    next(err);
  }
}

async function deletionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const token = tokenParam.parse(req.params.token);
    const body = deletionBody.parse(req.body ?? {});
    const result = await recordCandidateDeletionRequest(
      token,
      body.reason,
      auditCtxFromReq(req)
    );
    res.status(202).json({ data: result });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use(selfServiceRateLimit);

router.get('/:token', viewHandler);
router.post('/:token/consent', consentHandler);
router.post('/:token/correction', correctionHandler);
router.post('/:token/deletion', deletionHandler);

export default router;

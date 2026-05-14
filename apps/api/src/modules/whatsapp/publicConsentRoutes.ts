/**
 * Public WhatsApp opt-in routes — Sprint Q4.6 (Agent ZZZ).
 *
 * Mount path: `/api/public/whatsapp`. NO auth — candidate authenticates
 * via the single-use token in the URL. Rate-limit: 5 requests/minute/IP.
 *
 * Flow:
 *   GET  /opt-in/:token             — landing page metadata (candidate name)
 *   POST /opt-in/:token/accept      — flips consent to granted, captures IP+UA
 *   GET  /opt-in/:token/decline     — records decline (no state change yet)
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../../queue/queues';
import { AppError } from '../../middleware/errorHandler';
import {
  lookupTokenForPublic,
  grantConsentViaToken,
} from './consent.service';

// ───────────────────────────────────────────────────────────────────────────
// Rate-limit — 5 req/min/IP via Redis (cluster-wide)
// ───────────────────────────────────────────────────────────────────────────

type RLData = boolean | number | string;
type RLRedisReply = RLData | RLData[];

function makeRedisCommand() {
  return async (...args: string[]): Promise<RLRedisReply> => {
    const [cmd, ...rest] = args;
    const result = await redis.call(cmd, ...rest);
    return result as RLRedisReply;
  };
}

const optInRateLimit =
  process.env.NODE_ENV === 'test'
    ? rateLimit({
        windowMs: 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req: Request) => req.ip ?? 'unknown',
      })
    : rateLimit({
        windowMs: 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req: Request) => req.ip ?? 'unknown',
        store: new RedisStore({
          sendCommand: makeRedisCommand(),
          prefix: 'rl:wa:optin:',
        }),
      });

const router = Router();
router.use(optInRateLimit);

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function parseToken(req: Request): string {
  const token = req.params.token;
  if (!token || typeof token !== 'string' || token.length < 16 || token.length > 256) {
    throw new AppError(400, 'INVALID_TOKEN', 'Token-formaat ongeldig');
  }
  return token;
}

function clientIp(req: Request): string | null {
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────────────────────

router.get('/opt-in/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = parseToken(req);
    const lookup = await lookupTokenForPublic(token);
    if (!lookup) {
      res.status(404).json({
        error: { code: 'INVALID_TOKEN', message: 'Token ongeldig of verlopen' },
      });
      return;
    }
    res.json({
      data: {
        candidate_name: lookup.candidateName,
        phone_number: lookup.phoneNumber,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/opt-in/:token/accept', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = parseToken(req);
    const row = await grantConsentViaToken(
      token,
      clientIp(req),
      req.get('user-agent') ?? null
    );
    res.status(200).json({
      data: {
        status: row.status,
        granted_at: row.granted_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/opt-in/:token/decline', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = parseToken(req);
    const lookup = await lookupTokenForPublic(token);
    if (!lookup) {
      res.status(404).json({
        error: { code: 'INVALID_TOKEN', message: 'Token ongeldig of verlopen' },
      });
      return;
    }
    // Decline: we do NOT auto-consume the token (candidate may change mind),
    // and we do NOT create a 'withdrawn' row — the consent stays 'pending'.
    res.json({
      data: { status: 'declined' },
    });
  } catch (err) {
    next(err);
  }
});

export default router;

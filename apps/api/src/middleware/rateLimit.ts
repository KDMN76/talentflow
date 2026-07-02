import rateLimit, { type RateLimitInfo } from 'express-rate-limit';
import type { Request } from 'express';
import { rateLimitStore } from './rateLimitStore';

// Limieten zijn env-tunebaar (default = productiewaarde). Handig om in dev/
// audit/load-test tijdelijk op te hogen zonder code te wijzigen. Niet zetten →
// identiek gedrag als voorheen. (env wordt herladen bij tsx-watch reload.)
const API_MAX = Number(process.env.RATE_LIMIT_MAX) || 200;
const AUTH_MAX = Number(process.env.RATE_LIMIT_AUTH_MAX) || 10;
const AUTH_WINDOW_MS = 15 * 60 * 1000;

// express-rate-limit v7 zet `req.rateLimit` op het Request nadat de limiter
// heeft gedraaid, maar augmenteert het Express-Request-type niet globaal —
// vandaar deze expliciete intersectie voor een nette, type-safe read.
type RateLimitedRequest = Request & { rateLimit?: RateLimitInfo };

/**
 * General API rate limiter: 200 requests per 15 minutes per IP (default).
 */
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: rateLimitStore('rl:api:'),
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Te veel verzoeken, probeer het later opnieuw',
        details: {},
      },
    });
  },
});

/**
 * Stricter limiter for auth endpoints: 10 requests per 15 minutes per IP.
 */
export const authRateLimit = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: rateLimitStore('rl:auth:'),
  handler: (req, res) => {
    // Geef de client genoeg info voor een countdown-UX: seconden tot de
    // window reset + de limiet. Fallback = volledige window-duur wanneer de
    // store geen resetTime teruggeeft.
    const info = (req as RateLimitedRequest).rateLimit;
    const resetMs = info?.resetTime
      ? info.resetTime.getTime() - Date.now()
      : AUTH_WINDOW_MS;
    const retryAfter = Math.max(1, Math.ceil(resetMs / 1000));

    res.status(429).json({
      error: {
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Te veel inlogpogingen, probeer het later opnieuw',
        details: {
          retryAfter,
          limit: info?.limit ?? AUTH_MAX,
          remaining: 0,
        },
      },
    });
  },
});

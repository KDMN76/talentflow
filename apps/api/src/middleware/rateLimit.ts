import rateLimit, { type RateLimitInfo } from 'express-rate-limit';
import type { Request } from 'express';
import { rateLimitStore } from './rateLimitStore';

// Limieten zijn env-tunebaar (default = productiewaarde). Handig om in dev/
// audit/load-test tijdelijk op te hogen zonder code te wijzigen. Niet zetten →
// identiek gedrag als voorheen. (env wordt herladen bij tsx-watch reload.)
const API_MAX = Number(process.env.RATE_LIMIT_MAX) || 200;
const AUTH_MAX = Number(process.env.RATE_LIMIT_AUTH_MAX) || 10;
const EMAIL_TEST_MAX = Number(process.env.RATE_LIMIT_EMAIL_TEST_MAX) || 5;
const API_WINDOW_MS = 15 * 60 * 1000;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_TEST_WINDOW_MS = 15 * 60 * 1000;

// express-rate-limit v7 zet `req.rateLimit` op het Request nadat de limiter
// heeft gedraaid, maar augmenteert het Express-Request-type niet globaal —
// vandaar deze expliciete intersectie voor een nette, type-safe read.
type RateLimitedRequest = Request & { rateLimit?: RateLimitInfo };

/**
 * Bouwt de 429-`details` voor een rate-limit response. Geeft de client genoeg
 * info voor een countdown-UX: seconden tot de window reset + de limiet.
 * Fallback = volledige window-duur wanneer de store geen resetTime teruggeeft.
 * Gedeeld tussen apiRateLimit en authRateLimit zodat beide hetzelfde
 * response-contract hebben.
 */
function rateLimitDetails(
  req: Request,
  windowMs: number,
  fallbackLimit: number
): { retryAfter: number; limit: number; remaining: 0 } {
  const info = (req as RateLimitedRequest).rateLimit;
  const resetMs = info?.resetTime
    ? info.resetTime.getTime() - Date.now()
    : windowMs;
  return {
    retryAfter: Math.max(1, Math.ceil(resetMs / 1000)),
    limit: info?.limit ?? fallbackLimit,
    remaining: 0,
  };
}

/**
 * General API rate limiter: 200 requests per 15 minutes per IP (default).
 */
export const apiRateLimit = rateLimit({
  windowMs: API_WINDOW_MS,
  max: API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: rateLimitStore('rl:api:'),
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Te veel verzoeken, probeer het later opnieuw',
        details: rateLimitDetails(req, API_WINDOW_MS, API_MAX),
      },
    });
  },
});

/**
 * Testmail-limiter (tenant e-mailinstellingen): 5 testmails per 15 minuten
 * per IP. Voorkomt dat het test-endpoint als spam-kanaal of SMTP-probe
 * misbruikt wordt.
 */
export const emailTestRateLimit = rateLimit({
  windowMs: EMAIL_TEST_WINDOW_MS,
  max: EMAIL_TEST_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: rateLimitStore('rl:emailtest:'),
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Te veel testmails, probeer het later opnieuw',
        details: rateLimitDetails(req, EMAIL_TEST_WINDOW_MS, EMAIL_TEST_MAX),
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
    res.status(429).json({
      error: {
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Te veel inlogpogingen, probeer het later opnieuw',
        details: rateLimitDetails(req, AUTH_WINDOW_MS, AUTH_MAX),
      },
    });
  },
});

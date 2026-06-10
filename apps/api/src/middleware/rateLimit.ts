import rateLimit from 'express-rate-limit';
import { rateLimitStore } from './rateLimitStore';

// Limieten zijn env-tunebaar (default = productiewaarde). Handig om in dev/
// audit/load-test tijdelijk op te hogen zonder code te wijzigen. Niet zetten →
// identiek gedrag als voorheen. (env wordt herladen bij tsx-watch reload.)
const API_MAX = Number(process.env.RATE_LIMIT_MAX) || 200;
const AUTH_MAX = Number(process.env.RATE_LIMIT_AUTH_MAX) || 10;

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
  windowMs: 15 * 60 * 1000,
  max: AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: rateLimitStore('rl:auth:'),
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Te veel inlogpogingen, probeer het later opnieuw',
        details: {},
      },
    });
  },
});

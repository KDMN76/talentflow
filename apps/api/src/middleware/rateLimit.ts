import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../queue/queues';

// Matches rate-limit-redis internal: Data = boolean | number | string; RedisReply = Data | Data[]
type RLData = boolean | number | string;
type RLRedisReply = RLData | RLData[];

function makeRedisCommand() {
  return async (...args: string[]): Promise<RLRedisReply> => {
    const [cmd, ...rest] = args;
    const result = await redis.call(cmd, ...rest);
    return result as RLRedisReply;
  };
}

/**
 * General API rate limiter: 200 requests per 15 minutes per IP.
 */
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: makeRedisCommand(),
    prefix: 'rl:api:',
  }),
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
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: makeRedisCommand(),
    prefix: 'rl:auth:',
  }),
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

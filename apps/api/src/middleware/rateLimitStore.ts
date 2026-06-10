import { RedisStore } from 'rate-limit-redis';
import { redis } from '../queue/queues';

// Matches rate-limit-redis internal: Data = boolean | number | string.
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
 * Gedeelde rate-limit-store-factory.
 *
 * - **Productie:** een Redis-backed store (gedeeld over instances).
 * - **Dev/test:** `undefined` → express-rate-limit valt terug op zijn
 *   in-memory MemoryStore.
 *
 * Waarom: dev/test heeft geen externe Redis nodig en verbruikt zo geen Upstash
 * dev-quota. Belangrijker: een Redis-uitval/quota-limiet mag de API niet bij het
 * opstarten meeslepen — `RedisStore` doet bij init een `SCRIPT LOAD` die anders
 * een unhandled error gaf en het proces liet crashen.
 */
export function rateLimitStore(prefix: string) {
  if (process.env.NODE_ENV !== 'production') return undefined;
  return new RedisStore({ sendCommand: makeRedisCommand(), prefix });
}

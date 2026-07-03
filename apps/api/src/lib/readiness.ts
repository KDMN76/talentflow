import type { Request, Response } from 'express';

/**
 * Readiness-check (`/health/ready`) — bewust GESCHEIDEN van de liveness-check
 * (`/health`).
 *
 * Waarom twee endpoints:
 *   - `/health` (liveness) zegt alleen "het Node-proces draait en beantwoordt
 *     HTTP". De Docker HEALTHCHECK (apps/api/Dockerfile en
 *     infra/docker-compose.prod.yml) cURLt dít pad. Als liveness ook DB/Redis
 *     zou checken, markeert Docker de container unhealthy bij een
 *     DB/Redis-storing en gaat hij restarten — terwijl een restart die storing
 *     niet oplost. Resultaat: restart-loop bovenop een infra-incident.
 *   - `/health/ready` (readiness) zegt "de app kan écht verkeer bedienen":
 *     Postgres bereikbaar (SELECT 1) én Redis bereikbaar (PING). Bedoeld voor
 *     load-balancers, uptime-monitors en deploy-smoke-tests die willen weten
 *     of de dependencies er zijn — een 503 hier mag NOOIT tot een
 *     container-restart leiden.
 *
 * Beide checks draaien parallel met een eigen timeout (default 2s) zodat een
 * hangende dependency de respons niet onbeperkt ophoudt.
 */

export interface ReadinessDeps {
  /** Meestal de pg Pool — alles met een `query()` volstaat. */
  db: { query: (sql: string) => Promise<unknown> };
  /** Meestal de gedeelde ioredis-client — alles met een `ping()` volstaat. */
  redis: { ping: () => Promise<string> };
  /** Timeout per check in ms (default 2000). Overridebaar voor tests. */
  timeoutMs?: number;
}

export type CheckResult = 'ok' | 'failed';

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  checks: {
    db: CheckResult;
    redis: CheckResult;
  };
}

/**
 * Race een check tegen een timeout. De timer wordt altijd opgeruimd zodat hij
 * het proces niet levend houdt en tests geen open handles overhouden.
 */
async function withTimeout(
  check: () => Promise<unknown>,
  timeoutMs: number
): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`readiness check timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
    return 'ok';
  } catch {
    return 'failed';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Factory i.p.v. losse handler zodat de dependencies (pool, redis) injectable
 * zijn — index.ts geeft de echte instanties, tests geven mocks.
 */
export function createReadinessHandler(deps: ReadinessDeps) {
  const timeoutMs = deps.timeoutMs ?? 2000;

  return async (_req: Request, res: Response): Promise<void> => {
    const [db, redis] = await Promise.all([
      withTimeout(() => deps.db.query('SELECT 1'), timeoutMs),
      withTimeout(() => deps.redis.ping(), timeoutMs),
    ]);

    const ready = db === 'ok' && redis === 'ok';
    const payload: ReadinessResponse = {
      status: ready ? 'ready' : 'not_ready',
      checks: { db, redis },
    };

    res.status(ready ? 200 : 503).json(payload);
  };
}

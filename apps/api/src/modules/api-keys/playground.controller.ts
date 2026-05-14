import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import http from 'http';
import jwt from 'jsonwebtoken';
import { AppError } from '../../middleware/errorHandler';

// ────────────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────────────

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

const runRequestSchema = z.object({
  method: z.enum(ALLOWED_METHODS),
  path: z.string().min(1).max(1000),
  headers: z.record(z.string()).optional().default({}),
  query: z.record(z.string()).optional().default({}),
  body: z.unknown().optional(),
});

// Stop forbidden hosts/paths — playground mag alleen onze eigen API benaderen.
function sanitizePath(rawPath: string): string {
  // Voorkom protocol-relatieve URLs en absolute hosts.
  if (/^https?:\/\//i.test(rawPath)) {
    throw new AppError(400, 'INVALID_PATH', 'Externe URLs zijn niet toegestaan');
  }
  if (rawPath.startsWith('//')) {
    throw new AppError(400, 'INVALID_PATH', 'Protocol-relatieve URLs zijn niet toegestaan');
  }
  let path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  if (!path.startsWith('/api/')) {
    if (path === '/api') path = '/api/';
    else throw new AppError(400, 'INVALID_PATH', 'Pad moet onder /api/ vallen');
  }
  // Voorkom path-traversal of dubbele slashes uit user-input.
  if (path.includes('..')) {
    throw new AppError(400, 'INVALID_PATH', 'Pad bevat ongeldige tekens');
  }
  return path;
}

function buildQueryString(query: Record<string, string>): string {
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.append(k, String(v));
  return `?${params.toString()}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────────────

/**
 * Voert een API-call uit binnen de eigen process — geen externe relay.
 * Wordt door de playground UI gebruikt om endpoints te testen onder de
 * geauthenticeerde recruiter (JWT) of een gekozen API-key.
 *
 * - Forceert pad onder `/api/*`.
 * - Strippt hop-by-hop headers en CORS-onzin.
 * - Logt de call in `api_key_usage_log` als er een API-key in de headers zit
 *   (de auth-middleware vangt dat automatisch af voor die nested call).
 */
export async function runRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = runRequestSchema.parse(req.body);
    const sanitizedPath = sanitizePath(data.path);

    // Strip headers die we niet door willen geven of die conflicten zouden
    // veroorzaken bij de geneste request.
    const FORBIDDEN_HEADERS = new Set([
      'host',
      'content-length',
      'connection',
      'transfer-encoding',
      'cookie',
      'origin',
      'referer',
    ]);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    for (const [k, v] of Object.entries(data.headers ?? {})) {
      if (!FORBIDDEN_HEADERS.has(k.toLowerCase())) {
        headers[k] = v;
      }
    }

    // Als de UI geen Authorization meegeeft, sturen we een serversiden JWT
    // mee zodat de eindgebruiker als zichzelf doorklikt — geen impersonation
    // van een ander tenant.
    const hasAuth =
      Object.keys(headers).some((h) => h.toLowerCase() === 'authorization') ||
      Object.keys(headers).some((h) => h.toLowerCase() === 'x-api-key');

    if (!hasAuth && req.user) {
      const secret = process.env.JWT_SECRET;
      if (secret) {
        const internalJwt = jwt.sign(
          {
            userId: req.user.userId,
            tenantId: req.user.tenantId,
            email: req.user.email,
            role: req.user.role,
          },
          secret,
          { expiresIn: '60s' }
        );
        headers.authorization = `Bearer ${internalJwt}`;
      }
    }

    const queryString = buildQueryString(data.query ?? {});
    const fullPath = `${sanitizedPath}${queryString}`;

    const port = parseInt(process.env.PORT ?? '4000', 10);
    const start = Date.now();

    const requestBody =
      data.body === undefined ? undefined : Buffer.from(JSON.stringify(data.body), 'utf8');

    const result = await new Promise<{
      status: number;
      headers: Record<string, string | string[] | undefined>;
      body: unknown;
      raw: string;
    }>((resolve, reject) => {
      const proxyReq = http.request(
        {
          host: '127.0.0.1',
          port,
          method: data.method,
          path: fullPath,
          headers,
          timeout: 30_000,
        },
        (proxyRes) => {
          const chunks: Buffer[] = [];
          proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          proxyRes.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let parsed: unknown = raw;
            const ct = proxyRes.headers['content-type'];
            if (typeof ct === 'string' && ct.includes('json') && raw.length > 0) {
              try {
                parsed = JSON.parse(raw);
              } catch {
                parsed = raw;
              }
            }
            resolve({
              status: proxyRes.statusCode ?? 0,
              headers: proxyRes.headers,
              body: parsed,
              raw,
            });
          });
        }
      );

      proxyReq.on('error', (err) => reject(err));
      proxyReq.on('timeout', () => {
        proxyReq.destroy(new Error('PLAYGROUND_TIMEOUT'));
      });

      if (requestBody) proxyReq.write(requestBody);
      proxyReq.end();
    });

    const duration = Date.now() - start;

    res.json({
      status: result.status,
      headers: result.headers,
      body: result.body,
      raw: result.raw,
      duration_ms: duration,
      method: data.method,
      path: fullPath,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'PLAYGROUND_TIMEOUT') {
      next(new AppError(504, 'PLAYGROUND_TIMEOUT', 'Request duurde te lang'));
      return;
    }
    next(err);
  }
}

/**
 * Public timesheet portal routes — Sprint Q4.4 (Agent TTT).
 *
 * Mount path: `/api/public/timesheets/:token` (zie src/index.ts).
 *
 * NO auth — kandidaat opent vanuit e-mail link, vult uren in, submit. Token
 * wordt sha256-gehashed in de DB opgeslagen; expired/revoked tokens worden
 * altijd 401-eerst-en-vragen-later.
 *
 * Rate-limit: 60 requests / 5 min per IP — voldoende voor één invul-sessie,
 * blokkeert brute-force token guessing. Redis-backed via `rate-limit-redis`.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { rateLimitStore } from '../../middleware/rateLimitStore';
import { AppError } from '../../middleware/errorHandler';
import * as service from './timesheets.service';

const router = Router();

// ───────────────────────────────────────────────────────────────────────────
// Rate-limit (Redis-backed in productie, in-memory in dev/test — zie
// rateLimitStore)
// ───────────────────────────────────────────────────────────────────────────

const portalRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: rateLimitStore('rl:public-timesheet:'),
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Te veel verzoeken — probeer het later opnieuw',
        details: {},
      },
    });
  },
});

router.use(portalRateLimit);

// ───────────────────────────────────────────────────────────────────────────
// Token-resolver middleware
// ───────────────────────────────────────────────────────────────────────────

interface PortalLocals {
  resolution: NonNullable<Awaited<ReturnType<typeof service.resolvePortalToken>>>;
}

async function resolveToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const raw = req.params.token ?? '';
    const resolution = await service.resolvePortalToken(raw);
    if (!resolution) {
      throw new AppError(401, 'INVALID_TOKEN', 'Ongeldig of verlopen token');
    }
    (res.locals as Partial<PortalLocals>).resolution = resolution;
    next();
  } catch (err) {
    next(err);
  }
}

router.use('/:token', resolveToken);

// ───────────────────────────────────────────────────────────────────────────
// Schemas
// ───────────────────────────────────────────────────────────────────────────

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum moet ISO-formaat YYYY-MM-DD zijn');

const entryBody = z.object({
  date: dateString,
  hours: z.number().min(0).max(24),
  overtime_hours: z.number().min(0).max(24).optional(),
  break_minutes: z.number().int().min(0).max(24 * 60).optional(),
  description: z.string().max(1000).nullable().optional(),
  project_code: z.string().max(120).nullable().optional(),
});

const queryWeek = z.object({ week_start: dateString.optional() });

// ───────────────────────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────────────────────

/**
 * GET /api/public/timesheets/:token
 *
 * Returns the contract context + the active week's timesheet (auto-created if
 * not present). When `?week_start=…` is passed, that specific week is loaded.
 * Otherwise we use the current ISO-week's Monday.
 */
router.get('/:token', async (req, res, next) => {
  try {
    const r = (res.locals as PortalLocals).resolution;
    const q = queryWeek.parse(req.query);
    const weekStart = q.week_start ?? mondayOf(new Date());
    const ts = await service.getOrCreateTimesheet(
      r.tenant_id,
      r.contract_id,
      weekStart,
      r.candidate_id
    );
    const full = await service.getTimesheet(r.tenant_id, ts.id);
    res.json({
      data: {
        contract_id: r.contract_id,
        candidate_id: r.candidate_id,
        timesheet: full,
        token_expires_at: r.expires_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:token/entries', async (req, res, next) => {
  try {
    const r = (res.locals as PortalLocals).resolution;
    const body = entryBody.parse(req.body);
    const weekStart = mondayOfDate(body.date);
    const ts = await service.getOrCreateTimesheet(
      r.tenant_id,
      r.contract_id,
      weekStart,
      r.candidate_id
    );
    const result = await service.addOrUpdateEntry(
      r.tenant_id,
      ts.id,
      body,
      { userId: r.candidate_id, role: 'candidate' }
    );
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/:token/submit', async (req, res, next) => {
  try {
    const r = (res.locals as PortalLocals).resolution;
    const q = queryWeek.parse(req.query);
    const weekStart = q.week_start ?? mondayOf(new Date());
    const ts = await service.getOrCreateTimesheet(
      r.tenant_id,
      r.contract_id,
      weekStart,
      r.candidate_id
    );
    const submitted = await service.submitTimesheet(
      r.tenant_id,
      ts.id,
      r.candidate_id,
      { userId: r.candidate_id }
    );
    res.json({ data: submitted });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
  // ISO-week monday: 0=sun in JS, want 1=mon → if 0 → -6, else 1-day.
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function mondayOfDate(iso: string): string {
  return mondayOf(new Date(`${iso}T00:00:00Z`));
}

export default router;

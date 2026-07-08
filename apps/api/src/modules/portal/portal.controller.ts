import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as portalService from './portal.service';
import { AppError } from '../../middleware/errorHandler';
import { auditCtxFromReq } from '../../lib/audit';

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Granulaire permissions (Q2.1-schema) + legacy keys. Onbekende keys worden
 * door zod gestript; `normalizePermissions()` in de service mapt legacy →
 * granulair.
 */
const permissionsSchema = z
  .object({
    view_candidates: z.boolean().optional(),
    view_resumes: z.boolean().optional(),
    view_ai_scores: z.boolean().optional(),
    view_contact_info: z.boolean().optional(),
    accept_reject: z.boolean().optional(),
    comment: z.boolean().optional(),
    download_cv: z.boolean().optional(),
    view_pipeline_history: z.boolean().optional(),
    // Legacy keys — stilletjes gemapt door normalizePermissions().
    view: z.boolean().optional(),
    approve: z.boolean().optional(),
    reject: z.boolean().optional(),
  })
  .optional();

const createSchema = z.object({
  job_id: z.string().uuid(),
  // De UI stuurt "" bij een leeg veld en null bij geen vervaldatum — beide
  // zijn geldige "niet ingevuld"-waarden, geen 400.
  client_name: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : undefined)),
  permissions: permissionsSchema,
  expires_at: z.string().datetime({ offset: true }).nullish(),
  notify_email: z.string().email().nullish(),
  notification_frequency: z.enum(['realtime', 'daily', 'weekly', 'off']).optional(),
});

const submitFeedbackSchema = z.object({
  // Zonder application_id = algemene opmerking over de hele shortlist.
  application_id: z.string().uuid().nullish(),
  // UI-varianten (approve/reject/doubt/comment) én canonieke waarden — de
  // service normaliseert via normalizeFeedbackAction().
  action: z.string().min(1).max(20),
  comment: z.string().max(2000).optional(),
  client_name: z.string().trim().min(1).max(200).optional(),
});

const jobIdQuerySchema = z.object({
  job_id: z.string().uuid().optional(),
});

function requestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  return {
    ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function listForTenant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const links = await portalService.listPortalLinksForTenant(req.user!.tenantId);
    res.json({ data: links });
  } catch (err) {
    next(err);
  }
}

export async function listForJob(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Job id can come from a path param (/by-job/:jobId) or query (?job_id=)
    const jobIdFromParam = req.params.jobId;
    const { job_id: jobIdFromQuery } = jobIdQuerySchema.parse(req.query);
    const jobId = jobIdFromParam ?? jobIdFromQuery;

    if (!jobId) {
      throw new AppError(400, 'MISSING_JOB_ID', 'job_id is verplicht');
    }

    const links = await portalService.listPortalLinksForJob(req.user!.tenantId, jobId);
    res.json({ data: links });
  } catch (err) {
    next(err);
  }
}

export async function getOne(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const link = await portalService.getPortalLink(req.user!.tenantId, req.params.id);
    res.json({ data: link });
  } catch (err) {
    next(err);
  }
}

export async function create(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = createSchema.parse(req.body);
    const link = await portalService.createPortalLink(
      req.user!.tenantId,
      req.user!.userId,
      {
        job_id: data.job_id,
        client_name: data.client_name,
        permissions: data.permissions,
        expires_at: data.expires_at ?? undefined,
        notify_email: data.notify_email ?? undefined,
        notification_frequency: data.notification_frequency,
      },
      auditCtxFromReq(req)
    );
    res.status(201).json(link);
  } catch (err) {
    next(err);
  }
}

export async function remove(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await portalService.deletePortalLink(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ message: 'Portal-link verwijderd' });
  } catch (err) {
    next(err);
  }
}

/** GET /api/portals/:id/feedback — gast-feedback per link voor de recruiter. */
export async function listFeedback(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '200'), 10) || 200, 500);
    const feedback = await portalService.getPortalFeedbackForLink(
      req.user!.tenantId,
      req.params.id,
      limit
    );
    res.json({ data: feedback });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public (token-based) handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function getAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.params.token;
    if (!token) {
      throw new AppError(400, 'MISSING_TOKEN', 'Token is verplicht');
    }
    const access = await portalService.getPortalAccess(token, requestMeta(req));
    res.json(access);
  } catch (err) {
    next(err);
  }
}

/** GET /api/portals/branding/:token — white-label branding (publiek). */
export async function getBranding(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.params.token;
    if (!token) {
      throw new AppError(400, 'MISSING_TOKEN', 'Token is verplicht');
    }
    const result = await portalService.getBrandingForToken(token);
    if (!result) {
      throw new AppError(
        404,
        'PORTAL_NOT_FOUND',
        'Deze portal-link is ongeldig of ingetrokken'
      );
    }
    res.json({ branding: result.branding, client_name: result.client_name });
  } catch (err) {
    next(err);
  }
}

export async function submitFeedback(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.params.token;
    if (!token) {
      throw new AppError(400, 'MISSING_TOKEN', 'Token is verplicht');
    }
    const data = submitFeedbackSchema.parse(req.body);
    const action = portalService.normalizeFeedbackAction(data.action);
    if (!action) {
      throw new AppError(400, 'INVALID_ACTION', 'Ongeldige feedback-actie');
    }
    const feedback = await portalService.submitPortalFeedback(
      token,
      {
        application_id: data.application_id ?? null,
        action,
        comment: data.comment,
        client_name: data.client_name,
      },
      requestMeta(req)
    );
    res.status(201).json(feedback);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/portals/access/:token/log-view/:candidateId — gast heeft een
 * kandidaat-kaart in beeld gehad. Best-effort activity-logging; het token
 * wordt wél eerst gevalideerd zodat dit endpoint geen open schrijf-kanaal is.
 */
export async function logCandidateView(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.params.token;
    const candidateId = req.params.candidateId;
    if (!token) {
      throw new AppError(400, 'MISSING_TOKEN', 'Token is verplicht');
    }
    if (!candidateId || !z.string().uuid().safeParse(candidateId).success) {
      throw new AppError(400, 'INVALID_CANDIDATE_ID', 'Ongeldig kandidaat-id');
    }

    const link = await portalService.resolvePortalToken(token);
    const meta = requestMeta(req);
    await portalService.logPortalActivity(
      link.id,
      'viewed_candidate',
      candidateId,
      {},
      meta.ipAddress,
      meta.userAgent
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

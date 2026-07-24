import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as jobsService from './jobs.service';
import { applyPipelineTemplateToJob } from '../pipeline/pipeline.service';
import { auditCtxFromReq } from '../../lib/audit';
import {
  JobCreateInputSchema,
  JobUpdateInputSchema,
  JobListItemSchema,
  JobDetailSchema,
  JOB_STATUS_VALUES,
  assertResponse,
} from '@talentflow/contracts';

// Query-string schema voor GET /jobs (geen entity-schema, hoort niet in
// @talentflow/contracts — pagination + filtering is een transport-concern).
// `status` valideren we tegen de gedeelde JOB_STATUS_VALUES zodat tikfouten
// in URL-params (`status=opn`) niet silent 0 resultaten geven.
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(JOB_STATUS_VALUES).optional(),
  recruiter_id: z.string().uuid().optional(),
  // Server-side filters (voorheen client-side → telling + export klopten niet).
  search: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z
    .enum(['newest', 'oldest', 'most_applicants', 'fewest_applicants', 'title_az'])
    .optional(),
});

const applyPipelineTemplateSchema = z.object({
  pipeline_template_id: z.string().uuid().optional(),
});

export async function listJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, status, recruiter_id, search, location, date_from, date_to, sort } =
      paginationSchema.parse(req.query);
    const result = await jobsService.listJobs(req.user!.tenantId, {
      page,
      limit,
      status,
      recruiterId: recruiter_id,
      search,
      location,
      dateFrom: date_from,
      dateTo: date_to,
      sort,
    });
    // Sub-fase 2B: dev/test response-validatie tegen het shared schema.
    // Productie skipt de parse (assertResponse is no-op bij NODE_ENV=production).
    const validated = assertResponse(z.array(JobListItemSchema), result.data);
    res.json({ data: validated, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

export async function createJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = JobCreateInputSchema.parse(req.body);
    const job = await jobsService.createJob(
      req.user!.tenantId,
      req.user!.userId,
      data,
      auditCtxFromReq(req)
    );
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
}

export async function getJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await jobsService.getJob(req.user!.tenantId, req.params.id);
    res.json(assertResponse(JobDetailSchema, job));
  } catch (err) {
    next(err);
  }
}

export async function updateJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = JobUpdateInputSchema.parse(req.body);
    const job = await jobsService.updateJob(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      data,
      auditCtxFromReq(req)
    );
    res.json(job);
  } catch (err) {
    next(err);
  }
}

export async function deleteJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await jobsService.deleteJob(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ message: 'Vacature verwijderd' });
  } catch (err) {
    next(err);
  }
}

export async function duplicateJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await jobsService.duplicateJob(req.user!.tenantId, req.params.id, req.user!.userId);
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
}

export async function getJobStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await jobsService.getJobStats(req.user!.tenantId, req.params.id);
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /jobs/:id/pipeline-template
 * Applies (clones) a pipeline template to an existing job. Only works when
 * the job has no stages yet — see applyPipelineTemplateToJob for details.
 * Body: { pipeline_template_id?: uuid }   // omitted = system default
 */
export async function applyPipelineTemplate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { pipeline_template_id } = applyPipelineTemplateSchema.parse(req.body);
    const result = await applyPipelineTemplateToJob(
      req.user!.tenantId,
      req.params.id,
      pipeline_template_id
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

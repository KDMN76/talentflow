import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as jobsService from './jobs.service';
import { applyPipelineTemplateToJob } from '../pipeline/pipeline.service';
import { auditCtxFromReq } from '../../lib/audit';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  recruiter_id: z.string().uuid().optional(),
});

const isoDate = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    'Verwacht ISO datum (YYYY-MM-DD of volledige ISO timestamp)'
  );

const jobReferenceSchema = z
  .string()
  .min(4, 'job_reference moet minimaal 4 tekens bevatten')
  .max(40, 'job_reference mag maximaal 40 tekens bevatten')
  .regex(/^[A-Z0-9-]+$/, 'job_reference mag alleen hoofdletters, cijfers en streepjes bevatten');

const jobBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  department: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  salary_min: z.number().int().min(0).optional(),
  salary_max: z.number().int().min(0).optional(),
  employment_type: z.enum(['fulltime', 'parttime', 'contract', 'freelance', 'internship']).optional(),
  status: z.enum(['draft', 'open', 'filled', 'closed', 'archived']).optional(),
  recruiter_id: z.string().uuid().optional().nullable(),

  // Manatal-pariteit — Slice 4.5
  job_reference: jobReferenceSchema.optional(),
  headcount: z.number().int().min(1).max(999).optional(),
  experience_level: z.enum(['junior', 'medior', 'senior', 'lead']).optional(),
  contract_type: z.enum(['fulltime', 'parttime', 'contract', 'temp']).optional(),
  contract_details: z.string().max(2000).optional(),
  open_date: isoDate.optional(),
  close_date: isoDate.optional(),
  industry: z.string().max(120).optional(),
  remote_type: z.enum(['onsite', 'hybrid', 'remote']).optional(),
  office_address: z.string().max(500).optional(),
  package_details: z.string().max(2000).optional(),
  currency: z.string().min(2).max(8).optional(),
  salary_frequency: z.enum(['monthly', 'annual', 'hourly']).optional(),
  required_skills: z.array(z.string().min(1).max(120)).max(50).optional(),
  nice_to_have_skills: z.array(z.string().min(1).max(120)).max(50).optional(),

  // Optional pipeline template — defaults to system "Bureau Pipeline" when omitted.
  pipeline_template_id: z.string().uuid().optional(),
});

// PATCH /jobs/:id — pipeline_template_id is intentionally NOT updatable here,
// because swapping templates after stages exist would orphan applications.
// Use POST /jobs/:id/pipeline-template (applyPipelineTemplate) instead.
const updateJobSchema = jobBodySchema.partial().omit({ pipeline_template_id: true });

const applyPipelineTemplateSchema = z.object({
  pipeline_template_id: z.string().uuid().optional(),
});

export async function listJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, status, recruiter_id } = paginationSchema.parse(req.query);
    const result = await jobsService.listJobs(req.user!.tenantId, { page, limit, status, recruiterId: recruiter_id });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function createJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = jobBodySchema.parse(req.body);
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
    res.json(job);
  } catch (err) {
    next(err);
  }
}

export async function updateJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateJobSchema.parse(req.body);
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

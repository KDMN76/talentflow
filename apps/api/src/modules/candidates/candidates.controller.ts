import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as candidatesService from './candidates.service';
import { AppError } from '../../middleware/errorHandler';
import { auditCtxFromReq } from '../../lib/audit';
import {
  paginationSchema,
  createCandidateSchema,
  updateCandidateSchema,
  createCandidateSkillSchema,
} from './candidates.schema';

// ─────────────────────────────────────────────────────────────────────────────
// Bulk-actions schema (Q1.2 — Agent AA)
// ─────────────────────────────────────────────────────────────────────────────
//
// Het service-contract `candidatesService.bulkAction(tenantId, userId, ids,
// action, payload)` wordt door Agent Y geleverd. Deze controller schrijven we
// vóór de merge, dus de import-symbol kan tijdelijk ontbreken — TypeScript
// vangt dat netjes op zodra Y zijn werk pusht. Tot die tijd faalt alleen
// `npx tsc --noEmit` op deze file en de rest blijft compileren.
//
// Action-set is bewust gesloten zodat we zonder schema-wijziging weten welke
// payload-shape per action verwacht wordt.

const BULK_ACTION_MAX = 500;

const bulkActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('archive'),
    ids: z.array(z.string().uuid()).min(1).max(BULK_ACTION_MAX),
    payload: z.object({}).optional(),
  }),
  z.object({
    action: z.literal('add_tag'),
    ids: z.array(z.string().uuid()).min(1).max(BULK_ACTION_MAX),
    payload: z.object({
      tag: z.string().min(1).max(80),
    }),
  }),
  z.object({
    action: z.literal('remove_tag'),
    ids: z.array(z.string().uuid()).min(1).max(BULK_ACTION_MAX),
    payload: z.object({
      tag: z.string().min(1).max(80),
    }),
  }),
  z.object({
    action: z.literal('change_source'),
    ids: z.array(z.string().uuid()).min(1).max(BULK_ACTION_MAX),
    payload: z.object({
      source: z.string().min(1).max(100),
    }),
  }),
  z.object({
    action: z.literal('move_to_stage'),
    ids: z.array(z.string().uuid()).min(1).max(BULK_ACTION_MAX),
    payload: z.object({
      // Voor move_to_stage zijn de `ids` application-uuids, niet candidate-uuids.
      // De service-laag (Y) is verantwoordelijk voor de juiste interpretatie.
      stage_id: z.string().uuid(),
    }),
  }),
]);

export type BulkActionInput = z.infer<typeof bulkActionSchema>;

export async function listCandidates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = paginationSchema.parse(req.query);
    const result = await candidatesService.listCandidates(req.user!.tenantId, {
      page: query.page,
      limit: query.limit,
      search: query.search,
      skills: query.skills ? query.skills.split(',').map((s) => s.trim()) : undefined,
      tags: query.tags ? query.tags.split(',').map((t) => t.trim()) : undefined,
      source: query.source,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function createCandidate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createCandidateSchema.parse(req.body);
    const candidate = await candidatesService.createCandidate(
      req.user!.tenantId,
      req.user!.userId,
      data,
      auditCtxFromReq(req)
    );
    res.status(201).json(candidate);
  } catch (err) {
    next(err);
  }
}

export async function getCandidate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const candidate = await candidatesService.getCandidate(req.user!.tenantId, req.params.id);
    res.json(candidate);
  } catch (err) {
    next(err);
  }
}

export async function updateCandidate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateCandidateSchema.parse(req.body);
    const candidate = await candidatesService.updateCandidate(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      data,
      auditCtxFromReq(req)
    );
    res.json(candidate);
  } catch (err) {
    next(err);
  }
}

export async function deleteCandidate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await candidatesService.deleteCandidate(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ message: 'Kandidaat verwijderd' });
  } catch (err) {
    next(err);
  }
}

export async function uploadResume(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      throw new AppError(400, 'NO_FILE', 'Geen bestand geüpload');
    }
    const result = await candidatesService.uploadResume(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      req.file
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getCandidateTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const timeline = await candidatesService.getCandidateTimeline(req.user!.tenantId, req.params.id);
    res.json({ data: timeline });
  } catch (err) {
    next(err);
  }
}

// ─── Skills ─────────────────────────────────────────────────────────────────

export async function listCandidateSkills(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const skills = await candidatesService.listCandidateSkills(req.user!.tenantId, req.params.id);
    res.json({ data: skills });
  } catch (err) {
    next(err);
  }
}

export async function addCandidateSkill(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createCandidateSkillSchema.parse(req.body);
    const skill = await candidatesService.addCandidateSkill(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      data
    );
    res.status(201).json(skill);
  } catch (err) {
    next(err);
  }
}

export async function deleteCandidateSkill(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await candidatesService.deleteCandidateSkill(
      req.user!.tenantId,
      req.params.id,
      req.params.skillId,
      req.user!.userId
    );
    res.json({ message: 'Skill verwijderd' });
  } catch (err) {
    next(err);
  }
}

// ─── Resumes ─────────────────────────────────────────────────────────────────

export async function listCandidateResumes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const resumes = await candidatesService.listCandidateResumes(req.user!.tenantId, req.params.id);
    res.json({ data: resumes });
  } catch (err) {
    next(err);
  }
}

export async function uploadCandidateResumes(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      throw new AppError(400, 'NO_FILES', 'Geen bestanden geuploaded');
    }
    // Optional flag in body; default true so the first uploaded CV becomes
    // primary if the candidate has none yet.
    const setFirstAsPrimary =
      req.body?.set_first_as_primary === undefined
        ? true
        : req.body.set_first_as_primary === 'true' ||
          req.body.set_first_as_primary === true;

    const resumes = await candidatesService.uploadCandidateResumes(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      files,
      setFirstAsPrimary
    );
    res.status(201).json({ data: resumes });
  } catch (err) {
    next(err);
  }
}

export async function deleteCandidateResume(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await candidatesService.deleteCandidateResume(
      req.user!.tenantId,
      req.params.id,
      req.params.resumeId,
      req.user!.userId
    );
    res.json({ message: 'CV verwijderd' });
  } catch (err) {
    next(err);
  }
}

export async function setPrimaryResume(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await candidatesService.setPrimaryResume(
      req.user!.tenantId,
      req.params.id,
      req.params.resumeId
    );
    res.json({ message: 'Primaire CV ingesteld' });
  } catch (err) {
    next(err);
  }
}

export async function downloadResume(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const url = await candidatesService.getResumeDownloadUrl(
      req.user!.tenantId,
      req.params.id,
      req.params.resumeId
    );
    // 302 redirect — works for both local static paths and S3 presigned URLs.
    res.redirect(302, url);
  } catch (err) {
    next(err);
  }
}

// ─── Pipeline templates ──────────────────────────────────────────────────────

export async function listPipelineTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const templates = await candidatesService.listPipelineTemplates(req.user!.tenantId);
    res.json({ data: templates });
  } catch (err) {
    next(err);
  }
}

// ─── Bulk actions (Q1.2 — Agent AA) ─────────────────────────────────────────
//
// POST /api/candidates/bulk-actions
//
// Body: { ids: uuid[1..500], action: 'archive'|'add_tag'|'remove_tag'|
//                                   'change_source'|'move_to_stage',
//         payload?: object }
//
// RLS isoleert per-tenant zodra de service `withTenant` aanroept; de
// `id IN (...)`-filter combineert daarmee tot een dubbele guard. Audit-log
// + activity-log gebeurt in de service zelf — we sturen alleen `affected`
// terug zodat de UI een toast kan tonen.

export async function bulkActionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = bulkActionSchema.parse(req.body);

    // Service-functie wordt door Agent Y aangeleverd. We castten via
    // `unknown` zodat deze controller compileert ook als de symbol nog niet
    // bestaat in de service — dat is nodig voor de Q1.2 split waar Y en AA
    // parallel werken aan dezelfde module.
    const svc = candidatesService as unknown as {
      bulkAction?: (
        tenantId: string,
        userId: string,
        ids: string[],
        action: BulkActionInput['action'],
        payload: Record<string, unknown> | undefined,
        ctx: ReturnType<typeof auditCtxFromReq>
      ) => Promise<{ affected: number } | number>;
    };

    if (typeof svc.bulkAction !== 'function') {
      // Defensief: als de service-functie niet beschikbaar is (Agent Y nog
      // niet gemerged), geven we 503 i.p.v. een 500/uncaught.
      throw new AppError(
        503,
        'BULK_ACTIONS_UNAVAILABLE',
        'Bulk-actions service nog niet beschikbaar — wacht op nieuwe deploy'
      );
    }

    const payload = ('payload' in parsed ? parsed.payload : undefined) as
      | Record<string, unknown>
      | undefined;

    const result = await svc.bulkAction(
      req.user!.tenantId,
      req.user!.userId,
      parsed.ids,
      parsed.action,
      payload,
      auditCtxFromReq(req)
    );

    const affected =
      typeof result === 'number'
        ? result
        : typeof result?.affected === 'number'
          ? result.affected
          : parsed.ids.length;

    res.json({ affected });
  } catch (err) {
    next(err);
  }
}

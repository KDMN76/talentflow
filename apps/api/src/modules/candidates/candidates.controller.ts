import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import * as candidatesService from './candidates.service';
import { MUTABLE_CANDIDATE_COLUMNS } from './candidates.service';
import { findDuplicatesForCandidate, mergeCandidates } from './dedupe.service';
import {
  previewCsv,
  startCsvImport as startCsvImportService,
  getImportStatus,
  type CsvImport,
  type CsvImportStatus,
} from './bulkImport.service';
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

export async function getCandidateDuplicates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const matches = await findDuplicatesForCandidate(req.user!.tenantId, req.params.id);
    // De service levert {candidate_id, candidate_name, match_reason, confidence};
    // de web-UI (lib/types/atsExtensions.ts DedupeMatch + de duplicaten-banner)
    // leest {candidate_id (=bron), matched_candidate_id, matched_name,
    // matched_email, reason, score}. Map hier zodat de banner de naam toont en
    // de merge-dialog een geldige duplicate-id krijgt. matched_email is niet
    // beschikbaar in de detectie-query → null (banner gebruikt het niet).
    const data = matches.map((m) => ({
      candidate_id: req.params.id,
      matched_candidate_id: m.candidate_id,
      matched_name: m.candidate_name,
      matched_email: null as string | null,
      reason: m.match_reason,
      score: m.confidence,
    }));
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// ─── Merge (dedupe) ──────────────────────────────────────────────────────────
//
// POST /api/candidates/merge
//
// Frontend (hooks/useDedupe.ts → useMergeCandidates) stuurt de UI-shape
// { primary_id, duplicate_id, choices: [{ field, source }] }. De service
// mergeCandidates() verwacht { primary_id, duplicate_ids: string[],
// field_choices: Record<field, 'primary'|'duplicate'> }. We valideren met zod
// en mappen: duplicate_id → duplicate_ids:[duplicate_id], choices → reduce naar
// field_choices. Resultaat { merged_into, merged_count } gaat plat terug (de
// hook leest de response niet uit, maar we houden het contract eerlijk).

const mergeCandidatesSchema = z
  .object({
    primary_id: z.string().uuid(),
    duplicate_id: z.string().uuid(),
    choices: z
      .array(
        z.object({
          // Whitelist tegen de kolommen die mergeCandidates() daadwerkelijk
          // mag muteren — voorkomt SQL-injectie via een willekeurige
          // kolomnaam (zie dedupe.service.ts MUTABLE_CANDIDATE_COLUMN_SET
          // voor de defense-in-depth check in de service-laag zelf).
          field: z.enum(MUTABLE_CANDIDATE_COLUMNS),
          source: z.enum(['primary', 'duplicate']),
        })
      )
      .default([]),
  })
  .refine((d) => d.primary_id !== d.duplicate_id, {
    message: 'primary_id en duplicate_id mogen niet gelijk zijn',
    path: ['duplicate_id'],
  });

export async function mergeCandidatesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = mergeCandidatesSchema.parse(req.body);

    const field_choices = parsed.choices.reduce<Record<string, 'primary' | 'duplicate'>>(
      (acc, c) => {
        acc[c.field] = c.source;
        return acc;
      },
      {}
    );

    const result = await mergeCandidates(
      req.user!.tenantId,
      req.user!.userId,
      {
        primary_id: parsed.primary_id,
        duplicate_ids: [parsed.duplicate_id],
        field_choices,
      },
      auditCtxFromReq(req)
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ─── CSV bulk-import ─────────────────────────────────────────────────────────
//
// Drie endpoints, gemapt op de service in bulkImport.service.ts:
//   POST /import/preview  (multipart, veld 'file')  → ImportPreviewResponse
//   POST /import/start    (multipart, veld 'file' + 'mapping')  → ImportStatusResponse
//   GET  /imports/:id     → ImportStatusResponse
//
// Architectuur-keuze: preview persisteert niets en genereert een placeholder
// import_id; de UI houdt het bestand vast en uploadt het bij `start` opnieuw.
// `start` maakt dan pas de csv_imports-rij aan (service startCsvImport) en we
// geven de status van díe rij terug. Zo delen preview en start géén server-side
// id — de UI pollt op de id uit de start-response (BulkImportDialog gebruikt
// `initial.id`).

// Service-status (pending|parsing|importing|done|failed) → UI-status
// (uploaded|previewed|processing|done|failed). Alleen de terminale statussen
// sturen de UI-stap; alle tussenstanden mappen op 'processing'.
const IMPORT_STATUS_MAP: Record<CsvImportStatus, 'processing' | 'done' | 'failed'> = {
  pending: 'processing',
  parsing: 'processing',
  importing: 'processing',
  done: 'done',
  failed: 'failed',
};

function toImportStatusResponse(row: CsvImport) {
  return {
    id: row.id,
    status: IMPORT_STATUS_MAP[row.status] ?? 'processing',
    total_rows: row.total_rows,
    processed_rows: row.processed_rows,
    imported_count: row.imported_count,
    skipped_count: row.skipped_count,
    error_count: row.error_count,
    error_csv_url: null as string | null,
    started_at: row.created_at,
    finished_at: row.completed_at,
  };
}

export async function previewCsvImport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.file) {
      throw new AppError(400, 'NO_FILE', 'Geen CSV-bestand geüpload');
    }
    const preview = await previewCsv(req.user!.tenantId, req.file.buffer);

    // Map service-shape → UI ImportPreviewResponse:
    //   detected_columns → headers, sample → rows, duplicates_predicted →
    //   duplicate_count. import_id is een placeholder (zie blok-comment).
    res.json({
      import_id: randomUUID(),
      headers: preview.detected_columns,
      rows: preview.sample.map((values, idx) => ({
        row: idx + 1,
        values,
        duplicate_of: null as string | null,
      })),
      total_rows: preview.total_rows,
      suggested_mapping: preview.suggested_mapping,
      duplicate_count: preview.duplicates_predicted,
    });
  } catch (err) {
    next(err);
  }
}

const startImportSchema = z.object({
  mapping: z.record(z.string(), z.string()),
});

export async function startCsvImportHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.file) {
      throw new AppError(400, 'NO_FILE', 'Geen CSV-bestand geüpload');
    }

    // `mapping` komt via FormData binnen als JSON-string (of eventueel als
    // los object). Parse defensief en valideer met zod.
    let rawMapping: unknown = req.body?.mapping;
    if (typeof rawMapping === 'string') {
      try {
        rawMapping = JSON.parse(rawMapping);
      } catch {
        throw new AppError(400, 'INVALID_MAPPING', 'mapping is geen geldige JSON');
      }
    }
    const { mapping } = startImportSchema.parse({ mapping: rawMapping ?? {} });

    const { import_id } = await startCsvImportService(
      req.user!.tenantId,
      req.user!.userId,
      req.file.buffer,
      req.file.originalname,
      mapping,
      auditCtxFromReq(req)
    );

    const row = await getImportStatus(req.user!.tenantId, import_id);
    res.json(toImportStatusResponse(row));
  } catch (err) {
    next(err);
  }
}

export async function getImportStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const row = await getImportStatus(req.user!.tenantId, req.params.id);
    res.json(toImportStatusResponse(row));
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

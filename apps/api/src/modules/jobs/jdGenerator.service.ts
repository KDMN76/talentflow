/**
 * JD Generator service — Sprint Q3.2.
 *
 * Wraps de lib/jdGenerator-aanroep met:
 *   • RLS-veilige persistence in `jd_drafts`
 *   • A/B variant select + regenerate flows
 *   • Publish-flow die een echte `jobs`-rij aanmaakt op basis van geselecteerde
 *     variant + recruiter-overrides
 *   • Audit + ai_events logging conform Q1.1
 *
 * Variant-strategie: 1 Claude-call met N varianten in JSON output. Reden:
 *   - Minder system-prompt tokens (1× ipv N×)
 *   - Het model kan onderscheid maken tussen varianten
 *   - Atomair voor rate-limiting / latency
 * Voor regenerate-1-variant gebruiken we een aparte 1-call.
 */

import type { PoolClient } from 'pg';
import { z } from 'zod';
import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { logAIEvent } from '../../lib/aiEvents';
import {
  generateJd,
  generateSingleJdVariant,
  type JdGeneratorInput,
  type JdVariant,
  type GenerateJdMeta,
} from '../../lib/jdGenerator';
import {
  createJob as createJobRow,
  type CreateJobInput,
} from './jobs.service';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type JdDraftStatus = 'draft' | 'published' | 'discarded';

export interface JdDraft {
  id: string;
  tenant_id: string;
  user_id: string | null;
  prompt: string;
  parameters: JdGeneratorInput;
  variants: JdVariant[];
  selected_variant_id: string | null;
  status: JdDraftStatus;
  job_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas (re-used by controller)
// ─────────────────────────────────────────────────────────────────────────────

export const jdGeneratorInputSchema = z.object({
  role: z.string().trim().min(2).max(200),
  level: z.enum(['junior', 'medior', 'senior', 'lead', 'director']).optional(),
  key_skills: z.array(z.string().min(1).max(80)).max(30).optional(),
  must_haves: z.array(z.string().min(1).max(200)).max(20).optional(),
  nice_to_haves: z.array(z.string().min(1).max(200)).max(20).optional(),
  tone: z.enum(['formal', 'casual', 'direct', 'enthusiastic']).optional(),
  length: z.enum(['short', 'medium', 'long']).optional(),
  language: z.enum(['nl', 'en', 'de', 'fr']).optional(),
  company_context: z.string().max(2000).optional(),
  generate_variants: z.number().int().min(1).max(5).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface JdDraftRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  prompt: string;
  parameters: JdGeneratorInput | string;
  variants: JdVariant[] | string;
  selected_variant_id: string | null;
  status: JdDraftStatus;
  job_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function parseJson<T>(value: T | string, fallback: T): T {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToDraft(row: JdDraftRow): JdDraft {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    prompt: row.prompt,
    parameters: parseJson(row.parameters, {} as JdGeneratorInput),
    variants: parseJson(row.variants, [] as JdVariant[]),
    selected_variant_id: row.selected_variant_id,
    status: row.status,
    job_id: row.job_id,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function findVariant(draft: JdDraft, variantId: string): JdVariant {
  const variant = draft.variants.find((v) => v.id === variantId);
  if (!variant) {
    throw new AppError(
      404,
      'JD_VARIANT_NOT_FOUND',
      'Variant niet gevonden in deze draft'
    );
  }
  return variant;
}

async function loadDraftByIdWithLock(
  client: PoolClient,
  tenantId: string,
  draftId: string
): Promise<JdDraft> {
  const { rows } = await client.query<JdDraftRow>(
    `SELECT * FROM jd_drafts
      WHERE id = $1 AND tenant_id = $2
      FOR UPDATE`,
    [draftId, tenantId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'JD_DRAFT_NOT_FOUND', 'JD-draft niet gevonden');
  }
  return rowToDraft(rows[0]);
}

function logAIEventForDraft(args: {
  tenantId: string;
  userId: string | null;
  draftId: string;
  meta: GenerateJdMeta;
  variantsCount: number;
  promptHash: string;
  cached?: boolean;
}): void {
  void logAIEvent(args.tenantId, {
    feature: 'jd_generator',
    model: args.meta.model,
    provider: args.meta.mocked ? 'mock' : 'anthropic',
    input: args.promptHash,
    inputTokens: args.meta.inputTokens,
    outputTokens: args.meta.outputTokens,
    outputSummary: `Generated ${args.variantsCount} variant(s)`,
    latencyMs: args.meta.latencyMs,
    entityType: 'jd_draft',
    entityId: args.draftId,
    cached: args.cached ?? false,
    userId: args.userId,
    status: args.meta.mocked ? 'mocked' : 'success',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD + workflow
// ─────────────────────────────────────────────────────────────────────────────

export async function createJdDraft(
  tenantId: string,
  userId: string,
  input: JdGeneratorInput,
  ctx: AuditContext = {}
): Promise<JdDraft> {
  // 1) AI call (buiten transactie — kan lang duren).
  const result = await generateJd(input);

  // 2) Persist + audit binnen RLS-transactie.
  const draft = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<JdDraftRow>(
      `INSERT INTO jd_drafts
         (tenant_id, user_id, prompt, parameters, variants, status)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'draft')
       RETURNING *`,
      [
        tenantId,
        userId,
        input.role,
        JSON.stringify(input),
        JSON.stringify(result.variants),
      ]
    );
    const created = rowToDraft(rows[0]);

    await logAudit(
      client,
      tenantId,
      {
        action: 'jd_draft.created',
        entityType: 'jd_draft',
        entityId: created.id,
        after: {
          id: created.id,
          variants_count: created.variants.length,
          parameters: created.parameters,
          mocked: result.mocked,
          model: result._meta.model,
        },
        userId,
      },
      ctx
    );
    return created;
  });

  // 3) ai_events — buiten transactie zodat audit-fail niet de hoofdactie raakt.
  logAIEventForDraft({
    tenantId,
    userId,
    draftId: draft.id,
    meta: result._meta,
    variantsCount: draft.variants.length,
    promptHash: JSON.stringify({ role: input.role, level: input.level }),
  });

  return draft;
}

export async function listJdDrafts(
  tenantId: string,
  filters: { userId?: string; status?: JdDraftStatus; limit?: number } = {}
): Promise<JdDraft[]> {
  const { userId, status } = filters;
  const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));

  return withTenant(tenantId, async (client) => {
    const conditions: string[] = [`tenant_id = $1`];
    const values: unknown[] = [tenantId];
    let idx = 2;

    if (userId) {
      conditions.push(`user_id = $${idx++}`);
      values.push(userId);
    }
    if (status) {
      conditions.push(`status = $${idx++}`);
      values.push(status);
    }

    const { rows } = await client.query<JdDraftRow>(
      `SELECT * FROM jd_drafts
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${idx}`,
      [...values, limit]
    );
    return rows.map(rowToDraft);
  });
}

export async function getJdDraft(
  tenantId: string,
  draftId: string
): Promise<JdDraft> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<JdDraftRow>(
      `SELECT * FROM jd_drafts WHERE id = $1 AND tenant_id = $2`,
      [draftId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'JD_DRAFT_NOT_FOUND', 'JD-draft niet gevonden');
    }
    return rowToDraft(rows[0]);
  });
}

export async function selectVariant(
  tenantId: string,
  draftId: string,
  variantId: string,
  userId: string,
  ctx: AuditContext = {}
): Promise<JdDraft> {
  return withTenant(tenantId, async (client) => {
    const draft = await loadDraftByIdWithLock(client, tenantId, draftId);
    if (draft.status !== 'draft') {
      throw new AppError(
        409,
        'JD_DRAFT_NOT_EDITABLE',
        `Draft is ${draft.status} en kan niet meer aangepast worden`
      );
    }
    findVariant(draft, variantId); // throwt 404 indien niet gevonden

    const { rows } = await client.query<JdDraftRow>(
      `UPDATE jd_drafts
          SET selected_variant_id = $1,
              updated_at = now()
        WHERE id = $2 AND tenant_id = $3
        RETURNING *`,
      [variantId, draftId, tenantId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'jd_draft.variant_selected',
        entityType: 'jd_draft',
        entityId: draftId,
        before: { selected_variant_id: draft.selected_variant_id },
        after: { selected_variant_id: variantId },
        userId,
      },
      ctx
    );

    return rowToDraft(rows[0]);
  });
}

export async function regenerateVariant(
  tenantId: string,
  draftId: string,
  variantId: string,
  userId: string,
  ctx: AuditContext = {}
): Promise<JdDraft> {
  // 1) Load huidige draft (read-only) buiten transactie zodat de Claude-call
  //    niet binnen een DB-transactie hangt.
  const current = await getJdDraft(tenantId, draftId);
  if (current.status !== 'draft') {
    throw new AppError(
      409,
      'JD_DRAFT_NOT_EDITABLE',
      `Draft is ${current.status} en kan niet meer aangepast worden`
    );
  }
  const oldVariant = findVariant(current, variantId);

  // 2) AI call voor 1 nieuwe variant met dezelfde parameters.
  const result = await generateSingleJdVariant(current.parameters);

  // 3) Vervang variant in array, persist, audit.
  const updated = await withTenant(tenantId, async (client) => {
    const draft = await loadDraftByIdWithLock(client, tenantId, draftId);
    // Re-check status (kan in race condition gewijzigd zijn).
    if (draft.status !== 'draft') {
      throw new AppError(
        409,
        'JD_DRAFT_NOT_EDITABLE',
        `Draft is ${draft.status} en kan niet meer aangepast worden`
      );
    }
    const newVariants = draft.variants.map((v) =>
      v.id === variantId ? result.variant : v
    );
    // Als geselecteerde variant geregenereerd wordt, reset selectie.
    const newSelected =
      draft.selected_variant_id === variantId ? null : draft.selected_variant_id;

    const { rows } = await client.query<JdDraftRow>(
      `UPDATE jd_drafts
          SET variants = $1::jsonb,
              selected_variant_id = $2,
              updated_at = now()
        WHERE id = $3 AND tenant_id = $4
        RETURNING *`,
      [JSON.stringify(newVariants), newSelected, draftId, tenantId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'jd_draft.variant_regenerated',
        entityType: 'jd_draft',
        entityId: draftId,
        before: { variant_id: variantId, title: oldVariant.title },
        after: {
          variant_id: result.variant.id,
          title: result.variant.title,
          mocked: result.mocked,
          model: result._meta.model,
        },
        userId,
      },
      ctx
    );
    return rowToDraft(rows[0]);
  });

  logAIEventForDraft({
    tenantId,
    userId,
    draftId,
    meta: result._meta,
    variantsCount: 1,
    promptHash: JSON.stringify({
      role: current.parameters.role,
      level: current.parameters.level,
      regenerate: true,
    }),
  });

  return updated;
}

export async function discardJdDraft(
  tenantId: string,
  draftId: string,
  userId: string,
  ctx: AuditContext = {}
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const draft = await loadDraftByIdWithLock(client, tenantId, draftId);
    if (draft.status === 'published') {
      throw new AppError(
        409,
        'JD_DRAFT_PUBLISHED',
        'Een gepubliceerde draft kan niet worden weggegooid (verwijder de gekoppelde job).'
      );
    }
    if (draft.status === 'discarded') {
      // Idempotent — al weggegooid.
      return;
    }
    await client.query(
      `UPDATE jd_drafts
          SET status = 'discarded', updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [draftId, tenantId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'jd_draft.discarded',
        entityType: 'jd_draft',
        entityId: draftId,
        before: { status: draft.status },
        after: { status: 'discarded' },
        userId,
      },
      ctx
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Publish — draft → echte job
// ─────────────────────────────────────────────────────────────────────────────

export type JobOverrides = Partial<
  Omit<CreateJobInput, 'title' | 'description' | 'pipeline_template_id'>
> & {
  pipeline_template_id?: string;
};

export interface PublishResult {
  draft: JdDraft;
  job: Record<string, unknown>;
}

export async function publishJdDraft(
  tenantId: string,
  draftId: string,
  userId: string,
  overrides: JobOverrides = {},
  ctx: AuditContext = {}
): Promise<PublishResult> {
  // 1) Load draft, valideer state + selectie.
  const draft = await getJdDraft(tenantId, draftId);
  if (draft.status === 'published') {
    throw new AppError(
      409,
      'JD_DRAFT_ALREADY_PUBLISHED',
      'Deze draft is al gepubliceerd'
    );
  }
  if (draft.status === 'discarded') {
    throw new AppError(
      409,
      'JD_DRAFT_DISCARDED',
      'Deze draft is weggegooid en kan niet worden gepubliceerd'
    );
  }
  if (!draft.selected_variant_id) {
    throw new AppError(
      400,
      'JD_DRAFT_NO_SELECTION',
      'Selecteer eerst een variant voordat je publiceert'
    );
  }
  const variant = findVariant(draft, draft.selected_variant_id);

  // 2) Bouw CreateJobInput — variant levert title + description, overrides
  //    vullen de rest aan. We nemen 'open' als default status zodat de
  //    vacature direct zichtbaar is na publish; recruiter kan het altijd
  //    overrulen via overrides.status.
  const jobInput: CreateJobInput = {
    title: variant.title,
    description: variant.description,
    status: overrides.status ?? 'open',
    employment_type: overrides.employment_type ?? undefined,
    department: overrides.department ?? null,
    location: overrides.location ?? null,
    salary_min: overrides.salary_min ?? null,
    salary_max: overrides.salary_max ?? null,
    recruiter_id: overrides.recruiter_id ?? userId,
    headcount: overrides.headcount ?? null,
    experience_level: overrides.experience_level ?? null,
    contract_type: overrides.contract_type ?? null,
    contract_details: overrides.contract_details ?? null,
    open_date: overrides.open_date ?? null,
    close_date: overrides.close_date ?? null,
    industry: overrides.industry ?? null,
    remote_type: overrides.remote_type ?? null,
    office_address: overrides.office_address ?? null,
    package_details: overrides.package_details ?? null,
    currency: overrides.currency ?? null,
    salary_frequency: overrides.salary_frequency ?? null,
    required_skills:
      overrides.required_skills ?? draft.parameters.key_skills ?? null,
    nice_to_have_skills:
      overrides.nice_to_have_skills ?? draft.parameters.nice_to_haves ?? null,
    pipeline_template_id: overrides.pipeline_template_id,
  };

  // 3) createJob handelt zelf RLS + audit + embedding-queue af.
  const job = await createJobRow(tenantId, userId, jobInput, ctx);

  // 4) Update draft → published binnen aparte tx.
  const updatedDraft = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<JdDraftRow>(
      `UPDATE jd_drafts
          SET status = 'published',
              job_id = $1,
              updated_at = now()
        WHERE id = $2 AND tenant_id = $3
        RETURNING *`,
      [job.id, draftId, tenantId]
    );
    if (rows.length === 0) {
      // Edge-case: race-condition; we hebben de job aangemaakt maar de update
      // faalt. Logger waarschuwt zodat ops het kan herstellen.
      logger.error('[jdGenerator] published job aangemaakt maar draft-update faalde', {
        tenantId,
        draftId,
        jobId: job.id,
      });
      throw new AppError(
        500,
        'JD_DRAFT_UPDATE_FAILED',
        'Job is aangemaakt maar draft kon niet worden bijgewerkt — neem contact op met support'
      );
    }
    await logAudit(
      client,
      tenantId,
      {
        action: 'jd_draft.published',
        entityType: 'jd_draft',
        entityId: draftId,
        before: { status: 'draft', job_id: null },
        after: {
          status: 'published',
          job_id: job.id,
          variant_id: variant.id,
        },
        userId,
      },
      ctx
    );
    return rowToDraft(rows[0]);
  });

  return { draft: updatedDraft, job: job as Record<string, unknown> };
}

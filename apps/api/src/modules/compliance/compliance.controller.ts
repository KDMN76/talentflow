/**
 * Compliance controller — Sprint Q2.3.
 *
 * Wrappers rond de retention/dsar/anonymization-services. Iedere
 * handler:
 *   1. Valideert input via zod.
 *   2. Geeft de tenantId/userId uit JWT door aan de service.
 *   3. Vertaalt service-result naar HTTP-respons.
 *
 * Audit-events worden in de services geschreven — controller logt niets
 * extra.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auditCtxFromReq } from '../../lib/audit';
import { withTenant } from '../../db/pool';
import * as retentionService from './retention.service';
import * as dsarService from './dsar.service';
import {
  anonymizeCandidatePermanently,
  generateAnonymizedResumePdf,
} from './anonymization.service';
import { generateCandidateSelfToken } from './selfService.service';
import { DEFAULT_ANONYMIZATION_RULES } from '../../lib/anonymization';
import {
  getPaySettings,
  updatePaySettings,
} from './payTransparency.service';
import {
  generatePayEquityReport,
  listPayEquitySnapshots,
} from './payEquity.service';
import {
  generateDeiFunnel,
  listDeiFunnelSnapshots,
} from './deiFunnel.service';
import * as auditService from './audit.service';

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const retentionPolicyBodySchema = z.object({
  entity_type: z.enum(['candidate', 'application']),
  retention_months: z.number().int().min(1).max(120),
  trigger_field: z.enum(['last_activity_at', 'created_at', 'rejected_at']).optional(),
  action_on_expiry: z.enum(['archive', 'anonymize', 'delete']),
  enabled: z.boolean().optional(),
});

const retentionPolicyPatchSchema = z.object({
  retention_months: z.number().int().min(1).max(120).optional(),
  trigger_field: z.enum(['last_activity_at', 'created_at', 'rejected_at']).optional(),
  action_on_expiry: z.enum(['archive', 'anonymize', 'delete']).optional(),
  enabled: z.boolean().optional(),
});

const dsarBodySchema = z.object({
  candidate_id: z.string().uuid().nullable().optional(),
  request_type: z.enum(['access', 'export', 'correction', 'deletion']),
  requester_email: z.string().email(),
  requested_via: z.enum(['self_portal', 'email', 'admin']).optional(),
  notes: z.string().max(2000).optional(),
});

const dsarPatchSchema = z.object({
  status: z.enum(['fulfilled', 'rejected', 'in_progress']),
  notes: z.string().max(2000).optional(),
  response_url: z.string().url().optional(),
});

const retentionExcludeBody = z.object({
  excluded: z.boolean(),
  reason: z.string().max(500).optional(),
});

// ─── Sprint Q3.6 schemas ────────────────────────────────────────────────────

const paySettingsPatchSchema = z.object({
  pay_transparency_enforced: z.boolean().optional(),
  prohibit_current_salary_questions: z.boolean().optional(),
  reporting_threshold: z.number().int().min(1).max(100000).optional(),
  default_currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 3-letter currency').optional(),
  benchmark_data_consent: z.boolean().optional(),
});

const periodBodySchema = z.object({
  from: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
    message: 'from moet een geldige datum zijn',
  }),
  to: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
    message: 'to moet een geldige datum zijn',
  }),
  job_category: z.string().min(1).max(120).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Retention policies
// ─────────────────────────────────────────────────────────────────────────────

export async function listRetentionPoliciesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const policies = await retentionService.listRetentionPolicies(
      req.user!.tenantId
    );
    res.json({ data: policies });
  } catch (err) {
    next(err);
  }
}

export async function createRetentionPolicyHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = retentionPolicyBodySchema.parse(req.body);
    const policy = await retentionService.createRetentionPolicy(
      req.user!.tenantId,
      req.user!.userId,
      input,
      auditCtxFromReq(req)
    );
    res.status(201).json({ data: policy });
  } catch (err) {
    next(err);
  }
}

export async function updateRetentionPolicyHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = retentionPolicyPatchSchema.parse(req.body);
    const policy = await retentionService.updateRetentionPolicy(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      input,
      auditCtxFromReq(req)
    );
    res.json({ data: policy });
  } catch (err) {
    next(err);
  }
}

export async function deleteRetentionPolicyHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await retentionService.deleteRetentionPolicy(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DSAR
// ─────────────────────────────────────────────────────────────────────────────

export async function listDsarRequestsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const filters = {
      status: typeof req.query.status === 'string'
        ? (req.query.status as dsarService.DsarStatus)
        : undefined,
      request_type: typeof req.query.request_type === 'string'
        ? (req.query.request_type as dsarService.DsarRequestType)
        : undefined,
      candidate_id: typeof req.query.candidate_id === 'string'
        ? req.query.candidate_id
        : undefined,
      created_since: typeof req.query.created_since === 'string'
        ? req.query.created_since
        : undefined,
    };
    const data = await dsarService.listDsarRequests(req.user!.tenantId, filters);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function createDsarRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = dsarBodySchema.parse(req.body);
    const created = await dsarService.createDsarRequest(
      req.user!.tenantId,
      input.candidate_id ?? null,
      input.request_type,
      input.requester_email,
      input.requested_via ?? 'admin',
      input.notes,
      auditCtxFromReq(req),
      req.user!.userId
    );
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
}

export async function updateDsarRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = dsarPatchSchema.parse(req.body);
    const updated = await dsarService.fulfillDsarRequest(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      input,
      auditCtxFromReq(req)
    );
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}

export async function exportDsarRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dsar = await dsarService.getDsarRequest(
      req.user!.tenantId,
      req.params.id
    );
    if (!dsar.candidate_id) {
      res.status(400).json({
        error: {
          code: 'DSAR_NO_CANDIDATE',
          message: 'DSAR-verzoek heeft geen gekoppelde kandidaat',
          details: {},
        },
      });
      return;
    }
    const { buffer, filename } = await dsarService.generateDataExportZip(
      req.user!.tenantId,
      dsar.candidate_id,
      auditCtxFromReq(req),
      req.user!.userId
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit / AI events browse
// ─────────────────────────────────────────────────────────────────────────────

export async function listAuditEventsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const limit = Math.min(
      parseInt(String(req.query.limit ?? '100'), 10) || 100,
      1000
    );

    let cursor: { created_at: string; id: string } | null = null;
    if (typeof req.query.cursor === 'string' && req.query.cursor) {
      try {
        const decoded = JSON.parse(
          Buffer.from(req.query.cursor, 'base64url').toString('utf8')
        );
        if (
          decoded &&
          typeof decoded.created_at === 'string' &&
          typeof decoded.id === 'string'
        ) {
          cursor = decoded;
        }
      } catch {
        /* invalid cursor — ignore, start from beginning */
      }
    }

    const result = await auditService.listAuditEvents(tenantId, {
      entity_type:
        typeof req.query.entity_type === 'string'
          ? req.query.entity_type
          : undefined,
      entity_id:
        typeof req.query.entity_id === 'string'
          ? req.query.entity_id
          : undefined,
      user_id:
        typeof req.query.user_id === 'string' ? req.query.user_id : undefined,
      action_pattern:
        typeof req.query.action_pattern === 'string'
          ? req.query.action_pattern
          : typeof req.query.action === 'string'
            ? req.query.action
            : undefined,
      from:
        typeof req.query.from === 'string'
          ? req.query.from
          : typeof req.query.since === 'string'
            ? req.query.since
            : undefined,
      to:
        typeof req.query.to === 'string'
          ? req.query.to
          : typeof req.query.until === 'string'
            ? req.query.until
            : undefined,
      search:
        typeof req.query.search === 'string' ? req.query.search : undefined,
      cursor,
      limit,
    });

    const next_cursor_encoded = result.next_cursor
      ? Buffer.from(JSON.stringify(result.next_cursor)).toString('base64url')
      : null;

    res.json({
      data: result.data,
      meta: {
        limit,
        has_more: result.has_more,
        next_cursor: next_cursor_encoded,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getEntityAuditHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await auditService.getEntityAuditHistory(
      req.user!.tenantId,
      req.params.type,
      req.params.id
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function listAuditActionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await auditService.listDistinctAuditActions(
      req.user!.tenantId
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function exportAuditTrailHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const format = req.body?.format === 'json' ? 'json' : 'csv';
    const filters = (req.body?.filters ?? {}) as auditService.ListAuditFilters;
    const { buffer, filename, contentType } = await auditService.exportAuditTrail(
      req.user!.tenantId,
      req.user!.userId,
      filters,
      format,
      auditCtxFromReq(req)
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
}

export async function listAiEventsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const limit = Math.min(
      parseInt(String(req.query.limit ?? '100'), 10) || 100,
      500
    );
    const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
    const feature = typeof req.query.feature === 'string' ? req.query.feature : null;
    const since = typeof req.query.since === 'string' ? req.query.since : null;

    const data = await withTenant(tenantId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const values: unknown[] = [tenantId];
      let idx = 2;
      if (feature) {
        conditions.push(`feature = $${idx++}`);
        values.push(feature);
      }
      if (since) {
        conditions.push(`created_at >= $${idx++}`);
        values.push(since);
      }
      const { rows } = await client.query(
        `SELECT id, user_id, feature, model, provider, input_tokens, output_tokens,
                output_summary, latency_ms, cost_cents, entity_type, entity_id,
                cached, status, error, created_at
           FROM ai_events
          WHERE ${conditions.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT $${idx++} OFFSET $${idx}`,
        [...values, limit, offset]
      );
      return rows;
    });
    res.json({ data, meta: { limit, offset } });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate-level compliance handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function anonymizeCandidateHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await anonymizeCandidatePermanently(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function generateSelfServiceTokenHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await generateCandidateSelfToken(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function setCandidateRetentionExcludedHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = retentionExcludeBody.parse(req.body);
    await retentionService.setCandidateRetentionExcluded(
      req.user!.tenantId,
      req.params.id,
      input.excluded,
      input.reason ?? null,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function downloadAnonymizedResumeHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { buffer, filename } = await generateAnonymizedResumePdf(
      req.user!.tenantId,
      req.params.resumeId,
      DEFAULT_ANONYMIZATION_RULES,
      auditCtxFromReq(req),
      req.user!.userId
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint Q3.6 — Pay Transparency Directive 2026 + DEI funnel + pay-equity
// ─────────────────────────────────────────────────────────────────────────────

export async function getPaySettingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await getPaySettings(req.user!.tenantId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function updatePaySettingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = paySettingsPatchSchema.parse(req.body);
    const data = await updatePaySettings(
      req.user!.tenantId,
      req.user!.userId,
      input,
      auditCtxFromReq(req)
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function generatePayEquityHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = periodBodySchema.parse(req.body);
    const data = await generatePayEquityReport(
      req.user!.tenantId,
      {
        from: new Date(input.from),
        to: new Date(input.to),
        jobCategory: input.job_category,
      },
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function listPayEquitySnapshotsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const limit = Math.min(
      parseInt(String(req.query.limit ?? '12'), 10) || 12,
      100
    );
    const data = await listPayEquitySnapshots(req.user!.tenantId, limit);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function generateDeiFunnelHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = periodBodySchema.parse(req.body);
    const data = await generateDeiFunnel(
      req.user!.tenantId,
      {
        from: new Date(input.from),
        to: new Date(input.to),
      },
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function listDeiFunnelSnapshotsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const limit = Math.min(
      parseInt(String(req.query.limit ?? '100'), 10) || 100,
      1000
    );
    const data = await listDeiFunnelSnapshots(req.user!.tenantId, limit);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

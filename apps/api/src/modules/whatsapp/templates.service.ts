/**
 * WhatsApp templates service — Sprint Q4.6 (Agent ZZZ).
 *
 * Owns the CRUD + submit/sync lifecycle of `whatsapp_templates`. Templates
 * are Meta-reviewed and required for any outbound contact outside the 24h
 * open-conversation window.
 *
 * State machine:
 *   draft ──► submitted ──► approved
 *                 │              │
 *                 │              ├──► paused (manually) ──► disabled
 *                 │              └──► disabled (manually)
 *                 └──► rejected
 *
 * Mock-mode (default): `submitTemplate` auto-approves after 2 seconds via
 * a setTimeout listener on `dialog360.mockEvents`. End-to-end tests use
 * vi.useFakeTimers() to advance time.
 */

import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import * as dialog360 from './connector/dialog360';
import { loadConnectorCreds, getIntegrationWithSecrets } from './whatsapp.service';

export interface TemplateRow {
  id: string;
  tenant_id: string;
  integration_id: string | null;
  name: string;
  external_id: string | null;
  language: string;
  category: 'marketing' | 'utility' | 'authentication' | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'paused' | 'disabled';
  header: Record<string, unknown> | null;
  body: string;
  footer: string | null;
  buttons: unknown[];
  example_variables: unknown[];
  rejection_reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OperationCtx {
  userId: string;
  auditCtx?: AuditContext;
}

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: 'marketing' | 'utility' | 'authentication';
  header?: { type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'; text?: string; media_url?: string } | null;
  body: string;
  footer?: string | null;
  buttons?: unknown[];
  example_variables?: unknown[];
}

export async function createTemplate(
  tenantId: string,
  input: CreateTemplateInput,
  ctx: OperationCtx
): Promise<TemplateRow> {
  const integration = await getIntegrationWithSecrets(tenantId);

  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<TemplateRow>(
      `INSERT INTO whatsapp_templates
         (tenant_id, integration_id, name, language, category,
          header, body, footer, buttons, example_variables, status, created_by)
       VALUES ($1, $2, $3, $4, $5,
               $6::jsonb, $7, $8, $9::jsonb, $10::jsonb, 'draft', $11)
       RETURNING *`,
      [
        tenantId,
        integration?.id ?? null,
        input.name.toLowerCase(),
        input.language,
        input.category,
        input.header ? JSON.stringify(input.header) : null,
        input.body,
        input.footer ?? null,
        JSON.stringify(input.buttons ?? []),
        JSON.stringify(input.example_variables ?? []),
        ctx.userId,
      ]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'whatsapp.template.created',
        entityType: 'whatsapp_template',
        entityId: row.id,
        userId: ctx.userId,
        after: { name: row.name, language: row.language, category: row.category },
      },
      ctx.auditCtx ?? {}
    );
    return row;
  });
}

export interface UpdateTemplateInput {
  header?: CreateTemplateInput['header'];
  body?: string;
  footer?: string | null;
  buttons?: unknown[];
  example_variables?: unknown[];
  category?: 'marketing' | 'utility' | 'authentication';
}

export async function updateTemplate(
  tenantId: string,
  templateId: string,
  patch: UpdateTemplateInput,
  ctx: OperationCtx
): Promise<TemplateRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query<TemplateRow>(
      `SELECT * FROM whatsapp_templates WHERE id = $1 AND tenant_id = $2`,
      [templateId, tenantId]
    );
    if (!existing) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template niet gevonden');
    if (existing.status === 'approved' || existing.status === 'submitted') {
      throw new AppError(
        409,
        'TEMPLATE_LOCKED',
        `Template kan niet bewerkt worden in status '${existing.status}'`
      );
    }

    const { rows: [row] } = await client.query<TemplateRow>(
      `UPDATE whatsapp_templates
          SET header            = COALESCE($1::jsonb, header),
              body              = COALESCE($2, body),
              footer            = COALESCE($3, footer),
              buttons           = COALESCE($4::jsonb, buttons),
              example_variables = COALESCE($5::jsonb, example_variables),
              category          = COALESCE($6, category),
              updated_at        = now()
        WHERE id = $7 AND tenant_id = $8
        RETURNING *`,
      [
        patch.header !== undefined ? JSON.stringify(patch.header) : null,
        patch.body ?? null,
        patch.footer ?? null,
        patch.buttons !== undefined ? JSON.stringify(patch.buttons) : null,
        patch.example_variables !== undefined ? JSON.stringify(patch.example_variables) : null,
        patch.category ?? null,
        templateId,
        tenantId,
      ]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'whatsapp.template.updated',
        entityType: 'whatsapp_template',
        entityId: row.id,
        userId: ctx.userId,
      },
      ctx.auditCtx ?? {}
    );
    return row;
  });
}

export async function deleteTemplate(
  tenantId: string,
  templateId: string,
  ctx: OperationCtx
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query<TemplateRow>(
      `SELECT * FROM whatsapp_templates WHERE id = $1 AND tenant_id = $2`,
      [templateId, tenantId]
    );
    if (!existing) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template niet gevonden');
    if (existing.status === 'approved') {
      throw new AppError(
        409,
        'TEMPLATE_LOCKED',
        'Goedgekeurde template kan niet verwijderd worden (zet eerst op disabled)'
      );
    }
    await client.query(
      `DELETE FROM whatsapp_templates WHERE id = $1 AND tenant_id = $2`,
      [templateId, tenantId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'whatsapp.template.deleted',
        entityType: 'whatsapp_template',
        entityId: templateId,
        userId: ctx.userId,
      },
      ctx.auditCtx ?? {}
    );
  });
}

/**
 * Submit a template to Meta for review. Sets status='submitted'. In mock
 * mode the connector's auto-approval listener flips the template back to
 * 'approved' after 2 seconds.
 */
export async function submitTemplate(
  tenantId: string,
  templateId: string,
  ctx: OperationCtx
): Promise<TemplateRow> {
  // Load template to confirm draft state.
  const draft = await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<TemplateRow>(
      `SELECT * FROM whatsapp_templates WHERE id = $1 AND tenant_id = $2`,
      [templateId, tenantId]
    );
    return row;
  });
  if (!draft) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template niet gevonden');
  if (draft.status !== 'draft' && draft.status !== 'rejected') {
    throw new AppError(
      409,
      'INVALID_STATUS',
      `Kan template in status '${draft.status}' niet opnieuw indienen`
    );
  }

  const creds = await loadConnectorCreds(tenantId);
  const result = await dialog360.submitTemplateForReview(creds, {
    name: draft.name,
    language: draft.language,
    category: (draft.category ?? 'utility') as 'marketing' | 'utility' | 'authentication',
    header: draft.header as dialog360.TemplateInput['header'],
    body: draft.body,
    footer: draft.footer,
    buttons: (draft.buttons ?? []) as Array<Record<string, unknown>>,
    example_variables: draft.example_variables ?? [],
  });

  // Wire up mock auto-approval: when the connector emits template-approved
  // for our external_id, flip status → approved.
  if (!dialog360.isLive()) {
    const externalId = result.external_id;
    const handler = async (payload: { tenantId: string; externalId: string }) => {
      if (payload.externalId !== externalId) return;
      try {
        await withTenant(tenantId, async (client) => {
          await client.query(
            `UPDATE whatsapp_templates
                SET status = 'approved', approved_at = now(), updated_at = now()
              WHERE external_id = $1 AND tenant_id = $2 AND status = 'submitted'`,
            [externalId, tenantId]
          );
        });
        logger.info('[whatsapp.templates] mock auto-approved', { externalId, tenantId });
      } catch (err) {
        logger.warn('[whatsapp.templates] mock auto-approve failed', {
          error: (err as Error).message,
        });
      } finally {
        dialog360.mockEvents.off('template-approved', handler);
      }
    };
    dialog360.mockEvents.on('template-approved', handler);
  }

  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<TemplateRow>(
      `UPDATE whatsapp_templates
          SET status        = 'submitted',
              external_id   = $1,
              submitted_at  = now(),
              updated_at    = now()
        WHERE id = $2 AND tenant_id = $3
        RETURNING *`,
      [result.external_id, templateId, tenantId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'whatsapp.template.submitted',
        entityType: 'whatsapp_template',
        entityId: row.id,
        userId: ctx.userId,
        after: { external_id: result.external_id },
      },
      ctx.auditCtx ?? {}
    );
    return row;
  });
}

/**
 * Polls 360dialog for the current template status and updates the row.
 */
export async function syncTemplateStatus(
  tenantId: string,
  templateId: string,
  ctx: OperationCtx
): Promise<TemplateRow> {
  const template = await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<TemplateRow>(
      `SELECT * FROM whatsapp_templates WHERE id = $1 AND tenant_id = $2`,
      [templateId, tenantId]
    );
    return row;
  });
  if (!template) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template niet gevonden');
  if (!template.external_id) {
    throw new AppError(400, 'NOT_SUBMITTED', 'Template heeft nog geen external_id (nog niet ingediend)');
  }

  const creds = await loadConnectorCreds(tenantId);
  const result = await dialog360.getTemplateStatus(creds, template.external_id);

  return withTenant(tenantId, async (client) => {
    const nextStatus =
      result.status === 'approved'
        ? 'approved'
        : result.status === 'rejected'
          ? 'rejected'
          : 'submitted';
    const { rows: [row] } = await client.query<TemplateRow>(
      `UPDATE whatsapp_templates
          SET status           = $1,
              approved_at      = CASE WHEN $1 = 'approved' THEN COALESCE(approved_at, now()) ELSE approved_at END,
              rejection_reason = $2,
              updated_at       = now()
        WHERE id = $3 AND tenant_id = $4
        RETURNING *`,
      [nextStatus, result.rejection_reason ?? null, templateId, tenantId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'whatsapp.template.synced',
        entityType: 'whatsapp_template',
        entityId: row.id,
        userId: ctx.userId,
        after: { status: row.status },
      },
      ctx.auditCtx ?? {}
    );
    return row;
  });
}

export interface ListTemplatesFilters {
  status?: TemplateRow['status'];
  cursor?: string;
  limit?: number;
}

export async function listTemplates(
  tenantId: string,
  filters: ListTemplatesFilters
): Promise<{ data: TemplateRow[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return withTenant(tenantId, async (client) => {
    const conds: string[] = [`tenant_id = $1`];
    const values: unknown[] = [tenantId];
    if (filters.status) {
      conds.push(`status = $${values.length + 1}`);
      values.push(filters.status);
    }
    if (filters.cursor) {
      conds.push(`created_at < $${values.length + 1}`);
      values.push(filters.cursor);
    }
    const sql =
      `SELECT * FROM whatsapp_templates WHERE ${conds.join(' AND ')}` +
      ` ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`;
    const { rows } = await client.query<TemplateRow>(sql, values);
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const next_cursor = hasMore ? data[data.length - 1].created_at : null;
    return { data, next_cursor };
  });
}

export async function getTemplate(
  tenantId: string,
  templateId: string
): Promise<TemplateRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<TemplateRow>(
      `SELECT * FROM whatsapp_templates WHERE id = $1 AND tenant_id = $2`,
      [templateId, tenantId]
    );
    if (!row) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template niet gevonden');
    return row;
  });
}

export async function getTemplateByName(
  tenantId: string,
  name: string,
  language: string
): Promise<TemplateRow | null> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<TemplateRow>(
      `SELECT * FROM whatsapp_templates
         WHERE tenant_id = $1 AND name = $2 AND language = $3
         LIMIT 1`,
      [tenantId, name.toLowerCase(), language]
    );
    return row ?? null;
  });
}

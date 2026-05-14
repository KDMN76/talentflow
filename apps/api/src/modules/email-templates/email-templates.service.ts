import { z } from 'zod';
import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { extractMergeVars } from '../../lib/mergeVariables';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EmailTemplate {
  id: string;
  tenant_id: string;
  name: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  merge_variables: string[];
  category: string | null;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Validation schemas ─────────────────────────────────────────────────────

export const createEmailTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(998), // RFC 5322 line-length safety net.
  body_html: z.string().min(1),
  body_text: z.string().optional(),
  category: z.string().max(50).optional(),
});

export const updateEmailTemplateSchema = createEmailTemplateSchema.partial();

export type CreateEmailTemplateData = z.infer<typeof createEmailTemplateSchema>;
export type UpdateEmailTemplateData = z.infer<typeof updateEmailTemplateSchema>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function combinedMergeVars(subject: string, bodyHtml: string, bodyText?: string | null): string[] {
  const seen = new Set<string>();
  const all: string[] = [];
  for (const v of extractMergeVars(subject)) if (!seen.has(v)) { seen.add(v); all.push(v); }
  for (const v of extractMergeVars(bodyHtml)) if (!seen.has(v)) { seen.add(v); all.push(v); }
  if (bodyText) {
    for (const v of extractMergeVars(bodyText)) if (!seen.has(v)) { seen.add(v); all.push(v); }
  }
  return all;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function listEmailTemplates(
  tenantId: string,
  category?: string
): Promise<EmailTemplate[]> {
  try {
    return await withTenant(tenantId, async (client) => {
      const values: unknown[] = [tenantId];
      let categoryClause = '';
      if (category) {
        categoryClause = 'AND category = $2';
        values.push(category);
      }
      const { rows } = await client.query<EmailTemplate>(
        `SELECT * FROM email_templates
         WHERE tenant_id = $1 AND deleted_at IS NULL ${categoryClause}
         ORDER BY name ASC`,
        values
      );
      return rows;
    });
  } catch (err) {
    logger.warn('[email-templates] listEmailTemplates failed — returning []', {
      tenantId,
      error: (err as Error).message,
    });
    return [];
  }
}

export async function getEmailTemplate(
  tenantId: string,
  id: string
): Promise<EmailTemplate> {
  return withTenant(tenantId, async (client) => {
    const { rows: [tpl] } = await client.query<EmailTemplate>(
      `SELECT * FROM email_templates
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (!tpl) {
      throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'E-mailtemplate niet gevonden');
    }
    return tpl;
  });
}

export async function createEmailTemplate(
  tenantId: string,
  userId: string,
  data: CreateEmailTemplateData
): Promise<EmailTemplate> {
  const parsed = createEmailTemplateSchema.parse(data);
  const mergeVars = combinedMergeVars(parsed.subject, parsed.body_html, parsed.body_text);

  return withTenant(tenantId, async (client) => {
    const { rows: [tpl] } = await client.query<EmailTemplate>(
      `INSERT INTO email_templates
         (tenant_id, name, subject, body_html, body_text, merge_variables, category, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        tenantId,
        parsed.name,
        parsed.subject,
        parsed.body_html,
        parsed.body_text ?? null,
        mergeVars,
        parsed.category ?? null,
        userId,
      ]
    );

    // Activity log — fire-and-forget (matcht andere services' patroon).
    client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'email_template', $2, $3, 'created', $4)`,
      [tenantId, tpl.id, userId, JSON.stringify({ name: parsed.name, category: parsed.category })]
    ).catch((actErr: Error) => {
      logger.warn('[email-templates] activity log insert failed', { error: actErr.message });
    });

    return tpl;
  });
}

export async function updateEmailTemplate(
  tenantId: string,
  id: string,
  userId: string,
  patch: UpdateEmailTemplateData
): Promise<EmailTemplate> {
  const parsed = updateEmailTemplateSchema.parse(patch);

  return withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query<EmailTemplate>(
      `SELECT * FROM email_templates
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (!existing) {
      throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'E-mailtemplate niet gevonden');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (parsed.name !== undefined)      { fields.push(`name = $${idx++}`);      values.push(parsed.name); }
    if (parsed.subject !== undefined)   { fields.push(`subject = $${idx++}`);   values.push(parsed.subject); }
    if (parsed.body_html !== undefined) { fields.push(`body_html = $${idx++}`); values.push(parsed.body_html); }
    if (parsed.body_text !== undefined) { fields.push(`body_text = $${idx++}`); values.push(parsed.body_text); }
    if (parsed.category !== undefined)  { fields.push(`category = $${idx++}`);  values.push(parsed.category); }

    // Re-extract merge vars als subject/body veranderd is.
    const subjectFinal  = parsed.subject   ?? existing.subject;
    const bodyHtmlFinal = parsed.body_html ?? existing.body_html;
    const bodyTextFinal = parsed.body_text !== undefined ? parsed.body_text : existing.body_text;
    const mergeVars = combinedMergeVars(subjectFinal, bodyHtmlFinal, bodyTextFinal);
    fields.push(`merge_variables = $${idx++}`);
    values.push(mergeVars);

    fields.push(`updated_at = now()`);

    if (fields.length === 1) {
      // Alleen updated_at — niets om bij te werken.
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    values.push(id, tenantId);

    const { rows: [tpl] } = await client.query<EmailTemplate>(
      `UPDATE email_templates SET ${fields.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx} AND deleted_at IS NULL
       RETURNING *`,
      values
    );

    client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'email_template', $2, $3, 'updated', $4)`,
      [tenantId, id, userId, JSON.stringify(parsed)]
    ).catch((actErr: Error) => {
      logger.warn('[email-templates] activity log insert failed', { error: actErr.message });
    });

    return tpl;
  });
}

export async function deleteEmailTemplate(tenantId: string, id: string): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows: [tpl] } = await client.query<{ id: string }>(
      `UPDATE email_templates SET deleted_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, tenantId]
    );
    if (!tpl) {
      throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'E-mailtemplate niet gevonden');
    }
  });
}

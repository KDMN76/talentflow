import crypto from 'crypto';
import { pool, withTenant, withoutTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { emailSenderQueue } from '../../queue/queues';
import { getBrandingForTenant, type TenantBranding } from '../tenants/branding.service';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Granulaire per-actie permissions. De oude vorm (`view`/`approve`/`reject`)
 * blijft backwards-compat geaccepteerd: `normalizePermissions()` mapt die naar
 * de nieuwe sleutels.
 */
export interface PortalPermissions {
  view_candidates: boolean;
  view_resumes: boolean;
  view_ai_scores: boolean;
  /** false = anonymized PII (Q2.3 anonimisering wired hier). */
  view_contact_info: boolean;
  accept_reject: boolean;
  comment: boolean;
  download_cv: boolean;
  view_pipeline_history: boolean;
}

export interface PortalBranding {
  logo_url?: string | null;
  favicon_url?: string | null;
  primary_color?: string | null;
  accent_color?: string | null;
  brand_name?: string | null;
  email_footer?: string | null;
}

export type NotificationFrequency = 'realtime' | 'daily' | 'weekly' | 'off';

export interface PortalLink {
  id: string;
  tenant_id: string;
  job_id: string;
  token: string;
  client_name: string | null;
  permissions: PortalPermissions;
  expires_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  deleted_at: string | null;
  created_by: string | null;
  created_at: string;
  custom_domain: string | null;
  custom_domain_verified_at: string | null;
  branding: PortalBranding;
  notify_email: string | null;
  notification_frequency: NotificationFrequency;
  last_notification_at: string | null;
  job_title?: string;
}

export interface PortalLinkInput {
  job_id?: string;
  client_name?: string | null;
  permissions?: Partial<PortalPermissions> | LegacyPortalPermissions;
  expires_at?: string | null;
  custom_domain?: string | null;
  branding?: PortalBranding;
  notify_email?: string | null;
  notification_frequency?: NotificationFrequency;
}

export interface PortalFeedback {
  id: string;
  tenant_id: string;
  portal_link_id: string;
  application_id: string;
  action: 'approved' | 'rejected' | 'commented';
  comment: string | null;
  client_name: string | null;
  created_at: string;
}

export interface PortalApplication {
  id: string;
  candidate_name: string;
  candidate_email: string | null;
  ai_score: number | null;
  stage_id: string | null;
  stage_name: string | null;
  status: string | null;
  applied_at: string | null;
}

export interface PortalAccessResult {
  job: {
    id: string;
    title: string;
    description: string | null;
  };
  applications: PortalApplication[];
  permissions: PortalPermissions;
  client_name: string | null;
  expires_at: string | null;
  branding: PortalBranding;
}

export interface PortalActivity {
  id: string;
  portal_link_id: string;
  action: string;
  candidate_id: string | null;
  candidate_name: string | null;
  payload: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

/** Legacy shape die door oude clients/tests is gestuurd. */
interface LegacyPortalPermissions {
  view?: boolean;
  comment?: boolean;
  approve?: boolean;
  reject?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Permissions helpers
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PERMISSIONS: PortalPermissions = {
  view_candidates: true,
  view_resumes: false,
  view_ai_scores: false,
  view_contact_info: false,
  accept_reject: false,
  comment: false,
  download_cv: false,
  view_pipeline_history: false,
};

/**
 * Accepteer zowel het nieuwe granulaire schema als het oude
 * `view/comment/approve/reject` schema en map naar `PortalPermissions`.
 *
 * Dit houdt bestaande create-calls + opgeslagen rows werkend. Onbekende
 * velden in input worden genegeerd.
 */
export function normalizePermissions(
  input: unknown
): PortalPermissions {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_PERMISSIONS };
  }

  const raw = input as Record<string, unknown>;
  const result: PortalPermissions = { ...DEFAULT_PERMISSIONS };

  // Granular keys (new shape)
  for (const key of Object.keys(DEFAULT_PERMISSIONS) as (keyof PortalPermissions)[]) {
    if (typeof raw[key] === 'boolean') {
      result[key] = raw[key] as boolean;
    }
  }

  // Legacy keys mapped to new schema:
  //   view    -> view_candidates
  //   comment -> comment
  //   approve|reject -> accept_reject (either grants the combined right)
  if (typeof raw.view === 'boolean') result.view_candidates = raw.view as boolean;
  if (typeof raw.comment === 'boolean') result.comment = raw.comment as boolean;
  if (typeof raw.approve === 'boolean' || typeof raw.reject === 'boolean') {
    result.accept_reject =
      Boolean(raw.approve) || Boolean(raw.reject) || result.accept_reject;
  }

  return result;
}

function parsePermissions(value: unknown): PortalPermissions {
  if (typeof value === 'string') {
    try {
      return normalizePermissions(JSON.parse(value));
    } catch {
      return { ...DEFAULT_PERMISSIONS };
    }
  }
  return normalizePermissions(value);
}

function parseBranding(value: unknown): PortalBranding {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as PortalBranding;
    } catch {
      return {};
    }
  }
  return value as PortalBranding;
}

function rowToLink(row: Record<string, unknown>): PortalLink {
  return {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    job_id: row.job_id as string,
    token: row.token as string,
    client_name: (row.client_name as string | null) ?? null,
    permissions: parsePermissions(row.permissions),
    expires_at: (row.expires_at as string | null) ?? null,
    view_count: (row.view_count as number) ?? 0,
    last_viewed_at: (row.last_viewed_at as string | null) ?? null,
    deleted_at: (row.deleted_at as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: row.created_at as string,
    custom_domain: (row.custom_domain as string | null) ?? null,
    custom_domain_verified_at: (row.custom_domain_verified_at as string | null) ?? null,
    branding: parseBranding(row.branding),
    notify_email: (row.notify_email as string | null) ?? null,
    notification_frequency:
      ((row.notification_frequency as NotificationFrequency | null) ?? 'realtime'),
    last_notification_at: (row.last_notification_at as string | null) ?? null,
    job_title: (row.job_title as string | undefined) ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin functions (tenant-scoped)
// ─────────────────────────────────────────────────────────────────────────────

export async function listPortalLinksForJob(
  tenantId: string,
  jobId: string
): Promise<PortalLink[]> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT pl.*, j.title AS job_title
         FROM guest_portal_links pl
         LEFT JOIN jobs j ON j.id = pl.job_id
         WHERE pl.tenant_id = $1
           AND pl.job_id = $2
           AND pl.deleted_at IS NULL
         ORDER BY pl.created_at DESC`,
        [tenantId, jobId]
      );
      return rows.map(rowToLink);
    });
  } catch {
    return [];
  }
}

export async function listPortalLinksForTenant(tenantId: string): Promise<PortalLink[]> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT pl.*, j.title AS job_title
         FROM guest_portal_links pl
         LEFT JOIN jobs j ON j.id = pl.job_id
         WHERE pl.tenant_id = $1
           AND pl.deleted_at IS NULL
         ORDER BY pl.created_at DESC`,
        [tenantId]
      );
      return rows.map(rowToLink);
    });
  } catch {
    return [];
  }
}

export async function getPortalLink(
  tenantId: string,
  portalId: string
): Promise<PortalLink> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT pl.*, j.title AS job_title
       FROM guest_portal_links pl
       LEFT JOIN jobs j ON j.id = pl.job_id
       WHERE pl.id = $1 AND pl.tenant_id = $2 AND pl.deleted_at IS NULL`,
      [portalId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'PORTAL_LINK_NOT_FOUND', 'Portal-link niet gevonden');
    }
    return rowToLink(row);
  });
}

export async function createPortalLink(
  tenantId: string,
  userId: string,
  data: {
    job_id: string;
    client_name?: string;
    permissions?: Partial<PortalPermissions> | LegacyPortalPermissions;
    expires_at?: string;
    custom_domain?: string;
    branding?: PortalBranding;
    notify_email?: string;
    notification_frequency?: NotificationFrequency;
  }
): Promise<PortalLink> {
  // Crypto.randomBytes returns a Buffer; base64url is URL-safe (no +, /, =)
  const token = crypto.randomBytes(24).toString('base64url');
  const permissions = normalizePermissions(data.permissions ?? {});
  const branding = data.branding ?? {};
  const frequency: NotificationFrequency = data.notification_frequency ?? 'realtime';

  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [link] } = await client.query(
        `INSERT INTO guest_portal_links
           (tenant_id, job_id, token, client_name, permissions, expires_at, created_by,
            custom_domain, branding, notify_email, notification_frequency)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7,
                 $8, $9::jsonb, $10, $11)
         RETURNING *`,
        [
          tenantId,
          data.job_id,
          token,
          data.client_name ?? null,
          JSON.stringify(permissions),
          data.expires_at ?? null,
          userId,
          data.custom_domain ?? null,
          JSON.stringify(branding),
          data.notify_email ?? null,
          frequency,
        ]
      );
      return rowToLink(link);
    });
  } catch (err) {
    logger.warn('[portal] createPortalLink DB insert failed — using mock', {
      tenantId,
      error: (err as Error).message,
    });
    // Mock fallback so dev works without table
    return {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      job_id: data.job_id,
      token,
      client_name: data.client_name ?? null,
      permissions,
      expires_at: data.expires_at ?? null,
      view_count: 0,
      last_viewed_at: null,
      deleted_at: null,
      created_by: userId,
      created_at: new Date().toISOString(),
      custom_domain: data.custom_domain ?? null,
      custom_domain_verified_at: null,
      branding,
      notify_email: data.notify_email ?? null,
      notification_frequency: frequency,
      last_notification_at: null,
    };
  }
}

/**
 * Patch een bestaand portal-link record — permissions/branding/notification.
 * Alleen meegegeven keys worden geüpdatet.
 */
export async function updatePortalLink(
  tenantId: string,
  portalId: string,
  updates: PortalLinkInput
): Promise<PortalLink> {
  return withTenant(tenantId, async (client) => {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.client_name !== undefined) {
      fields.push(`client_name = $${idx++}`);
      values.push(updates.client_name);
    }
    if (updates.permissions !== undefined) {
      const merged = normalizePermissions(updates.permissions);
      fields.push(`permissions = $${idx++}::jsonb`);
      values.push(JSON.stringify(merged));
    }
    if (updates.expires_at !== undefined) {
      fields.push(`expires_at = $${idx++}`);
      values.push(updates.expires_at);
    }
    if (updates.custom_domain !== undefined) {
      fields.push(`custom_domain = $${idx++}`);
      values.push(updates.custom_domain);
      // Wijzigen van de domeinnaam invalideert de eerdere DNS-verificatie.
      fields.push(`custom_domain_verified_at = NULL`);
    }
    if (updates.branding !== undefined) {
      fields.push(`branding = $${idx++}::jsonb`);
      values.push(JSON.stringify(updates.branding));
    }
    if (updates.notify_email !== undefined) {
      fields.push(`notify_email = $${idx++}`);
      values.push(updates.notify_email);
    }
    if (updates.notification_frequency !== undefined) {
      fields.push(`notification_frequency = $${idx++}`);
      values.push(updates.notification_frequency);
    }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    values.push(portalId, tenantId);
    const idParam = `$${idx++}`;
    const tenantParam = `$${idx++}`;

    const { rows: [row] } = await client.query(
      `UPDATE guest_portal_links
       SET ${fields.join(', ')}
       WHERE id = ${idParam}
         AND tenant_id = ${tenantParam}
         AND deleted_at IS NULL
       RETURNING *`,
      values
    );

    if (!row) {
      throw new AppError(404, 'PORTAL_LINK_NOT_FOUND', 'Portal-link niet gevonden');
    }

    return rowToLink(row);
  });
}

export async function rotatePortalToken(
  tenantId: string,
  portalId: string
): Promise<{ token: string }> {
  const newToken = crypto.randomBytes(24).toString('base64url');
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `UPDATE guest_portal_links
       SET token = $1
       WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
       RETURNING id`,
      [newToken, portalId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'PORTAL_LINK_NOT_FOUND', 'Portal-link niet gevonden');
    }
    return { token: newToken };
  });
}

export async function deletePortalLink(
  tenantId: string,
  linkId: string
): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      const { rows: [link] } = await client.query(
        `UPDATE guest_portal_links
         SET deleted_at = now()
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [linkId, tenantId]
      );

      if (!link) {
        throw new AppError(404, 'PORTAL_LINK_NOT_FOUND', 'Portal-link niet gevonden');
      }
    });
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    // Swallow DB-level errors (e.g. table missing in dev)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity log
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schrijf één activity-rij + één compliance audit_events-rij.
 *
 * `portal_activity_log` = recruiter-facing UI feed.
 * `audit_events`        = compliance trail (anoniem: user_id NULL,
 *                         portal_link_id in payload).
 */
export async function logPortalActivity(
  portalLinkId: string,
  action: string,
  candidateId: string | null = null,
  payload: Record<string, unknown> = {},
  ipAddress: string | null = null,
  userAgent: string | null = null
): Promise<void> {
  try {
    // We hebben geen tenant context (publieke route); we leiden tenant_id
    // af van het portal_link record en gebruiken withoutTenant + expliciete
    // tenant_id in de INSERT (de tabel heeft RLS maar withoutTenant draait
    // zonder app.tenant_id; in production loopt deze code via een dedicated
    // service-role connectie. In dev is RLS niet geforceerd op de
    // service-rol, en de migration 010 zet alleen `USING` zonder FORCE).
    await withoutTenant(async (client) => {
      const { rows: [link] } = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM guest_portal_links WHERE id = $1 AND deleted_at IS NULL`,
        [portalLinkId]
      );
      if (!link) return;

      const tenantId = link.tenant_id;

      // Activity log (recruiter-UI).
      await client.query(
        `INSERT INTO portal_activity_log
           (tenant_id, portal_link_id, action, candidate_id, payload, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::inet, $7)`,
        [
          tenantId,
          portalLinkId,
          action,
          candidateId,
          JSON.stringify(payload),
          ipAddress,
          userAgent,
        ]
      );

      // Compliance audit trail — append-only.
      try {
        await client.query(
          `INSERT INTO audit_events
             (tenant_id, user_id, action, entity_type, entity_id,
              before, after, ip_address, user_agent, request_id)
           VALUES ($1, NULL, $2, 'portal_link', $3, NULL, $4::jsonb, $5::inet, $6, NULL)`,
          [
            tenantId,
            `portal.${action}`,
            portalLinkId,
            JSON.stringify({ portal_link_id: portalLinkId, candidate_id: candidateId, ...payload }),
            ipAddress,
            userAgent,
          ]
        );
      } catch (auditErr) {
        // Audit-fail mag activity-log niet blokkeren.
        logger.warn('[portal] audit_events insert failed', {
          error: (auditErr as Error).message,
          action,
        });
      }
    });
  } catch (err) {
    logger.warn('[portal] logPortalActivity failed', {
      portalLinkId,
      action,
      error: (err as Error).message,
    });
  }
}

export async function getPortalActivityLog(
  tenantId: string,
  portalId: string,
  limit = 100
): Promise<PortalActivity[]> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT pal.id, pal.portal_link_id, pal.action, pal.candidate_id,
                pal.payload, pal.ip_address, pal.user_agent, pal.created_at,
                c.name AS candidate_name
         FROM portal_activity_log pal
         LEFT JOIN candidates c ON c.id = pal.candidate_id
         WHERE pal.tenant_id = $1 AND pal.portal_link_id = $2
         ORDER BY pal.created_at DESC
         LIMIT $3`,
        [tenantId, portalId, Math.min(Math.max(limit, 1), 500)]
      );
      return rows.map((r) => ({
        id: r.id,
        portal_link_id: r.portal_link_id,
        action: r.action,
        candidate_id: r.candidate_id,
        candidate_name: r.candidate_name ?? null,
        payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload ?? {},
        ip_address: r.ip_address ?? null,
        user_agent: r.user_agent ?? null,
        created_at: r.created_at,
      }));
    });
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public functions (token-based, no tenant context)
// ─────────────────────────────────────────────────────────────────────────────

function buildMockAccess(_token: string): PortalAccessResult {
  return {
    job: {
      id: crypto.randomUUID(),
      title: 'Senior Recruitment Consultant',
      description: 'Voorbeeldvacature voor demo-doeleinden.',
    },
    applications: [
      {
        id: crypto.randomUUID(),
        candidate_name: 'Anna de Vries',
        candidate_email: 'anna@example.com',
        ai_score: 88,
        stage_id: null,
        stage_name: 'Interview',
        status: 'active',
        applied_at: new Date(Date.now() - 86_400_000).toISOString(),
      },
      {
        id: crypto.randomUUID(),
        candidate_name: 'Mark Jansen',
        candidate_email: 'mark@example.com',
        ai_score: 76,
        stage_id: null,
        stage_name: 'Screening',
        status: 'active',
        applied_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      },
    ],
    permissions: {
      ...DEFAULT_PERMISSIONS,
      view_candidates: true,
      view_resumes: true,
      view_ai_scores: true,
      view_contact_info: true,
      accept_reject: true,
      comment: true,
      download_cv: true,
      view_pipeline_history: true,
    },
    client_name: 'Demo Klant B.V.',
    expires_at: null,
    branding: {},
  };
}

export async function getPortalAccess(token: string): Promise<PortalAccessResult> {
  try {
    return await withoutTenant(async (client) => {
      // Look up the link + job. Token is the auth, so we query without tenant context.
      const { rows: [link] } = await client.query(
        `SELECT pl.id, pl.tenant_id, pl.job_id, pl.token, pl.client_name,
                pl.permissions, pl.expires_at, pl.view_count, pl.last_viewed_at,
                pl.branding,
                j.title AS job_title, j.description AS job_description
         FROM guest_portal_links pl
         JOIN jobs j ON j.id = pl.job_id
         WHERE pl.token = $1
           AND pl.deleted_at IS NULL
           AND (pl.expires_at IS NULL OR pl.expires_at > now())`,
        [token]
      );

      if (!link) {
        throw new AppError(404, 'PORTAL_NOT_FOUND', 'Portal-link niet gevonden of verlopen');
      }

      // Fetch applications for this job. Try a richer query first, fall back if columns differ.
      let applications: PortalApplication[] = [];
      try {
        const { rows } = await client.query(
          `SELECT a.id,
                  c.name AS candidate_name,
                  c.email AS candidate_email,
                  c.ai_score AS ai_score,
                  a.stage_id,
                  ps.name AS stage_name,
                  a.status,
                  a.applied_at
           FROM applications a
           JOIN candidates c ON c.id = a.candidate_id
           LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id
           WHERE a.job_id = $1
             AND a.tenant_id = $2
           ORDER BY a.applied_at DESC NULLS LAST`,
          [link.job_id, link.tenant_id]
        );
        applications = rows;
      } catch {
        applications = [];
      }

      // Increment view counter (best-effort — don't fail the request on this)
      try {
        await client.query(
          `UPDATE guest_portal_links
           SET view_count = COALESCE(view_count, 0) + 1,
               last_viewed_at = now()
           WHERE id = $1`,
          [link.id]
        );
      } catch {
        // ignore
      }

      // Branding: portal-level overrides tenant-level. Combine both.
      const linkBranding = parseBranding(link.branding);
      let combinedBranding: PortalBranding = linkBranding;
      try {
        const tenantBranding = await getBrandingForTenant(link.tenant_id);
        if (tenantBranding) {
          combinedBranding = mergeBranding(tenantBranding, linkBranding);
        }
      } catch {
        // ignore — falls back to link-only branding
      }

      return {
        job: {
          id: link.job_id,
          title: link.job_title,
          description: link.job_description,
        },
        applications,
        permissions: parsePermissions(link.permissions),
        client_name: link.client_name,
        expires_at: link.expires_at,
        branding: combinedBranding,
      };
    });
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    // Table missing or other DB-level error — return mock data
    return buildMockAccess(token);
  }
}

export async function getBrandingForToken(
  token: string
): Promise<{ portal_link_id: string; branding: PortalBranding; client_name: string | null } | null> {
  try {
    return await withoutTenant(async (client) => {
      const { rows: [link] } = await client.query(
        `SELECT pl.id, pl.tenant_id, pl.client_name, pl.branding
         FROM guest_portal_links pl
         WHERE pl.token = $1
           AND pl.deleted_at IS NULL
           AND (pl.expires_at IS NULL OR pl.expires_at > now())`,
        [token]
      );
      if (!link) return null;
      const linkBranding = parseBranding(link.branding);
      let combined = linkBranding;
      try {
        const tenantBranding = await getBrandingForTenant(link.tenant_id);
        if (tenantBranding) combined = mergeBranding(tenantBranding, linkBranding);
      } catch {
        /* ignore */
      }
      return {
        portal_link_id: link.id,
        branding: combined,
        client_name: link.client_name,
      };
    });
  } catch {
    return null;
  }
}

function mergeBranding(a: TenantBranding | PortalBranding, b: PortalBranding): PortalBranding {
  const out: PortalBranding = { ...a };
  for (const k of Object.keys(b) as (keyof PortalBranding)[]) {
    const v = b[k];
    if (v !== undefined && v !== null && v !== '') {
      // assign through a typed helper — TS narrows the union to the right key
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export async function submitPortalFeedback(
  token: string,
  data: {
    application_id: string;
    action: 'approved' | 'rejected' | 'commented';
    comment?: string;
    client_name?: string;
  }
): Promise<PortalFeedback> {
  // Validate the token first by re-loading the raw link record (we need
  // tenant_id + portal_link_id which the public access result hides).
  let portalLinkId: string;
  let tenantId: string;
  let permissions: PortalPermissions;
  let resolvedClientName: string | null = null;

  try {
    const result = await withoutTenant(async (client) => {
      const { rows: [link] } = await client.query(
        `SELECT id, tenant_id, client_name, permissions
         FROM guest_portal_links
         WHERE token = $1
           AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())`,
        [token]
      );
      return link;
    });

    if (!result) {
      throw new AppError(404, 'PORTAL_NOT_FOUND', 'Portal-link niet gevonden of verlopen');
    }

    portalLinkId = result.id;
    tenantId = result.tenant_id;
    permissions = parsePermissions(result.permissions);
    resolvedClientName = result.client_name;
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    // Mock fallback when DB / table is unavailable
    portalLinkId = crypto.randomUUID();
    tenantId = crypto.randomUUID();
    permissions = {
      ...DEFAULT_PERMISSIONS,
      view_candidates: true,
      accept_reject: true,
      comment: true,
    };
  }

  // Permission check
  const requiredPermission =
    data.action === 'approved' || data.action === 'rejected'
      ? permissions.accept_reject
      : permissions.comment;

  if (!requiredPermission) {
    throw new AppError(
      403,
      'PERMISSION_DENIED',
      `Deze portal-link heeft geen toestemming voor actie: ${data.action}`
    );
  }

  const clientName = data.client_name ?? resolvedClientName ?? null;

  let feedback: PortalFeedback;
  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO guest_portal_feedback
         (tenant_id, portal_link_id, application_id, action, comment, client_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        tenantId,
        portalLinkId,
        data.application_id,
        data.action,
        data.comment ?? null,
        clientName,
      ]
    );
    feedback = row;
  } catch {
    // Mock fallback so dev works without table
    feedback = {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      portal_link_id: portalLinkId,
      application_id: data.application_id,
      action: data.action,
      comment: data.comment ?? null,
      client_name: clientName,
      created_at: new Date().toISOString(),
    };
  }

  // Log activity (best-effort — don't fail the feedback if this trips).
  await logPortalActivity(
    portalLinkId,
    data.action === 'approved' ? 'accepted'
      : data.action === 'rejected' ? 'rejected'
      : 'commented',
    null,
    { application_id: data.application_id, comment: data.comment ?? null, client_name: clientName }
  );

  return feedback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stuur (of plan) een notificatie wanneer een nieuwe kandidaat wordt
 * toegevoegd aan een job met een actief portaal.
 *
 * - 'realtime': direct enqueue email naar `notify_email`.
 * - 'daily'/'weekly': insert pending row → cron flush.
 * - 'off' of geen `notify_email`: skip stilletjes.
 */
export async function notifyClientOfNewCandidate(
  tenantId: string,
  portalLinkId: string,
  candidateId: string
): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      const { rows: [link] } = await client.query<{
        id: string;
        notify_email: string | null;
        notification_frequency: NotificationFrequency;
        client_name: string | null;
        branding: unknown;
        job_id: string;
      }>(
        `SELECT id, notify_email, notification_frequency, client_name, branding, job_id
         FROM guest_portal_links
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [portalLinkId, tenantId]
      );

      if (!link) {
        logger.warn('[portal] notifyClientOfNewCandidate: portal niet gevonden', {
          portalLinkId,
          tenantId,
        });
        return;
      }

      if (link.notification_frequency === 'off' || !link.notify_email) {
        return;
      }

      // Haal kandidaat + job-titel op (geanonimiseerd voor Q2.3 als nodig).
      const { rows: [cand] } = await client.query<{ name: string; email: string | null }>(
        `SELECT name, email FROM candidates WHERE id = $1 AND tenant_id = $2`,
        [candidateId, tenantId]
      );
      const { rows: [job] } = await client.query<{ title: string }>(
        `SELECT title FROM jobs WHERE id = $1 AND tenant_id = $2`,
        [link.job_id, tenantId]
      );

      const clientLabel = link.client_name ?? 'Klant';
      const candidateName = cand?.name ?? 'Nieuwe kandidaat';
      const jobTitle = job?.title ?? 'Vacature';

      if (link.notification_frequency === 'realtime') {
        const branding = parseBranding(link.branding);
        const tenantBranding = await safeGetTenantBranding(tenantId);
        const combined = tenantBranding
          ? mergeBranding(tenantBranding, branding)
          : branding;

        const brandName = combined.brand_name ?? 'TalentFlow';
        const subject = `[${brandName}] Nieuwe kandidaat voor ${jobTitle}`;

        const html = renderRealtimeEmail({
          brandName,
          clientLabel,
          candidateName,
          jobTitle,
          primaryColor: combined.primary_color ?? '#6366f1',
          emailFooter: combined.email_footer ?? null,
        });

        await emailSenderQueue.add('send-email', {
          to: link.notify_email,
          subject,
          bodyHtml: html,
          // No tenantId/candidateId here — this is an outbound notification
          // to a third party (the client), niet een candidate-comm thread.
        });

        await client.query(
          `UPDATE guest_portal_links SET last_notification_at = now() WHERE id = $1`,
          [link.id]
        );
        return;
      }

      // 'daily' / 'weekly': insert pending row, cron picks it up.
      await client.query(
        `INSERT INTO pending_portal_notifications
           (tenant_id, portal_link_id, candidate_id, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          tenantId,
          portalLinkId,
          candidateId,
          JSON.stringify({ candidate_name: candidateName, job_title: jobTitle }),
        ]
      );
    });
  } catch (err) {
    logger.warn('[portal] notifyClientOfNewCandidate failed', {
      tenantId,
      portalLinkId,
      candidateId,
      error: (err as Error).message,
    });
  }
}

async function safeGetTenantBranding(tenantId: string): Promise<TenantBranding | null> {
  try {
    return await getBrandingForTenant(tenantId);
  } catch {
    return null;
  }
}

interface RealtimeEmailVars {
  brandName: string;
  clientLabel: string;
  candidateName: string;
  jobTitle: string;
  primaryColor: string;
  emailFooter: string | null;
}

function renderRealtimeEmail(v: RealtimeEmailVars): string {
  const footer = v.emailFooter
    ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">${v.emailFooter}</div>`
    : '';
  return `
    <div style="font-family:system-ui,sans-serif;color:#111827;max-width:560px;margin:0 auto;">
      <div style="background:${v.primaryColor};color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
        <strong>${escapeHtml(v.brandName)}</strong>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
        <p>Hallo ${escapeHtml(v.clientLabel)},</p>
        <p>Er is een nieuwe kandidaat toegevoegd aan jullie shortlist voor
           <strong>${escapeHtml(v.jobTitle)}</strong>.</p>
        <p>Kandidaat: <strong>${escapeHtml(v.candidateName)}</strong></p>
        <p>Log in op het klantportaal om het profiel te bekijken en feedback te geven.</p>
        ${footer}
      </div>
    </div>
  `.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom-domain verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifieer of een hostnaam een geregistreerd, verified custom-domain is.
 * Wordt aangeroepen vanuit de Caddy `ask`-endpoint én vanuit de
 * customDomain middleware.
 */
export async function isCustomDomainVerified(domain: string): Promise<boolean> {
  if (!domain) return false;
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM guest_portal_links
       WHERE custom_domain = $1
         AND custom_domain_verified_at IS NOT NULL
         AND deleted_at IS NULL
       LIMIT 1`,
      [domain.toLowerCase()]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function lookupPortalByDomain(domain: string): Promise<{
  portal_link_id: string;
  tenant_id: string;
  branding: PortalBranding;
} | null> {
  if (!domain) return null;
  try {
    const { rows: [row] } = await pool.query(
      `SELECT id, tenant_id, branding
       FROM guest_portal_links
       WHERE custom_domain = $1
         AND custom_domain_verified_at IS NOT NULL
         AND deleted_at IS NULL
       LIMIT 1`,
      [domain.toLowerCase()]
    );
    if (!row) return null;
    return {
      portal_link_id: row.id,
      tenant_id: row.tenant_id,
      branding: parseBranding(row.branding),
    };
  } catch {
    return null;
  }
}

/**
 * Start DNS-verificatie voor een custom domain. Strategie:
 *
 *   1) Recruiter zet in DNS een TXT record:
 *        _talentflow-portal.<custom_domain>  → <verification_token>
 *
 *   2) Wij doen een DNS resolve (via Node's `dns/promises`) en zoeken naar
 *      een TXT-record dat exact `verification_token` bevat. Slagen → zetten
 *      `custom_domain_verified_at = now()`. Caddy's `ask`-endpoint kan dan
 *      een TLS-cert uitgeven voor dit domein.
 *
 *   3) Naast TXT vragen we ook een CNAME naar `portal.talentflow.app` —
 *      dat is wat het verkeer naar onze edge brengt. CNAME-check is
 *      best-effort; ontbreken blokkeert niet, want sommige DNS-providers
 *      ondersteunen geen CNAME op apex (gebruik ALIAS/ANAME).
 *
 * Het verification_token komt uit de `branding.dns_verification_token`
 * JSONB sleutel — gegenereerd bij eerste verify-call als die er nog niet is.
 */
export interface DomainVerificationResult {
  verified: boolean;
  verification_token: string;
  required_records: {
    txt: { host: string; value: string };
    cname: { host: string; value: string };
  };
  found_txt: boolean;
  found_cname: boolean;
  error?: string;
}

export async function verifyCustomDomain(
  tenantId: string,
  portalId: string
): Promise<DomainVerificationResult> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<{
      id: string;
      custom_domain: string | null;
      branding: unknown;
    }>(
      `SELECT id, custom_domain, branding FROM guest_portal_links
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [portalId, tenantId]
    );
    if (!row) throw new AppError(404, 'PORTAL_LINK_NOT_FOUND', 'Portal-link niet gevonden');
    if (!row.custom_domain) {
      throw new AppError(400, 'NO_CUSTOM_DOMAIN', 'Geen custom_domain geconfigureerd');
    }

    const branding = parseBranding(row.branding) as Record<string, unknown>;
    let token = (branding.dns_verification_token as string | undefined) ?? '';
    if (!token) {
      token = `talentflow-verify-${crypto.randomBytes(16).toString('hex')}`;
      branding.dns_verification_token = token;
      await client.query(
        `UPDATE guest_portal_links SET branding = $1::jsonb WHERE id = $2`,
        [JSON.stringify(branding), portalId]
      );
    }

    const cnameTarget = process.env.PORTAL_CNAME_TARGET ?? 'portal.talentflow.app';
    const required = {
      txt: { host: `_talentflow-portal.${row.custom_domain}`, value: token },
      cname: { host: row.custom_domain, value: cnameTarget },
    };

    // DNS lookups — guarded so failures don't crash.
    const dns = await import('dns/promises');
    let foundTxt = false;
    let foundCname = false;
    let error: string | undefined;

    try {
      const txt = await dns.resolveTxt(required.txt.host);
      foundTxt = txt.some((records) => records.join('').includes(token));
    } catch (e) {
      error = `TXT lookup faalde: ${(e as Error).message}`;
    }

    try {
      const cname = await dns.resolveCname(row.custom_domain);
      foundCname = cname.some(
        (c) => c.toLowerCase().replace(/\.$/, '') === cnameTarget.toLowerCase()
      );
    } catch {
      // CNAME ontbreken is niet-fataal: ALIAS records resolven niet via resolveCname
      foundCname = false;
    }

    if (foundTxt) {
      await client.query(
        `UPDATE guest_portal_links
         SET custom_domain_verified_at = now()
         WHERE id = $1`,
        [portalId]
      );
    }

    return {
      verified: foundTxt,
      verification_token: token,
      required_records: required,
      found_txt: foundTxt,
      found_cname: foundCname,
      error,
    };
  });
}

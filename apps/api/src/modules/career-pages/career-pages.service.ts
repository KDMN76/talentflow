import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { promises as dns } from 'dns';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import {
  CUSTOM_DOMAIN_TARGET_IP,
  ipMatchesTarget,
  normalizeHostname,
  validateCustomDomainInput,
} from './customDomain';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CareerPageConfig {
  logo_url?: string;
  primary_color?: string;
  header_text?: string;
  intro_text?: string;
  font_family?: string;
  language?: string;
  [key: string]: unknown;
}

export interface CareerPage {
  id: string;
  tenant_id: string;
  slug: string;
  custom_domain: string | null;
  active: boolean;
  config: CareerPageConfig;
  language: string;
  template: string;
  visit_count: number;
  application_count: number;
  deleted_at: string | null;
  created_at: string;
}

export interface PublicCareerPageJob {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  employment_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  /** monthly / annual / hourly — nodig om de band correct te tonen (EU 2023/970). */
  salary_frequency: string | null;
  currency: string | null;
  /** Criteria waarmee de beloning bepaald wordt (EU 2023/970 art. 5). */
  compensation_criteria: string | null;
  description: string | null;
  created_at: string;
}

export interface PublicCareerPage {
  // Wordt gewrapt in `career_page` zodat het matcht met de web-frontend
  // (PublicCareerPageData = { career_page, jobs, company_name }).
  career_page: {
    id: string;
    tenant_id: string;
    slug: string;
    template: string;
    language: string;
    config: CareerPageConfig;
    active: boolean;
  };
  company_name: string;
  jobs: PublicCareerPageJob[];
}

export interface SubmitApplicationData {
  candidate: {
    name: string;
    email: string;
    phone?: string;
    skills?: string[];
  };
  job_id: string;
  motivation?: string;
  custom_fields?: Record<string, unknown>;
}

export interface SubmitApplicationResult {
  success: true;
  candidate_id: string;
  application_id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Vaste-lengte, nette random suffix (6 hex-tekens). `Math.random().toString(36)`
 * liet trailing-zeros vallen → variabele/korte suffixen zoals "4u4" (bug: slug
 * "job-4u4"). Hex is altijd 6 tekens.
 */
function slugSuffix(bytes = 3): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Bepaalt een globaal-unieke slug. Slugs zijn publieke career-URL's en dus
 * tenant-overstijgend uniek (constraint). De oude code checkte maar één keer en
 * her-checkte de gesuggereerde slug NIET → een tweede botsing liet de INSERT
 * falen op de unique-constraint. Nu her-checken we tot de slug vrij is.
 */
async function ensureUniqueSlug(
  client: PoolClient,
  base: string
): Promise<string> {
  let candidate = base;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { rows } = await client.query(
      `SELECT 1 FROM career_pages WHERE slug = $1 LIMIT 1`,
      [candidate]
    );
    if (rows.length === 0) return candidate;
    candidate = `${base}-${slugSuffix()}`;
  }
  // Extreem onwaarschijnlijk; val terug op een langere suffix.
  return `${base}-${slugSuffix(6)}`;
}

// ─── Admin Functions ──────────────────────────────────────────────────────────

export async function listCareerPages(tenantId: string): Promise<CareerPage[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT *
       FROM career_pages
       WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [tenantId]
    );
    return rows;
  });
}

export async function getCareerPage(
  tenantId: string,
  id: string
): Promise<CareerPage> {
  return withTenant(tenantId, async (client) => {
    const { rows: [page] } = await client.query(
      `SELECT *
       FROM career_pages
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );

    if (!page) {
      throw new AppError(404, 'CAREER_PAGE_NOT_FOUND', 'Career page niet gevonden');
    }

    // Builder-blocks worden in config.blocks bewaard; geef ze top-level mee
    // zodat de builder (page.blocks) hydrateert.
    return {
      ...page,
      blocks: Array.isArray(page.config?.blocks) ? page.config.blocks : [],
    };
  });
}

export async function createCareerPage(
  tenantId: string,
  userId: string,
  data: {
    slug: string;
    template: string;
    config: CareerPageConfig;
    language?: string;
  }
): Promise<CareerPage> {
  return withTenant(tenantId, async (client) => {
    // Globaal-unieke slug (her-checkt tot vrij; vaste-lengte hex suffix).
    const slug = await ensureUniqueSlug(client, data.slug);

    const { rows: [page] } = await client.query(
      `INSERT INTO career_pages (tenant_id, slug, template, config, language)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        tenantId,
        slug,
        data.template,
        JSON.stringify(data.config ?? {}),
        data.language ?? 'nl',
      ]
    );

    // Best-effort activity log — ignore if table doesn't exist
    try {
      await client.query(
        `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
         VALUES ($1, 'career_page', $2, $3, 'created', $4)`,
        [tenantId, page.id, userId, JSON.stringify({ slug })]
      );
    } catch {
      // ignore
    }

    return page;
  });
}

export async function updateCareerPage(
  tenantId: string,
  id: string,
  data: {
    slug?: string;
    config?: CareerPageConfig;
    active?: boolean;
    template?: string;
    language?: string;
  }
): Promise<CareerPage> {
  return withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query(
      `SELECT id FROM career_pages WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (!existing) {
      throw new AppError(404, 'CAREER_PAGE_NOT_FOUND', 'Career page niet gevonden');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.slug !== undefined) {
      // Verify uniqueness when changing slug
      const { rows: dupes } = await client.query(
        `SELECT id FROM career_pages WHERE slug = $1 AND id <> $2`,
        [data.slug, id]
      );
      if (dupes.length > 0) {
        throw new AppError(409, 'SLUG_TAKEN', 'Deze slug is al in gebruik');
      }
      fields.push(`slug = $${idx++}`);
      values.push(data.slug);
    }
    if (data.config !== undefined) {
      fields.push(`config = $${idx++}`);
      values.push(JSON.stringify(data.config));
    }
    if (data.active !== undefined) {
      fields.push(`active = $${idx++}`);
      values.push(data.active);
    }
    if (data.template !== undefined) {
      fields.push(`template = $${idx++}`);
      values.push(data.template);
    }
    if (data.language !== undefined) {
      fields.push(`language = $${idx++}`);
      values.push(data.language);
    }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    values.push(id, tenantId);

    const { rows: [page] } = await client.query(
      `UPDATE career_pages SET ${fields.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx} AND deleted_at IS NULL
       RETURNING *`,
      values
    );

    return page;
  });
}

export async function updateCareerPageBlocks(
  tenantId: string,
  id: string,
  blocks: unknown[]
): Promise<{ blocks: unknown[] }> {
  return withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query(
      `SELECT id FROM career_pages WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (!existing) {
      throw new AppError(404, 'CAREER_PAGE_NOT_FOUND', 'Career page niet gevonden');
    }
    // Builder-blocks bewaren we in config.blocks (geen aparte kolom nodig).
    await client.query(
      `UPDATE career_pages
          SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{blocks}', $1::jsonb)
        WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL`,
      [JSON.stringify(blocks), id, tenantId]
    );
    return { blocks };
  });
}

export async function setCareerPagePublished(
  tenantId: string,
  id: string,
  published: boolean
): Promise<CareerPage> {
  return withTenant(tenantId, async (client) => {
    // De publieke render gate't op `active`; we houden `published` synchroon.
    const { rows: [page] } = await client.query(
      `UPDATE career_pages
          SET active = $1,
              published = $1,
              published_at = CASE WHEN $1 THEN now() ELSE published_at END
        WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
        RETURNING *`,
      [published, id, tenantId]
    );
    if (!page) {
      throw new AppError(404, 'CAREER_PAGE_NOT_FOUND', 'Career page niet gevonden');
    }
    return {
      ...page,
      blocks: Array.isArray(page.config?.blocks) ? page.config.blocks : [],
    };
  });
}

export async function deleteCareerPage(
  tenantId: string,
  id: string
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rows: [page] } = await client.query(
      `UPDATE career_pages SET deleted_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, tenantId]
    );

    if (!page) {
      throw new AppError(404, 'CAREER_PAGE_NOT_FOUND', 'Career page niet gevonden');
    }
  });
}

// ─── Public Functions ─────────────────────────────────────────────────────────

export async function getPublicCareerPage(slug: string): Promise<PublicCareerPage> {
  return withoutTenant(async (client) => {
    const { rows: [page] } = await client.query(
      `SELECT id, tenant_id, slug, template, config, language, active, deleted_at
       FROM career_pages
       WHERE slug = $1 AND deleted_at IS NULL`,
      [slug]
    );

    if (!page || !page.active) {
      throw new AppError(404, 'CAREER_PAGE_NOT_FOUND', 'Career page niet gevonden');
    }

    // Fetch active jobs for this tenant (no tenant context — explicit filter)
    const { rows: jobs } = await client.query(
      `SELECT j.id, j.title, j.department, j.location, j.employment_type,
              j.salary_min, j.salary_max, j.salary_frequency, j.currency,
              j.compensation_criteria, j.description, j.created_at
       FROM jobs j
       WHERE j.tenant_id = $1
         AND j.status = 'open'
         AND j.deleted_at IS NULL
       ORDER BY j.created_at DESC`,
      [page.tenant_id]
    );

    // Increment visit_count (best-effort, non-blocking failure)
    try {
      await client.query(
        `UPDATE career_pages SET visit_count = visit_count + 1 WHERE id = $1`,
        [page.id]
      );
    } catch {
      // ignore
    }

    // Bedrijfsnaam voor de publieke header/footer.
    const { rows: [tenant] } = await client.query(
      `SELECT name FROM tenants WHERE id = $1`,
      [page.tenant_id]
    );

    return {
      career_page: {
        id: page.id,
        tenant_id: page.tenant_id,
        slug: page.slug,
        template: page.template,
        language: page.language,
        config: page.config ?? {},
        active: page.active,
      },
      company_name: (tenant?.name as string) ?? page.slug,
      jobs,
    };
  });
}

// ─── Custom Domain (white-label serving) ───────────────────────────────────────

export interface ResolveDomainResult {
  slug: string;
}

export interface VerifyDomainResult {
  verified: boolean;
  custom_domain: string;
  verified_at: string | null;
  target_ip: string;
  resolved_ips: string[];
  reason?: string;
}

/**
 * Resolve een custom-domain → career-page-slug. Publiek: de hostnaam is de
 * sleutel (geen tenant-context). Matcht case-insensitief op de genormaliseerde
 * host en alleen op een publiek-zichtbare (active) career-page — exact dezelfde
 * gate als getPublicCareerPage, zodat een eigen domein identiek toont aan
 * /careers/<slug>. Geen mock-fallback: bij DB-fout propageert de error zodat de
 * caller (web-middleware) netjes terugvalt op een normale 404.
 */
export async function resolveCareerPageByDomain(
  host: string
): Promise<ResolveDomainResult> {
  const normalized = normalizeHostname(host);
  if (!normalized) {
    throw new AppError(404, 'DOMAIN_NOT_FOUND', 'Geen career page voor dit domein');
  }
  return withoutTenant(async (client) => {
    const { rows: [page] } = await client.query(
      `SELECT slug
         FROM career_pages
        WHERE lower(custom_domain) = $1
          AND deleted_at IS NULL
          AND active = TRUE
        LIMIT 1`,
      [normalized]
    );
    if (!page) {
      throw new AppError(404, 'DOMAIN_NOT_FOUND', 'Geen career page voor dit domein');
    }
    return { slug: page.slug as string };
  });
}

/**
 * Zet of wis het custom-domain van een career-page (admin, tenant-scoped).
 * Lege/­null waarde → koppeling wissen. Anders: valideren als hostnaam,
 * app-eigen hosts weigeren, globale uniciteit afdwingen (409 bij conflict).
 * Elke wijziging reset `custom_domain_verified_at` (nieuw domein moet opnieuw
 * geverifieerd). Schrijft een audit-event binnen dezelfde transactie.
 */
export async function setCareerPageCustomDomain(
  tenantId: string,
  id: string,
  userId: string,
  domain: string | null,
  ctx: AuditContext = {}
): Promise<CareerPage> {
  return withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query(
      `SELECT id, custom_domain FROM career_pages
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (!existing) {
      throw new AppError(404, 'CAREER_PAGE_NOT_FOUND', 'Career page niet gevonden');
    }
    const previous = (existing.custom_domain as string | null) ?? null;

    const trimmed = (domain ?? '').trim();
    if (!trimmed) {
      const { rows: [page] } = await client.query(
        `UPDATE career_pages
            SET custom_domain = NULL,
                custom_domain_verified_at = NULL,
                updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          RETURNING *`,
        [id, tenantId]
      );
      await logAudit(
        client,
        tenantId,
        {
          action: 'career_page.custom_domain.clear',
          entityType: 'career_page',
          entityId: id,
          before: { custom_domain: previous },
          after: { custom_domain: null },
          userId,
        },
        ctx
      );
      return page;
    }

    const host = validateCustomDomainInput(trimmed);

    // Globale uniciteit: één domein → één career-page. Pre-check geeft een nette
    // 409 onder de owner-rol (die RLS bypasst en dus alle tenants ziet). De
    // partial unique index (uq_career_pages_custom_domain) is de harde garantie
    // en vangt de cross-tenant-race → 23505 mappen we óók naar 409.
    const { rows: dupes } = await client.query(
      `SELECT id FROM career_pages
        WHERE lower(custom_domain) = $1 AND id <> $2 AND deleted_at IS NULL
        LIMIT 1`,
      [host, id]
    );
    if (dupes.length > 0) {
      throw new AppError(
        409,
        'DOMAIN_TAKEN',
        'Dit domein is al aan een andere career page gekoppeld'
      );
    }

    let page;
    try {
      const res = await client.query(
        `UPDATE career_pages
            SET custom_domain = $1,
                custom_domain_verified_at = NULL,
                updated_at = now()
          WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
          RETURNING *`,
        [host, id, tenantId]
      );
      page = res.rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new AppError(
          409,
          'DOMAIN_TAKEN',
          'Dit domein is al aan een andere career page gekoppeld'
        );
      }
      throw err;
    }

    await logAudit(
      client,
      tenantId,
      {
        action: 'career_page.custom_domain.set',
        entityType: 'career_page',
        entityId: id,
        before: { custom_domain: previous },
        after: { custom_domain: host },
        userId,
      },
      ctx
    );
    return page;
  });
}

/**
 * Verifieer dat het gekoppelde domein naar onze VPS wijst. Doet een
 * `dns.resolve4`-lookup (buiten de DB-transactie, met timeout) en vergelijkt de
 * A-records met CUSTOM_DOMAIN_TARGET_IP. Bij succes wordt
 * `custom_domain_verified_at` gezet; bij mislukking gewist. Audit op beide.
 */
export async function verifyCareerPageCustomDomain(
  tenantId: string,
  id: string,
  userId: string,
  ctx: AuditContext = {}
): Promise<VerifyDomainResult> {
  // 1) Lees het domein — korte transactie, geen netwerk-I/O onder de client.
  const domain = await withTenant(tenantId, async (client) => {
    const { rows: [page] } = await client.query(
      `SELECT custom_domain FROM career_pages
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (!page) {
      throw new AppError(404, 'CAREER_PAGE_NOT_FOUND', 'Career page niet gevonden');
    }
    const d = (page.custom_domain as string | null) ?? null;
    if (!d) {
      throw new AppError(
        400,
        'NO_CUSTOM_DOMAIN',
        'Er is nog geen eigen domein ingesteld voor deze career page'
      );
    }
    return d;
  });

  // 2) DNS-lookup buiten de transactie, met timeout zodat verify nooit hangt.
  let resolvedIps: string[] = [];
  let reason: string | undefined;
  try {
    resolvedIps = await Promise.race([
      dns.resolve4(domain),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error('DNS_TIMEOUT')), 5000)
      ),
    ]);
  } catch (err) {
    const code = (err as { code?: string }).code ?? (err as Error).message;
    reason =
      code === 'ENOTFOUND' || code === 'ENODATA'
        ? 'Geen A-record gevonden voor dit domein.'
        : code === 'DNS_TIMEOUT'
          ? 'DNS-lookup duurde te lang. Probeer het later opnieuw.'
          : 'DNS-lookup mislukt.';
    resolvedIps = [];
  }

  const verified = ipMatchesTarget(resolvedIps, CUSTOM_DOMAIN_TARGET_IP);
  if (!verified && !reason) {
    reason = `Domein wijst nog niet naar ${CUSTOM_DOMAIN_TARGET_IP}.`;
  }

  // 3) Persisteer resultaat + audit.
  const verifiedAt = await withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `UPDATE career_pages
          SET custom_domain_verified_at = $1::timestamptz,
              updated_at = now()
        WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
        RETURNING custom_domain_verified_at`,
      [verified ? new Date().toISOString() : null, id, tenantId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: verified
          ? 'career_page.custom_domain.verified'
          : 'career_page.custom_domain.verify_failed',
        entityType: 'career_page',
        entityId: id,
        after: { custom_domain: domain, verified, resolved_ips: resolvedIps },
        userId,
      },
      ctx
    );
    return (row?.custom_domain_verified_at as string | null) ?? null;
  });

  return {
    verified,
    custom_domain: domain,
    verified_at: verifiedAt,
    target_ip: CUSTOM_DOMAIN_TARGET_IP,
    resolved_ips: resolvedIps,
    reason: verified ? undefined : reason,
  };
}

export async function submitApplication(
  slug: string,
  data: SubmitApplicationData
): Promise<SubmitApplicationResult> {
  return withoutTenant(async (client) => {
    await client.query('BEGIN');
    try {
      // 1. Find career page by slug
      const { rows: [page] } = await client.query(
        `SELECT id, tenant_id, active
         FROM career_pages
         WHERE slug = $1 AND deleted_at IS NULL`,
        [slug]
      );

      if (!page || !page.active) {
        throw new AppError(404, 'CAREER_PAGE_NOT_FOUND', 'Career page niet gevonden');
      }

      const tenantId: string = page.tenant_id;

      // 2. Verify job belongs to tenant + is open
      const { rows: [job] } = await client.query(
        `SELECT id FROM jobs
         WHERE id = $1 AND tenant_id = $2
           AND status = 'open' AND deleted_at IS NULL`,
        [data.job_id, tenantId]
      );

      if (!job) {
        throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
      }

      // 3. Insert candidate (source='Career Page')
      const { rows: [candidate] } = await client.query(
        `INSERT INTO candidates (tenant_id, name, email, phone, source, skills)
         VALUES ($1, $2, $3, $4, 'Career Page', $5)
         RETURNING id`,
        [
          tenantId,
          data.candidate.name,
          data.candidate.email,
          data.candidate.phone ?? null,
          data.candidate.skills ?? [],
        ]
      );

      // 4. Determine first stage of the job's pipeline
      const { rows: [firstStage] } = await client.query(
        `SELECT id FROM pipeline_stages
         WHERE job_id = $1 AND tenant_id = $2
         ORDER BY position ASC LIMIT 1`,
        [data.job_id, tenantId]
      );

      // 5. Create application
      const motivationPayload = data.motivation || data.custom_fields
        ? JSON.stringify({
            motivation: data.motivation ?? null,
            custom_fields: data.custom_fields ?? {},
          })
        : null;

      let applicationId: string;
      try {
        const { rows: [application] } = await client.query(
          `INSERT INTO applications (tenant_id, job_id, candidate_id, stage_id, notes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, job_id, candidate_id) DO NOTHING
           RETURNING id`,
          [
            tenantId,
            data.job_id,
            candidate.id,
            firstStage?.id ?? null,
            motivationPayload,
          ]
        );
        applicationId = application?.id;
      } catch {
        // notes column may not exist — retry without it
        const { rows: [application] } = await client.query(
          `INSERT INTO applications (tenant_id, job_id, candidate_id, stage_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, job_id, candidate_id) DO NOTHING
           RETURNING id`,
          [tenantId, data.job_id, candidate.id, firstStage?.id ?? null]
        );
        applicationId = application?.id;
      }

      if (!applicationId) {
        throw new AppError(409, 'ALREADY_APPLIED', 'Je hebt al gesolliciteerd op deze vacature');
      }

      // 6. Increment application_count on career page
      try {
        await client.query(
          `UPDATE career_pages SET application_count = application_count + 1 WHERE id = $1`,
          [page.id]
        );
      } catch {
        // ignore
      }

      await client.query('COMMIT');

      return {
        success: true as const,
        candidate_id: candidate.id,
        application_id: applicationId,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

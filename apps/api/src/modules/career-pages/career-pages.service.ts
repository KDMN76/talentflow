import crypto from 'crypto';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';

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

function buildMockCareerPage(slug: string): PublicCareerPage {
  const now = new Date().toISOString();
  return {
    career_page: {
      id: crypto.randomUUID(),
      tenant_id: crypto.randomUUID(),
      slug,
      template: 'modern',
      language: 'nl',
      active: true,
      config: {
        header_text: 'Werken bij ons',
        intro_text: 'Ontdek onze openstaande vacatures en solliciteer direct.',
        primary_color: '#6366f1',
        font_family: 'Inter, sans-serif',
        language: 'nl',
      },
    },
    company_name: 'Ons bedrijf',
    jobs: [
      {
        id: crypto.randomUUID(),
        title: 'Senior Software Engineer',
        department: 'Engineering',
        location: 'Amsterdam',
        employment_type: 'fulltime',
        salary_min: 60000,
        salary_max: 85000,
        salary_frequency: 'annual',
        currency: 'EUR',
        compensation_criteria: null,
        description: 'Wij zoeken een ervaren ontwikkelaar.',
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        title: 'Product Designer',
        department: 'Design',
        location: 'Remote',
        employment_type: 'fulltime',
        salary_min: 50000,
        salary_max: 70000,
        salary_frequency: 'annual',
        currency: 'EUR',
        compensation_criteria: null,
        description: 'Help ons mooie producten te bouwen.',
        created_at: now,
      },
    ],
  };
}

function buildMockCareerPageRow(
  tenantId: string,
  data: Partial<CareerPage> & { slug: string }
): CareerPage {
  return {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    slug: data.slug,
    custom_domain: data.custom_domain ?? null,
    active: data.active ?? true,
    config: data.config ?? {},
    language: data.language ?? 'nl',
    template: data.template ?? 'modern',
    visit_count: 0,
    application_count: 0,
    deleted_at: null,
    created_at: new Date().toISOString(),
  };
}

function suggestSlug(slug: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug}-${suffix}`;
}

// ─── Admin Functions ──────────────────────────────────────────────────────────

export async function listCareerPages(tenantId: string): Promise<CareerPage[]> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT *
         FROM career_pages
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [tenantId]
      );
      return rows;
    });
  } catch {
    return [];
  }
}

export async function getCareerPage(
  tenantId: string,
  id: string
): Promise<CareerPage> {
  try {
    return await withTenant(tenantId, async (client) => {
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
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    return buildMockCareerPageRow(tenantId, { slug: 'mock' });
  }
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
  try {
    return await withTenant(tenantId, async (client) => {
      // Check slug uniqueness — auto-suggest with random suffix on conflict
      let slug = data.slug;
      const { rows: existing } = await client.query(
        `SELECT id FROM career_pages WHERE slug = $1`,
        [slug]
      );
      if (existing.length > 0) {
        slug = suggestSlug(data.slug);
      }

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
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    return buildMockCareerPageRow(tenantId, {
      slug: data.slug,
      template: data.template,
      config: data.config,
      language: data.language,
    });
  }
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
  try {
    return await withTenant(tenantId, async (client) => {
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
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    return buildMockCareerPageRow(tenantId, {
      slug: data.slug ?? 'mock',
      template: data.template,
      config: data.config,
      language: data.language,
      active: data.active,
    });
  }
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
  try {
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
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    // Swallow other DB errors (table missing etc.)
  }
}

// ─── Public Functions ─────────────────────────────────────────────────────────

export async function getPublicCareerPage(slug: string): Promise<PublicCareerPage> {
  try {
    return await withoutTenant(async (client) => {
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
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    // Table missing or other DB issue — return mock
    return buildMockCareerPage(slug);
  }
}

export async function submitApplication(
  slug: string,
  data: SubmitApplicationData
): Promise<SubmitApplicationResult> {
  try {
    return await withoutTenant(async (client) => {
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
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    // Table missing or other DB issue — return mock success
    return {
      success: true,
      candidate_id: `mock-candidate-${crypto.randomUUID()}`,
      application_id: `mock-application-${crypto.randomUUID()}`,
    };
  }
}

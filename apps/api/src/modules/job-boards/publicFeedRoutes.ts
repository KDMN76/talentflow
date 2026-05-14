/**
 * Public Vacaturebank XML-feed route.
 *
 * GET /api/public/job-feeds/:tenantSlug/vacaturebank.xml
 *
 *   - NO auth: UWV's scraper hits this anonymously.
 *   - Tenant resolved by `tenants.slug`. Cross-tenant isolation: we ONLY
 *     query rows tagged with that tenant's id.
 *   - Returns only `job_board_postings` with board_id='nationale-vacaturebank'
 *     AND status='posted', joined to their `jobs` row.
 *   - Cache-Control: public, max-age=300 — UWV scrapes daily, but a 5min
 *     cache absorbs traffic spikes from other crawlers.
 *
 * Mounted in `index.ts` near the other public routes (career-pages public).
 */

import { Router, type Request, type Response } from 'express';
import { pool, withTenant } from '../../db/pool';
import { logger } from '../../middleware/errorHandler';
import { buildVacaturebankFeedXml } from './connectors/_helpers/xmlFeed.helper';
import type { NormalizedJob } from './types';

const router = Router();

interface JobFeedRow {
  job_id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  remote_type: string | null;
  employment_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
}

function mapRemote(rt: string | null): 'onsite' | 'hybrid' | 'remote' | undefined {
  if (rt === 'onsite' || rt === 'hybrid' || rt === 'remote') return rt;
  return undefined;
}

function mapEmploymentType(et: string | null): NormalizedJob['employment_type'] | undefined {
  // Jobs.contract_type uses 'fulltime'|'parttime'|'contract'|'temp'; the
  // original `employment_type` column had similar legacy values. Normalize
  // to our canonical NormalizedJob enum.
  switch (et) {
    case 'fulltime':
    case 'full_time':
      return 'full_time';
    case 'parttime':
    case 'part_time':
      return 'part_time';
    case 'contract':
      return 'contract';
    case 'temp':
    case 'temporary':
      return 'temporary';
    case 'internship':
      return 'internship';
    default:
      return undefined;
  }
}

function rowsToNormalizedJobs(rows: JobFeedRow[]): NormalizedJob[] {
  return rows.map((r) => ({
    id: r.job_id,
    title: r.title ?? '',
    description: r.description ?? '',
    location: r.location
      ? { city: r.location, remote_policy: mapRemote(r.remote_type) }
      : undefined,
    employment_type: mapEmploymentType(r.employment_type),
    salary_min: r.salary_min ?? undefined,
    salary_max: r.salary_max ?? undefined,
    currency: r.currency ?? undefined,
  }));
}

/**
 * Resolve a tenant by slug. We do this OUTSIDE `withTenant` because the
 * caller is anonymous — we need the tenant id BEFORE we can scope the
 * subsequent query. Uses the un-scoped pool directly; the `tenants.slug`
 * column is unique so we cannot leak data across tenants here.
 */
async function resolveTenantBySlug(slug: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    return rows[0]?.id ?? null;
  } finally {
    client.release();
  }
}

/**
 * Pull the active Vacaturebank postings + their job rows for one tenant.
 * Wrapped in `withTenant` so RLS is enforced even though we already know
 * the tenant id — defense in depth.
 */
async function loadFeedRows(tenantId: string): Promise<JobFeedRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<JobFeedRow>(
      `SELECT
         j.id              AS job_id,
         j.title           AS title,
         j.description     AS description,
         j.location        AS location,
         j.remote_type     AS remote_type,
         j.employment_type AS employment_type,
         j.salary_min      AS salary_min,
         j.salary_max      AS salary_max,
         j.currency        AS currency
       FROM job_postings p
       JOIN jobs j ON j.id = p.job_id AND j.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1
         AND p.board_id = 'nationale-vacaturebank'
         AND p.status   = 'posted'
       ORDER BY p.posted_at DESC NULLS LAST
       LIMIT 5000`,
      [tenantId]
    );
    return rows;
  });
}

router.get('/job-feeds/:tenantSlug/vacaturebank.xml', async (req: Request, res: Response) => {
  const slug = req.params.tenantSlug;

  let tenantId: string | null;
  try {
    tenantId = await resolveTenantBySlug(slug);
  } catch (err) {
    logger.error('[publicFeedRoutes] tenant lookup failed', {
      slug,
      error: (err as Error).message,
    });
    // Graceful degradation: empty feed rather than 500. UWV will retry.
    res.status(200).type('application/xml').send(buildVacaturebankFeedXml([]));
    return;
  }

  if (!tenantId) {
    res.status(404).json({
      error: { code: 'TENANT_NOT_FOUND', message: 'Tenant slug onbekend', details: { slug } },
    });
    return;
  }

  let rows: JobFeedRow[];
  try {
    rows = await loadFeedRows(tenantId);
  } catch (err) {
    logger.warn('[publicFeedRoutes] feed query failed — serving empty feed', {
      tenantId,
      error: (err as Error).message,
    });
    rows = [];
  }

  const xml = buildVacaturebankFeedXml(rowsToNormalizedJobs(rows));

  res
    .status(200)
    .setHeader('Cache-Control', 'public, max-age=300')
    .setHeader('Content-Type', 'application/xml; charset=utf-8')
    .send(xml);
});

export default router;

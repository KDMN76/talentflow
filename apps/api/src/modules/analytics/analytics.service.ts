import { withTenant } from '../../db/pool';

/**
 * Gedeelde filters voor de analytiek-endpoints.
 *   - from/to: ISO-datums (periode). Per metric geldt een eigen default zodat
 *     bestaand gedrag behouden blijft als er géén periode is gekozen.
 *   - recruiterId: scope alles op de vacatures van één recruiter.
 * Momentopname-KPI's (open vacatures nu, actieve recruiters nu) negeren de
 * periode bewust — die horen "huidig" te zijn.
 */
export interface AnalyticsFilters {
  from?: string | null;
  to?: string | null;
  recruiterId?: string | null;
}

function norm(filters: AnalyticsFilters) {
  return {
    from: filters.from ?? null,
    to: filters.to ?? null,
    recruiterId: filters.recruiterId ?? null,
  };
}

export async function getOverview(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<{
  open_jobs: number;
  total_candidates: number;
  applications_this_month: number;
  avg_time_to_hire_days: number;
  hired_this_month: number;
  active_recruiters: number;
}> {
  const { from, to, recruiterId } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      // Momentopname: open vacatures nu (alleen recruiter-scope).
      const { rows: [openJobsRow] } = await client.query(
        `SELECT COUNT(*) as count FROM jobs
         WHERE tenant_id = $1 AND status = 'open' AND deleted_at IS NULL
           AND ($2::uuid IS NULL OR recruiter_id = $2)`,
        [tenantId, recruiterId]
      );

      // Momentopname: totaal kandidaten (tenant-breed).
      const { rows: [totalCandidatesRow] } = await client.query(
        `SELECT COUNT(*) as count FROM candidates WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId]
      );

      // Periode-cijfer (default: deze maand) + recruiter via job.
      const { rows: [applicationsMonthRow] } = await client.query(
        `SELECT COUNT(*) as count
         FROM applications a JOIN jobs j ON j.id = a.job_id AND j.tenant_id = $1
         WHERE a.tenant_id = $1
           AND a.applied_at >= COALESCE($3::timestamptz, date_trunc('month', now()))
           AND ($4::timestamptz IS NULL OR a.applied_at < $4)
           AND ($2::uuid IS NULL OR j.recruiter_id = $2)`,
        [tenantId, recruiterId, from, to]
      );

      // Periode-cijfer (default: all-time) + recruiter.
      const { rows: [avgTimeRow] } = await client.query(
        `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (close_date::timestamptz - created_at)) / 86400), 0) as avg_days
         FROM jobs
         WHERE tenant_id = $1 AND close_date::timestamptz IS NOT NULL AND deleted_at IS NULL
           AND ($2::uuid IS NULL OR recruiter_id = $2)
           AND ($3::timestamptz IS NULL OR close_date::timestamptz >= $3)
           AND ($4::timestamptz IS NULL OR close_date::timestamptz < $4)`,
        [tenantId, recruiterId, from, to]
      );

      // Periode-cijfer (default: deze maand) + recruiter via job.
      const { rows: [hiredMonthRow] } = await client.query(
        `SELECT COUNT(*) as count
         FROM applications a JOIN jobs j ON j.id = a.job_id AND j.tenant_id = $1
         WHERE a.tenant_id = $1 AND a.status = 'hired'
           AND a.updated_at >= COALESCE($3::timestamptz, date_trunc('month', now()))
           AND ($4::timestamptz IS NULL OR a.updated_at < $4)
           AND ($2::uuid IS NULL OR j.recruiter_id = $2)`,
        [tenantId, recruiterId, from, to]
      );

      // Momentopname: actieve recruiters nu (bij recruiter-filter wordt dit 0/1).
      const { rows: [activeRecruitersRow] } = await client.query(
        `SELECT COUNT(DISTINCT recruiter_id) as count FROM jobs
         WHERE tenant_id = $1 AND status = 'open' AND deleted_at IS NULL AND recruiter_id IS NOT NULL
           AND ($2::uuid IS NULL OR recruiter_id = $2)`,
        [tenantId, recruiterId]
      );

      return {
        open_jobs: parseInt(openJobsRow.count, 10),
        total_candidates: parseInt(totalCandidatesRow.count, 10),
        applications_this_month: parseInt(applicationsMonthRow.count, 10),
        avg_time_to_hire_days: Math.round(parseFloat(avgTimeRow.avg_days) * 10) / 10,
        hired_this_month: parseInt(hiredMonthRow.count, 10),
        active_recruiters: parseInt(activeRecruitersRow.count, 10),
      };
    });
  } catch {
    // Geen verzonnen demo-cijfers: bij een fout tonen we eerlijke nullen.
    return {
      open_jobs: 0,
      total_candidates: 0,
      applications_this_month: 0,
      avg_time_to_hire_days: 0,
      hired_this_month: 0,
      active_recruiters: 0,
    };
  }
}

export async function getFunnel(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<Array<{
  stage_name: string;
  count: number;
  conversion_rate: number;
}>> {
  const { from, to, recruiterId } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      // Periode default = all-time (de funnel is een momentopname van de huidige
      // verdeling); zodra een periode is gekozen, tel alleen sollicitaties daarin.
      const { rows } = await client.query(
        `SELECT ps.name as stage_name, COUNT(a.id) as count, ps.position
         FROM pipeline_stages ps
         LEFT JOIN applications a ON a.stage_id = ps.id AND a.tenant_id = $1
           AND ($3::timestamptz IS NULL OR a.applied_at >= $3)
           AND ($4::timestamptz IS NULL OR a.applied_at < $4)
           AND ($2::uuid IS NULL OR a.job_id IN (
             SELECT id FROM jobs WHERE tenant_id = $1 AND recruiter_id = $2
           ))
         WHERE ps.tenant_id = $1
         GROUP BY ps.name, ps.position
         ORDER BY ps.position`,
        [tenantId, recruiterId, from, to]
      );

      const total = rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);

      return rows.map((r) => ({
        stage_name: r.stage_name,
        count: parseInt(r.count, 10),
        conversion_rate: total > 0 ? Math.round((parseInt(r.count, 10) / total) * 1000) / 10 : 0,
      }));
    });
  } catch {
    return [];
  }
}

export async function getRecruiterStats(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<Array<{
  recruiter_id: string;
  recruiter_name: string;
  open_jobs: number;
  applications_this_month: number;
  hires_this_month: number;
  avg_time_to_hire_days: number;
}>> {
  const { from, to, recruiterId } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           u.id as recruiter_id,
           u.name as recruiter_name,
           COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'open' AND j.deleted_at IS NULL) as open_jobs,
           COUNT(DISTINCT a.id) FILTER (
             WHERE a.applied_at >= COALESCE($3::timestamptz, date_trunc('month', now()))
               AND ($4::timestamptz IS NULL OR a.applied_at < $4)
           ) as applications_this_month,
           COUNT(DISTINCT a.id) FILTER (
             WHERE a.status = 'hired'
               AND a.updated_at >= COALESCE($3::timestamptz, date_trunc('month', now()))
               AND ($4::timestamptz IS NULL OR a.updated_at < $4)
           ) as hires_this_month,
           COALESCE(AVG(EXTRACT(EPOCH FROM (j.close_date::timestamptz - j.created_at)) / 86400) FILTER (WHERE j.close_date::timestamptz IS NOT NULL), 0) as avg_time_to_hire_days
         FROM users u
         LEFT JOIN jobs j ON j.recruiter_id = u.id AND j.tenant_id = $1 AND j.deleted_at IS NULL
         LEFT JOIN applications a ON a.job_id = j.id AND a.tenant_id = $1
         WHERE u.tenant_id = $1
           AND ($2::uuid IS NULL OR u.id = $2)
         GROUP BY u.id, u.name
         ORDER BY open_jobs DESC, applications_this_month DESC`,
        [tenantId, recruiterId, from, to]
      );

      return rows.map((r) => ({
        recruiter_id: r.recruiter_id,
        recruiter_name: r.recruiter_name,
        open_jobs: parseInt(r.open_jobs, 10),
        applications_this_month: parseInt(r.applications_this_month, 10),
        hires_this_month: parseInt(r.hires_this_month, 10),
        avg_time_to_hire_days: Math.round(parseFloat(r.avg_time_to_hire_days) * 10) / 10,
      }));
    });
  } catch {
    return [];
  }
}

export async function getSourceBreakdown(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<Array<{
  source: string;
  count: number;
  percentage: number;
}>> {
  const { from, to, recruiterId } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      // Periode default = all-time; recruiter = kandidaten die op zijn/haar
      // vacatures hebben gesolliciteerd.
      const { rows } = await client.query(
        `SELECT COALESCE(c.source, 'Unknown') as source, COUNT(*) as count
         FROM candidates c
         WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
           AND ($3::timestamptz IS NULL OR c.created_at >= $3)
           AND ($4::timestamptz IS NULL OR c.created_at < $4)
           AND ($2::uuid IS NULL OR c.id IN (
             SELECT a.candidate_id FROM applications a
             JOIN jobs j ON j.id = a.job_id
             WHERE j.tenant_id = $1 AND j.recruiter_id = $2
           ))
         GROUP BY c.source
         ORDER BY count DESC`,
        [tenantId, recruiterId, from, to]
      );

      const total = rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);

      return rows.map((r) => ({
        source: r.source,
        count: parseInt(r.count, 10),
        percentage: total > 0 ? Math.round((parseInt(r.count, 10) / total) * 1000) / 10 : 0,
      }));
    });
  } catch {
    return [];
  }
}

export async function getTimeToHireTrend(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<Array<{
  month: string;
  avg_days: number;
}>> {
  const { from, to, recruiterId } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      // Periode default = laatste 6 maanden; recruiter-scope optioneel.
      const { rows } = await client.query(
        `SELECT
           to_char(date_trunc('month', created_at), 'Mon YYYY') as month,
           COALESCE(
             AVG(EXTRACT(EPOCH FROM (close_date::timestamptz - created_at)) / 86400) FILTER (WHERE close_date::timestamptz IS NOT NULL),
             0
           ) as avg_days
         FROM jobs
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND created_at >= COALESCE($3::timestamptz, now() - interval '6 months')
           AND ($4::timestamptz IS NULL OR created_at < $4)
           AND ($2::uuid IS NULL OR recruiter_id = $2)
         GROUP BY date_trunc('month', created_at)
         ORDER BY date_trunc('month', created_at) ASC
         LIMIT 24`,
        [tenantId, recruiterId, from, to]
      );

      return rows.map((r) => ({
        month: r.month,
        avg_days: Math.round(parseFloat(r.avg_days) * 10) / 10,
      }));
    });
  } catch {
    return [];
  }
}

export async function getApplicationsTrend(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<Array<{
  week: string;
  count: number;
}>> {
  const { from, to, recruiterId } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      // Periode default = laatste 8 weken; recruiter via job.
      const { rows } = await client.query(
        `SELECT
           to_char(date_trunc('week', a.applied_at), 'DD Mon') as week,
           COUNT(*) as count
         FROM applications a
         WHERE a.tenant_id = $1
           AND a.applied_at >= COALESCE($3::timestamptz, now() - interval '8 weeks')
           AND ($4::timestamptz IS NULL OR a.applied_at < $4)
           AND ($2::uuid IS NULL OR a.job_id IN (
             SELECT id FROM jobs WHERE tenant_id = $1 AND recruiter_id = $2
           ))
         GROUP BY date_trunc('week', a.applied_at)
         ORDER BY MIN(a.applied_at)
         LIMIT 52`,
        [tenantId, recruiterId, from, to]
      );

      return rows.map((r) => ({
        week: r.week,
        count: parseInt(r.count, 10),
      }));
    });
  } catch {
    return [];
  }
}

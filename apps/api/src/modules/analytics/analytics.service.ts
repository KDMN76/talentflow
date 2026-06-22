import { withTenant } from '../../db/pool';

export async function getOverview(tenantId: string): Promise<{
  open_jobs: number;
  total_candidates: number;
  applications_this_month: number;
  avg_time_to_hire_days: number;
  hired_this_month: number;
  active_recruiters: number;
}> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [openJobsRow] } = await client.query(
        `SELECT COUNT(*) as count FROM jobs WHERE tenant_id = $1 AND status = 'open' AND deleted_at IS NULL`,
        [tenantId]
      );

      const { rows: [totalCandidatesRow] } = await client.query(
        `SELECT COUNT(*) as count FROM candidates WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId]
      );

      const { rows: [applicationsMonthRow] } = await client.query(
        `SELECT COUNT(*) as count FROM applications
         WHERE tenant_id = $1 AND applied_at >= date_trunc('month', now())`,
        [tenantId]
      );

      const { rows: [avgTimeRow] } = await client.query(
        `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (close_date::timestamptz - created_at)) / 86400), 0) as avg_days
         FROM jobs
         WHERE tenant_id = $1 AND close_date::timestamptz IS NOT NULL AND deleted_at IS NULL`,
        [tenantId]
      );

      const { rows: [hiredMonthRow] } = await client.query(
        `SELECT COUNT(*) as count FROM applications
         WHERE tenant_id = $1 AND status = 'hired'
         AND updated_at >= date_trunc('month', now())`,
        [tenantId]
      );

      const { rows: [activeRecruitersRow] } = await client.query(
        `SELECT COUNT(DISTINCT recruiter_id) as count FROM jobs
         WHERE tenant_id = $1 AND status = 'open' AND deleted_at IS NULL AND recruiter_id IS NOT NULL`,
        [tenantId]
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

export async function getFunnel(tenantId: string): Promise<Array<{
  stage_name: string;
  count: number;
  conversion_rate: number;
}>> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT ps.name as stage_name, COUNT(a.id) as count, ps.position
         FROM pipeline_stages ps
         LEFT JOIN applications a ON a.stage_id = ps.id AND a.tenant_id = $1
         WHERE ps.tenant_id = $1
         GROUP BY ps.name, ps.position
         ORDER BY ps.position`,
        [tenantId]
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

export async function getRecruiterStats(tenantId: string): Promise<Array<{
  recruiter_id: string;
  recruiter_name: string;
  open_jobs: number;
  applications_this_month: number;
  hires_this_month: number;
  avg_time_to_hire_days: number;
}>> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           u.id as recruiter_id,
           u.name as recruiter_name,
           COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'open' AND j.deleted_at IS NULL) as open_jobs,
           COUNT(DISTINCT a.id) FILTER (WHERE a.applied_at >= date_trunc('month', now())) as applications_this_month,
           COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'hired' AND a.updated_at >= date_trunc('month', now())) as hires_this_month,
           COALESCE(AVG(EXTRACT(EPOCH FROM (j.close_date::timestamptz - j.created_at)) / 86400) FILTER (WHERE j.close_date::timestamptz IS NOT NULL), 0) as avg_time_to_hire_days
         FROM users u
         LEFT JOIN jobs j ON j.recruiter_id = u.id AND j.tenant_id = $1 AND j.deleted_at IS NULL
         LEFT JOIN applications a ON a.job_id = j.id AND a.tenant_id = $1
         WHERE u.tenant_id = $1
         GROUP BY u.id, u.name
         ORDER BY open_jobs DESC, applications_this_month DESC`,
        [tenantId]
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

export async function getSourceBreakdown(tenantId: string): Promise<Array<{
  source: string;
  count: number;
  percentage: number;
}>> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT COALESCE(source, 'Unknown') as source, COUNT(*) as count
         FROM candidates
         WHERE tenant_id = $1 AND deleted_at IS NULL
         GROUP BY source
         ORDER BY count DESC`,
        [tenantId]
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

export async function getTimeToHireTrend(tenantId: string): Promise<Array<{
  month: string;
  avg_days: number;
}>> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           to_char(date_trunc('month', created_at), 'Mon YYYY') as month,
           COALESCE(
             AVG(EXTRACT(EPOCH FROM (close_date::timestamptz - created_at)) / 86400) FILTER (WHERE close_date::timestamptz IS NOT NULL),
             0
           ) as avg_days
         FROM jobs
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND created_at >= now() - interval '6 months'
         GROUP BY date_trunc('month', created_at)
         ORDER BY date_trunc('month', created_at) ASC
         LIMIT 6`,
        [tenantId]
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

export async function getApplicationsTrend(tenantId: string): Promise<Array<{
  week: string;
  count: number;
}>> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           to_char(date_trunc('week', applied_at), 'DD Mon') as week,
           COUNT(*) as count
         FROM applications
         WHERE tenant_id = $1
           AND applied_at >= now() - interval '8 weeks'
         GROUP BY date_trunc('week', applied_at)
         ORDER BY MIN(applied_at)`,
        [tenantId]
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

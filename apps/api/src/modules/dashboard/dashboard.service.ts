import { withTenant } from '../../db/pool';

export async function getDashboardStats(tenantId: string) {
  return withTenant(tenantId, async (client) => {
    // Open jobs count
    const { rows: [openJobsRow] } = await client.query(
      `SELECT COUNT(*) as count FROM jobs WHERE tenant_id = $1 AND status = 'open' AND deleted_at IS NULL`,
      [tenantId]
    );

    // Candidates created this month
    const { rows: [candidatesMonthRow] } = await client.query(
      `SELECT COUNT(*) as count FROM candidates
       WHERE tenant_id = $1 AND deleted_at IS NULL
       AND created_at >= date_trunc('month', now())`,
      [tenantId]
    );

    // Applications this week
    const { rows: [applicationsWeekRow] } = await client.query(
      `SELECT COUNT(*) as count FROM applications
       WHERE tenant_id = $1
       AND applied_at >= now() - interval '7 days'`,
      [tenantId]
    );

    // Recent activity (last 20 events)
    const { rows: recentActivity } = await client.query(
      `SELECT a.id, a.entity_type, a.entity_id, a.action, a.payload, a.created_at,
              u.name as user_name
       FROM activities a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.tenant_id = $1
       ORDER BY a.created_at DESC
       LIMIT 20`,
      [tenantId]
    );

    // Top jobs by application count
    const { rows: topJobs } = await client.query(
      `SELECT j.id, j.title, j.status, COUNT(a.id) as application_count
       FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id
       WHERE j.tenant_id = $1 AND j.deleted_at IS NULL
       GROUP BY j.id
       ORDER BY application_count DESC
       LIMIT 5`,
      [tenantId]
    );

    // Hired this month
    const { rows: [hiredMonthRow] } = await client.query(
      `SELECT COUNT(*) as count FROM applications
       WHERE tenant_id = $1 AND status = 'hired'
       AND updated_at >= date_trunc('month', now())`,
      [tenantId]
    );

    return {
      openJobs: parseInt(openJobsRow.count, 10),
      candidatesThisMonth: parseInt(candidatesMonthRow.count, 10),
      applicationsThisWeek: parseInt(applicationsWeekRow.count, 10),
      hiredThisMonth: parseInt(hiredMonthRow.count, 10),
      recentActivity,
      topJobs,
    };
  });
}

/**
 * Paginated activity-log (volledige feed) voor de /activity-pagina. Zelfde bron
 * als het dashboard-`recentActivity`-blok, maar zonder de LIMIT 20.
 */
export async function listActivities(
  tenantId: string,
  opts: { page: number; limit: number }
) {
  return withTenant(tenantId, async (client) => {
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const page = Math.max(opts.page, 1);
    const offset = (page - 1) * limit;

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) as total FROM activities WHERE tenant_id = $1`,
      [tenantId]
    );
    const total = parseInt(countRows[0].total, 10);

    const { rows } = await client.query(
      `SELECT a.id, a.entity_type, a.entity_id, a.action, a.payload, a.created_at,
              u.name as user_name
       FROM activities a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.tenant_id = $1
       ORDER BY a.created_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset]
    );

    return {
      data: rows,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  });
}

/**
 * Volledige activiteitenfeed voor CSV-export (los van de paginatie-cap).
 * Begrensd op 10000 rijen om een runaway-export te voorkomen.
 */
export async function exportActivities(tenantId: string) {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT a.id, a.entity_type, a.entity_id, a.action, a.payload, a.created_at,
              u.name as user_name
       FROM activities a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.tenant_id = $1
       ORDER BY a.created_at DESC
       LIMIT 10000`,
      [tenantId]
    );
    return rows;
  });
}

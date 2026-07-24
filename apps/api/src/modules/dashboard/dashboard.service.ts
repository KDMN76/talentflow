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

    // Recent activity (last 20 events). LEFT JOIN applications zodat
    // 'application'-activiteiten (stage_change e.d.) in de widget deep-gelinkt
    // kunnen worden naar de kandidaat/vacature (zelfde reden als ACTIVITY_SELECT).
    const { rows: recentActivity } = await client.query(
      `SELECT a.id, a.entity_type, a.entity_id, a.action, a.payload, a.created_at,
              u.name as user_name,
              app.candidate_id as app_candidate_id, app.job_id as app_job_id
       FROM activities a
       LEFT JOIN users u ON u.id = a.user_id AND u.tenant_id = a.tenant_id
       LEFT JOIN applications app
         ON app.id = a.entity_id
        AND a.entity_type = 'application'
        AND app.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1
       ORDER BY a.created_at DESC
       LIMIT 20`,
      [tenantId]
    );

    // Top jobs by application count
    const { rows: topJobs } = await client.query(
      `SELECT j.id, j.title, j.status, COUNT(a.id) as application_count
       FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id AND a.tenant_id = j.tenant_id
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
 * Filters voor het activiteitenlog: op persoon (user), pagina/entiteit,
 * actie-type en datumbereik. Alle optioneel; leeg = geen filter.
 */
export interface ActivityFilters {
  userId?: string;
  entityType?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Bouwt de WHERE + waarden voor het activiteitenlog (gedeeld door list+export). */
function buildActivityWhere(tenantId: string, f: ActivityFilters) {
  const conditions: string[] = ['a.tenant_id = $1'];
  const values: unknown[] = [tenantId];
  let idx = 2;
  if (f.userId) {
    conditions.push(`a.user_id = $${idx++}`);
    values.push(f.userId);
  }
  if (f.entityType) {
    conditions.push(`a.entity_type = $${idx++}`);
    values.push(f.entityType);
  }
  if (f.action) {
    conditions.push(`a.action = $${idx++}`);
    values.push(f.action);
  }
  if (f.dateFrom) {
    conditions.push(`a.created_at >= $${idx++}`);
    values.push(f.dateFrom);
  }
  if (f.dateTo) {
    conditions.push(`a.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(f.dateTo);
  }
  return { where: conditions.join(' AND '), values, nextIdx: idx };
}

// SELECT-kolommen gedeeld door list + export. De LEFT JOIN applications zet
// candidate_id/job_id erbij voor 'application'-activiteiten (bv. stage_change),
// zodat de UI die regels kan deep-linken naar de kandidaat/vacature — de
// activity zelf heeft alleen een application-id, dat geen eigen pagina heeft.
const ACTIVITY_SELECT = `
  a.id, a.entity_type, a.entity_id, a.action, a.payload, a.created_at,
  a.user_id, u.name as user_name,
  app.candidate_id as app_candidate_id, app.job_id as app_job_id
  FROM activities a
  LEFT JOIN users u ON u.id = a.user_id AND u.tenant_id = a.tenant_id
  LEFT JOIN applications app
    ON app.id = a.entity_id
   AND a.entity_type = 'application'
   AND app.tenant_id = a.tenant_id`;

/**
 * Paginated activity-log (volledige feed) voor de /activity-pagina. Zelfde bron
 * als het dashboard-`recentActivity`-blok, maar zonder de LIMIT 20 en met
 * optionele filters (persoon/entiteit/actie/datum).
 */
export async function listActivities(
  tenantId: string,
  opts: { page: number; limit: number } & ActivityFilters
) {
  return withTenant(tenantId, async (client) => {
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const page = Math.max(opts.page, 1);
    const offset = (page - 1) * limit;
    const { where, values, nextIdx } = buildActivityWhere(tenantId, opts);

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) as total FROM activities a WHERE ${where}`,
      values
    );
    const total = parseInt(countRows[0].total, 10);

    const { rows } = await client.query(
      `SELECT ${ACTIVITY_SELECT}
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      [...values, limit, offset]
    );

    return {
      data: rows,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  });
}

/**
 * Volledige (gefilterde) activiteitenfeed voor CSV-export, los van de
 * paginatie-cap. Begrensd op 10000 rijen om een runaway-export te voorkomen.
 */
export async function exportActivities(tenantId: string, filters: ActivityFilters = {}) {
  return withTenant(tenantId, async (client) => {
    const { where, values, nextIdx } = buildActivityWhere(tenantId, filters);
    const { rows } = await client.query(
      `SELECT ${ACTIVITY_SELECT}
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT $${nextIdx}`,
      [...values, 10000]
    );
    return rows;
  });
}

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';

export type DealStage = 'prospect' | 'offerte' | 'onderhandeling' | 'gewonnen' | 'verloren';

export const DEAL_STAGES: DealStage[] = [
  'prospect',
  'offerte',
  'onderhandeling',
  'gewonnen',
  'verloren',
];

export interface DealListFilter {
  stage?: DealStage;
  organization_id?: string;
  recruiter_id?: string;
  job_id?: string;
}

export interface DealCreateData {
  organization_id?: string | null;
  job_id?: string | null;
  recruiter_id?: string | null;
  title: string;
  stage?: DealStage;
  value_eur?: number | null;
  expected_close_date?: string | null;
  notes?: string | null;
}

export interface DealUpdateData {
  organization_id?: string | null;
  job_id?: string | null;
  recruiter_id?: string | null;
  title?: string;
  stage?: DealStage;
  value_eur?: number | null;
  expected_close_date?: string | null;
  notes?: string | null;
}

function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '42P01';
}

const SELECT_DEAL_FIELDS = `
  d.id, d.tenant_id, d.organization_id, d.job_id, d.recruiter_id, d.title, d.stage,
  d.value_eur, d.expected_close_date, d.notes, d.created_at,
  o.name as organization_name,
  j.title as job_title,
  u.name as recruiter_name
`;

const SELECT_DEAL_JOINS = `
  FROM crm_deals d
  LEFT JOIN organizations o ON o.id = d.organization_id AND o.tenant_id = d.tenant_id
  LEFT JOIN jobs j ON j.id = d.job_id AND j.tenant_id = d.tenant_id
  LEFT JOIN users u ON u.id = d.recruiter_id
`;

export async function listDeals(tenantId: string, filter: DealListFilter = {}) {
  try {
    return await withTenant(tenantId, async (client) => {
      const conditions: string[] = [`d.tenant_id = $1`];
      const values: unknown[] = [tenantId];
      let idx = 2;

      if (filter.stage) {
        conditions.push(`d.stage = $${idx++}`);
        values.push(filter.stage);
      }
      if (filter.organization_id) {
        conditions.push(`d.organization_id = $${idx++}`);
        values.push(filter.organization_id);
      }
      if (filter.recruiter_id) {
        conditions.push(`d.recruiter_id = $${idx++}`);
        values.push(filter.recruiter_id);
      }
      if (filter.job_id) {
        conditions.push(`d.job_id = $${idx++}`);
        values.push(filter.job_id);
      }

      const where = conditions.join(' AND ');

      const { rows } = await client.query(
        `SELECT ${SELECT_DEAL_FIELDS}
         ${SELECT_DEAL_JOINS}
         WHERE ${where}
         ORDER BY d.created_at DESC`,
        values
      );

      return rows;
    });
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

export async function getDeal(tenantId: string, id: string) {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [deal] } = await client.query(
        `SELECT ${SELECT_DEAL_FIELDS}
         ${SELECT_DEAL_JOINS}
         WHERE d.id = $1 AND d.tenant_id = $2`,
        [id, tenantId]
      );

      if (!deal) {
        throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal niet gevonden');
      }

      return deal;
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal niet gevonden');
    }
    throw err;
  }
}

export async function createDeal(
  tenantId: string,
  _userId: string,
  data: DealCreateData
) {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [deal] } = await client.query(
        `INSERT INTO crm_deals (tenant_id, organization_id, job_id, recruiter_id, title, stage, value_eur, expected_close_date, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         RETURNING *`,
        [
          tenantId,
          data.organization_id ?? null,
          data.job_id ?? null,
          data.recruiter_id ?? null,
          data.title,
          data.stage ?? 'prospect',
          data.value_eur ?? null,
          data.expected_close_date ?? null,
          data.notes ?? null,
        ]
      );
      return deal;
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(503, 'CRM_NOT_PROVISIONED', 'CRM-tabellen zijn nog niet beschikbaar');
    }
    throw err;
  }
}

export async function updateDeal(
  tenantId: string,
  id: string,
  _userId: string,
  data: DealUpdateData
) {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [existing] } = await client.query(
        `SELECT id FROM crm_deals WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (!existing) {
        throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal niet gevonden');
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      const mappable = [
        'organization_id',
        'job_id',
        'recruiter_id',
        'title',
        'stage',
        'value_eur',
        'expected_close_date',
        'notes',
      ] as const;
      for (const key of mappable) {
        if (data[key] !== undefined) {
          fields.push(`${key} = $${idx++}`);
          values.push(data[key]);
        }
      }

      if (fields.length === 0) {
        throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
      }

      values.push(id, tenantId);

      const { rows: [deal] } = await client.query(
        `UPDATE crm_deals SET ${fields.join(', ')}
         WHERE id = $${idx++} AND tenant_id = $${idx}
         RETURNING *`,
        values
      );

      return deal;
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal niet gevonden');
    }
    throw err;
  }
}

export async function deleteDeal(tenantId: string, id: string): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      const { rows: [deal] } = await client.query(
        `DELETE FROM crm_deals WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );

      if (!deal) {
        throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal niet gevonden');
      }
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal niet gevonden');
    }
    throw err;
  }
}

export async function moveDealStage(
  tenantId: string,
  id: string,
  newStage: DealStage
) {
  if (!DEAL_STAGES.includes(newStage)) {
    throw new AppError(400, 'INVALID_STAGE', 'Ongeldige deal-fase');
  }

  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [deal] } = await client.query(
        `UPDATE crm_deals SET stage = $1
         WHERE id = $2 AND tenant_id = $3
         RETURNING *`,
        [newStage, id, tenantId]
      );

      if (!deal) {
        throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal niet gevonden');
      }

      return deal;
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal niet gevonden');
    }
    throw err;
  }
}

export async function getDealsPipeline(tenantId: string) {
  // Returns deals grouped by stage, including all stages even if empty.
  const empty: Record<DealStage, { stage: DealStage; deals: unknown[]; count: number; total_value_eur: number }> = {
    prospect: { stage: 'prospect', deals: [], count: 0, total_value_eur: 0 },
    offerte: { stage: 'offerte', deals: [], count: 0, total_value_eur: 0 },
    onderhandeling: { stage: 'onderhandeling', deals: [], count: 0, total_value_eur: 0 },
    gewonnen: { stage: 'gewonnen', deals: [], count: 0, total_value_eur: 0 },
    verloren: { stage: 'verloren', deals: [], count: 0, total_value_eur: 0 },
  };

  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT ${SELECT_DEAL_FIELDS}
         ${SELECT_DEAL_JOINS}
         WHERE d.tenant_id = $1
         ORDER BY d.created_at DESC`,
        [tenantId]
      );

      const grouped = { ...empty };
      for (const stage of DEAL_STAGES) {
        grouped[stage] = { stage, deals: [], count: 0, total_value_eur: 0 };
      }

      for (const row of rows) {
        const stage = (row.stage as DealStage) || 'prospect';
        const bucket = grouped[stage] ?? grouped.prospect;
        bucket.deals.push(row);
        bucket.count += 1;
        bucket.total_value_eur += Number(row.value_eur ?? 0);
      }

      return DEAL_STAGES.map((stage) => grouped[stage]);
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      return DEAL_STAGES.map((stage) => ({ stage, deals: [], count: 0, total_value_eur: 0 }));
    }
    throw err;
  }
}

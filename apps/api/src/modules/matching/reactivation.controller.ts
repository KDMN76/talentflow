/**
 * Talent Reactivation alerts controller — Sprint Q3.2.
 *
 * Endpoints:
 *   GET  /api/matching/reactivation-alerts
 *           ?job_id=&acknowledged=true|false&dismissed=true|false&limit=
 *   POST /api/matching/reactivation-alerts/:id/acknowledge
 *   POST /api/matching/reactivation-alerts/:id/dismiss
 *   GET  /api/matching/reactivation-alerts/stats
 *
 * Alle queries via withTenant ⇒ RLS-gefilterd. Audit-log per state-change.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, auditCtxFromReq } from '../../lib/audit';

const uuidSchema = z.string().uuid({ message: 'Ongeldig id-formaat (UUID)' });

const listFiltersSchema = z.object({
  job_id: z.string().uuid().optional(),
  acknowledged: z
    .preprocess(
      (v) => (v === undefined || v === null ? v : String(v).toLowerCase()),
      z.enum(['true', 'false']).optional()
    )
    .optional(),
  dismissed: z
    .preprocess(
      (v) => (v === undefined || v === null ? v : String(v).toLowerCase()),
      z.enum(['true', 'false']).optional()
    )
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

interface AlertRow {
  id: string;
  tenant_id: string;
  job_id: string;
  candidate_id: string;
  match_score: string | number;
  reason: string | null;
  acknowledged_at: Date | string | null;
  acknowledged_by: string | null;
  dismissed_at: Date | string | null;
  created_at: Date | string;
  job_title: string | null;
  candidate_name: string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toNumber(value: string | number): number {
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowToDto(row: AlertRow): Record<string, unknown> {
  const score = toNumber(row.match_score);
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    job_id: row.job_id,
    job_title: row.job_title,
    candidate_id: row.candidate_id,
    candidate_name: row.candidate_name,
    match_score: score,
    match_percent: Math.round(Math.max(0, Math.min(1, score)) * 100),
    reason: row.reason,
    acknowledged_at: toIso(row.acknowledged_at),
    acknowledged_by: row.acknowledged_by,
    dismissed_at: toIso(row.dismissed_at),
    created_at: toIso(row.created_at) ?? new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/matching/reactivation-alerts
// ─────────────────────────────────────────────────────────────────────────────

export async function listAlerts(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { job_id, acknowledged, dismissed, limit } = listFiltersSchema.parse(req.query);
    const effectiveLimit = limit ?? 100;
    const tenantId = req.user!.tenantId;

    const data = await withTenant(tenantId, async (client) => {
      const conditions: string[] = ['a.tenant_id = $1'];
      const values: unknown[] = [tenantId];
      let idx = 2;

      if (job_id) {
        conditions.push(`a.job_id = $${idx++}`);
        values.push(job_id);
      }
      if (acknowledged === 'true') {
        conditions.push(`a.acknowledged_at IS NOT NULL`);
      } else if (acknowledged === 'false') {
        conditions.push(`a.acknowledged_at IS NULL`);
      }
      if (dismissed === 'true') {
        conditions.push(`a.dismissed_at IS NOT NULL`);
      } else if (dismissed === 'false') {
        conditions.push(`a.dismissed_at IS NULL`);
      }

      const { rows } = await client.query<AlertRow>(
        `SELECT a.*,
                j.title AS job_title,
                c.name  AS candidate_name
           FROM talent_reactivation_alerts a
           LEFT JOIN jobs       j ON j.id = a.job_id       AND j.tenant_id = a.tenant_id
           LEFT JOIN candidates c ON c.id = a.candidate_id AND c.tenant_id = a.tenant_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY a.acknowledged_at NULLS FIRST, a.match_score DESC, a.created_at DESC
          LIMIT $${idx}`,
        [...values, effectiveLimit]
      );
      return rows.map(rowToDto);
    });

    res.json({ data, meta: { count: data.length, limit: effectiveLimit } });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/matching/reactivation-alerts/:id/acknowledge
// ─────────────────────────────────────────────────────────────────────────────

export async function acknowledgeAlert(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = uuidSchema.parse(req.params.id);
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const dto = await withTenant(tenantId, async (client) => {
      const { rows: [existing] } = await client.query<AlertRow>(
        `SELECT * FROM talent_reactivation_alerts WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (!existing) {
        throw new AppError(404, 'ALERT_NOT_FOUND', 'Alert niet gevonden');
      }

      const { rows } = await client.query<AlertRow>(
        `UPDATE talent_reactivation_alerts
            SET acknowledged_at = COALESCE(acknowledged_at, now()),
                acknowledged_by = COALESCE(acknowledged_by, $1)
          WHERE id = $2 AND tenant_id = $3
          RETURNING *`,
        [userId, id, tenantId]
      );

      // Hydrate met job/candidate-namen voor de respons.
      const { rows: hydrated } = await client.query<AlertRow>(
        `SELECT a.*,
                j.title AS job_title,
                c.name  AS candidate_name
           FROM talent_reactivation_alerts a
           LEFT JOIN jobs       j ON j.id = a.job_id       AND j.tenant_id = a.tenant_id
           LEFT JOIN candidates c ON c.id = a.candidate_id AND c.tenant_id = a.tenant_id
          WHERE a.id = $1 AND a.tenant_id = $2`,
        [id, tenantId]
      );

      await logAudit(
        client,
        tenantId,
        {
          action: 'reactivation_alert.acknowledged',
          entityType: 'talent_reactivation_alert',
          entityId: id,
          before: { acknowledged_at: existing.acknowledged_at },
          after: { acknowledged_at: rows[0].acknowledged_at, acknowledged_by: userId },
          userId,
        },
        auditCtxFromReq(req)
      );
      return rowToDto(hydrated[0] ?? rows[0]);
    });
    res.json(dto);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/matching/reactivation-alerts/:id/dismiss
// ─────────────────────────────────────────────────────────────────────────────

export async function dismissAlert(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = uuidSchema.parse(req.params.id);
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const dto = await withTenant(tenantId, async (client) => {
      const { rows: [existing] } = await client.query<AlertRow>(
        `SELECT * FROM talent_reactivation_alerts WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (!existing) {
        throw new AppError(404, 'ALERT_NOT_FOUND', 'Alert niet gevonden');
      }

      await client.query(
        `UPDATE talent_reactivation_alerts
            SET dismissed_at = COALESCE(dismissed_at, now())
          WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );

      const { rows: hydrated } = await client.query<AlertRow>(
        `SELECT a.*,
                j.title AS job_title,
                c.name  AS candidate_name
           FROM talent_reactivation_alerts a
           LEFT JOIN jobs       j ON j.id = a.job_id       AND j.tenant_id = a.tenant_id
           LEFT JOIN candidates c ON c.id = a.candidate_id AND c.tenant_id = a.tenant_id
          WHERE a.id = $1 AND a.tenant_id = $2`,
        [id, tenantId]
      );

      await logAudit(
        client,
        tenantId,
        {
          action: 'reactivation_alert.dismissed',
          entityType: 'talent_reactivation_alert',
          entityId: id,
          before: { dismissed_at: existing.dismissed_at },
          after: { dismissed_at: new Date().toISOString() },
          userId,
        },
        auditCtxFromReq(req)
      );

      return rowToDto(hydrated[0]);
    });
    res.json(dto);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/matching/reactivation-alerts/stats
// ─────────────────────────────────────────────────────────────────────────────

export async function getStats(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const stats = await withTenant(tenantId, async (client) => {
      const { rows } = await client.query<{
        unacknowledged: string;
        this_week: string;
        dismissed_total: string;
      }>(
        `SELECT
            COUNT(*) FILTER (WHERE acknowledged_at IS NULL AND dismissed_at IS NULL) AS unacknowledged,
            COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')           AS this_week,
            COUNT(*) FILTER (WHERE dismissed_at IS NOT NULL)                          AS dismissed_total
           FROM talent_reactivation_alerts
          WHERE tenant_id = $1`,
        [tenantId]
      );
      const r = rows[0] ?? { unacknowledged: '0', this_week: '0', dismissed_total: '0' };
      return {
        unacknowledged: parseInt(r.unacknowledged, 10) || 0,
        this_week: parseInt(r.this_week, 10) || 0,
        dismissed_total: parseInt(r.dismissed_total, 10) || 0,
      };
    });
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

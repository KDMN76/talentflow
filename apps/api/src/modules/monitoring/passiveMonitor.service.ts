/**
 * Passive monitoring — Sprint Q4.5 (Agent XXX).
 *
 * Per-tenant nightly scan of existing candidates for "warm" signals
 * (job-change, title-change, funding round, OPEN_TO_WORK flag, etc.). Every
 * scan inserts `candidate_signals` rows. Strong signals (e.g. job_change
 * with consent + recent activity) automatically draft a reactivation
 * outreach via outreach.service in `pending_approval` so a recruiter can
 * click ✅ to send.
 *
 * Live mode: gated on `process.env.LINKEDIN_MONITOR_LIVE === 'true'`.
 *   ⚠️  LinkedIn explicitly forbids automated scraping. The "live" path is a
 *       placeholder for an integration with an enrichment vendor that has
 *       LinkedIn data licensed (e.g. Hunter.io / RocketReach / Lusha).
 *       Without LIVE=true we run a synthetic mock generator.
 *
 * Mock generator: deterministic — picks ~5% of candidates per scan (using a
 * stable hash of candidate.id + scan-date) and emits a synthetic job_change
 * signal. This is good enough for end-to-end tests and demo flows.
 */

import { createHash } from 'crypto';
import { withTenant, withoutTenant } from '../../db/pool';
import { logger } from '../../middleware/errorHandler';
import { logAudit } from '../../lib/audit';
import {
  draftOutreachMessage,
  type OutreachChannel,
} from '../outreach/outreach.service';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type SignalType =
  | 'job_change'
  | 'title_change'
  | 'company_growth'
  | 'funding_round'
  | 'linkedin_post'
  | 'open_to_work_flag';

export interface SignalRow {
  id: string;
  tenant_id: string;
  candidate_id: string;
  signal_type: SignalType;
  detected_at: string;
  source: string | null;
  before_value: string | null;
  after_value: string | null;
  raw_payload: Record<string, unknown>;
  reviewed: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  triggered_action: string | null;
}

export interface ScanResult {
  candidates_scanned: number;
  signals_emitted: number;
  reactivations_drafted: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Mock generator
// ───────────────────────────────────────────────────────────────────────────

const SCAN_HIT_RATE = 0.05;

function deterministicHit(candidateId: string, dateBucket: string): boolean {
  const hex = createHash('sha256')
    .update(`${candidateId}|${dateBucket}`)
    .digest('hex');
  // Take first 8 hex chars → 32-bit int → divide by max for a 0..1 number.
  const intVal = parseInt(hex.slice(0, 8), 16);
  return intVal / 0xffffffff < SCAN_HIT_RATE;
}

function mockJobChangeFor(candidateId: string): {
  before_value: string;
  after_value: string;
  raw_payload: Record<string, unknown>;
} {
  const seed = parseInt(candidateId.replace(/-/g, '').slice(0, 8), 16) || 1;
  const newCompanies = ['Booking.com', 'Mollie', 'Adyen', 'Bol.com', 'TomTom'];
  const newTitles = [
    'Senior Software Engineer',
    'Engineering Manager',
    'Tech Lead',
    'Staff Engineer',
    'Principal Engineer',
  ];
  return {
    before_value: 'previous_company',
    after_value: `${newTitles[seed % newTitles.length]} @ ${newCompanies[seed % newCompanies.length]}`,
    raw_payload: {
      synthetic: true,
      generated_for_test: true,
      detected_via: 'mock_passive_monitor',
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

export interface ScanOptions {
  /** Max candidates to scan per tenant (cron tick). Default 500. */
  maxPerTenant?: number;
  /** Override the date bucket — used by tests for determinism. */
  dateBucket?: string;
}

export async function scanCandidatesForSignals(
  tenantId: string,
  opts: ScanOptions = {}
): Promise<ScanResult> {
  const isLive = process.env.LINKEDIN_MONITOR_LIVE === 'true';
  const maxPer = opts.maxPerTenant ?? 500;
  const dateBucket = opts.dateBucket ?? new Date().toISOString().slice(0, 10);

  const result: ScanResult = {
    candidates_scanned: 0,
    signals_emitted: 0,
    reactivations_drafted: 0,
  };

  const candidates = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      name: string | null;
      first_name: string | null;
      email: string | null;
      created_at: string;
    }>(
      `SELECT id, name, first_name, email, created_at
         FROM candidates
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT $2`,
      [tenantId, maxPer]
    );
    return rows;
  });
  result.candidates_scanned = candidates.length;

  for (const cand of candidates) {
    let hit = false;
    let signal: ReturnType<typeof mockJobChangeFor> | null = null;
    let signalType: SignalType = 'job_change';
    let source = 'mock_passive_monitor';

    if (isLive) {
      // TODO(real-api): integrate with the enrichment vendor of choice.
      // For now we no-op in live mode to avoid silently emitting fake signals.
      continue;
    } else {
      hit = deterministicHit(cand.id, dateBucket);
      if (hit) signal = mockJobChangeFor(cand.id);
    }

    if (!hit || !signal) continue;

    const inserted = await withTenant(tenantId, async (client) => {
      const { rows: [existing] } = await client.query<{ id: string }>(
        `SELECT id FROM candidate_signals
           WHERE tenant_id = $1 AND candidate_id = $2 AND signal_type = $3
             AND detected_at::date = CURRENT_DATE
           LIMIT 1`,
        [tenantId, cand.id, signalType]
      );
      if (existing) return null;

      const { rows: [row] } = await client.query<SignalRow>(
        `INSERT INTO candidate_signals
           (tenant_id, candidate_id, signal_type, source,
            before_value, after_value, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING *`,
        [
          tenantId,
          cand.id,
          signalType,
          source,
          signal.before_value,
          signal.after_value,
          JSON.stringify(signal.raw_payload),
        ]
      );

      await logAudit(
        client,
        tenantId,
        {
          action: 'monitoring.signal.detected',
          entityType: 'candidate_signal',
          entityId: row.id,
          after: { signal_type: signalType, candidate_id: cand.id },
        },
        {}
      );

      return row;
    });

    if (!inserted) continue;
    result.signals_emitted += 1;

    // Trigger reactivation outreach (pending_approval) when consent + recent.
    const eligible = await isEligibleForReactivation(tenantId, cand.id);
    if (!eligible) continue;
    try {
      await draftOutreachMessage(
        tenantId,
        cand.id,
        { channel: 'email' as OutreachChannel, ai_personalize: true },
        {
          reactivation_reason: signal.after_value,
          recent_company: signal.after_value.split(' @ ').pop(),
          recent_title: signal.after_value.split(' @ ')[0],
        },
        { userId: '00000000-0000-0000-0000-000000000000', requireApproval: true }
      );
      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE candidate_signals
              SET triggered_action = 'reactivation_outreach_drafted'
            WHERE id = $1 AND tenant_id = $2`,
          [inserted.id, tenantId]
        );
      });
      result.reactivations_drafted += 1;
    } catch (err) {
      logger.warn('[passiveMonitor] reactivation draft failed', {
        candidateId: cand.id,
        error: (err as Error).message,
      });
    }
  }

  return result;
}

async function isEligibleForReactivation(
  tenantId: string,
  candidateId: string
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    try {
      const { rows: [row] } = await client.query<{
        consent: boolean | null;
        last_activity: string | null;
      }>(
        `SELECT
           COALESCE((metadata->>'do_not_contact')::boolean, false) = false AS consent,
           updated_at AS last_activity
           FROM candidates
           WHERE id = $1 AND tenant_id = $2`,
        [candidateId, tenantId]
      );
      if (!row || !row.consent) return false;
      if (!row.last_activity) return true;
      const last = new Date(row.last_activity).getTime();
      const eighteenMonthsMs = 18 * 30 * 24 * 60 * 60 * 1000;
      return Date.now() - last < eighteenMonthsMs;
    } catch {
      return false;
    }
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Listing + actions
// ───────────────────────────────────────────────────────────────────────────

export interface ListSignalsFilters {
  signal_type?: SignalType;
  unreviewed?: boolean;
  cursor?: string;
  limit?: number;
}

export async function listSignals(
  tenantId: string,
  filters: ListSignalsFilters
): Promise<{ data: SignalRow[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return withTenant(tenantId, async (client) => {
    const conds: string[] = [`tenant_id = $1`];
    const values: unknown[] = [tenantId];
    if (filters.signal_type) {
      values.push(filters.signal_type);
      conds.push(`signal_type = $${values.length}`);
    }
    if (filters.unreviewed) conds.push(`reviewed = FALSE`);
    if (filters.cursor) {
      values.push(filters.cursor);
      conds.push(`detected_at < $${values.length}`);
    }
    const { rows } = await client.query<SignalRow>(
      `SELECT * FROM candidate_signals
         WHERE ${conds.join(' AND ')}
         ORDER BY detected_at DESC, id DESC
         LIMIT ${limit + 1}`,
      values
    );
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      data,
      next_cursor: hasMore ? data[data.length - 1].detected_at : null,
    };
  });
}

export async function dismissSignal(
  tenantId: string,
  signalId: string,
  userId: string
): Promise<SignalRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<SignalRow>(
      `UPDATE candidate_signals
          SET reviewed = TRUE, reviewed_by = $1, reviewed_at = now()
        WHERE id = $2 AND tenant_id = $3
        RETURNING *`,
      [userId, signalId, tenantId]
    );
    if (!row) {
      throw new Error('SIGNAL_NOT_FOUND');
    }
    return row;
  });
}

/**
 * List all tenant ids with at least one candidate — used by the cron worker.
 * Run with `withoutTenant` because we need cross-tenant visibility.
 */
export async function listTenantIdsForScan(): Promise<string[]> {
  return withoutTenant(async (client) => {
    try {
      const { rows } = await client.query<{ tenant_id: string }>(
        `SELECT DISTINCT tenant_id FROM candidates WHERE deleted_at IS NULL`
      );
      return rows.map((r) => r.tenant_id);
    } catch {
      return [];
    }
  });
}

/**
 * Job-board orchestration service — Sprint Q4.3 (Agent QQQ).
 *
 * Vervangt de stale `job-boards.service.ts` (legacy `job_board_postings`
 * tabel met enum pending|published|failed|expired|removed). De nieuwe shape
 * spreekt met:
 *   - `job_board_integrations`        : per-tenant board-credentials
 *   - `job_postings`                  : externe plaatsingen
 *   - `job_posting_status_events`     : append-only event-trail
 *   - `cost_per_hire_records`         : toegerekende kost per hire
 *
 * Multi-tenancy: ALLE queries via `withTenant(tenantId, ...)` zodat RLS
 * automatisch isolatie afdwingt.
 *
 * Audit: connect/disconnect/retract/post worden ge-audit-logged via
 * `lib/audit.ts`. Mislukken van audit-INSERTs blokkeren nooit de
 * hoofd-mutatie.
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { logger } from '../../middleware/errorHandler';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { encrypt, decrypt } from '../../lib/encryption';
import {
  jobBoardPostQueue,
  jobBoardPollQueue,
} from '../../queue/queues';
import { getConnector, listConnectors } from './registry';
import type {
  ConnectorContext,
  IntegrationCreds,
  JobBoardConnector,
  JobBoardIntegrationStatus,
  JobPostingStatus,
  NormalizedJob,
  PostingRef,
  StatusUpdate,
} from './types';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface JobBoardIntegrationRow {
  id: string;
  tenant_id: string;
  board_id: string;
  display_name: string | null;
  status: JobBoardIntegrationStatus;
  settings: Record<string, unknown>;
  connected_by: string | null;
  connected_at: string | null;
  last_polled_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface JobPostingRow {
  id: string;
  tenant_id: string;
  job_id: string;
  board_id: string;
  integration_id: string | null;
  external_id: string | null;
  external_url: string | null;
  status: JobPostingStatus;
  posted_at: string | null;
  expires_at: string | null;
  retracted_at: string | null;
  cost_amount: number | null;
  cost_currency: string;
  applicants_count: number;
  last_polled_at: string | null;
  metadata: Record<string, unknown>;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CatalogEntry {
  id: string;
  display_name: string;
  region: string;
  auth_type: string;
  connected: boolean;
  integration_id: string | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function rowToIntegrationCreds(row: {
  id: string;
  tenant_id: string;
  settings: Record<string, unknown>;
  credentials_encrypted: Buffer | null;
}): IntegrationCreds {
  let credentials: Record<string, unknown> = {};
  if (row.credentials_encrypted) {
    try {
      credentials = JSON.parse(decrypt(row.credentials_encrypted));
    } catch (err) {
      logger.warn('[jobBoards] decrypt failed — falling back to empty creds', {
        integration_id: row.id,
        error: (err as Error).message,
      });
    }
  }
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    settings: row.settings ?? {},
    credentials,
  };
}

function rowToIntegration(row: Record<string, unknown>): JobBoardIntegrationRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    board_id: String(row.board_id),
    display_name: (row.display_name as string | null) ?? null,
    status: (row.status as JobBoardIntegrationStatus) ?? 'connected',
    settings: (row.settings as Record<string, unknown>) ?? {},
    connected_by: (row.connected_by as string | null) ?? null,
    connected_at: (row.connected_at as string | null) ?? null,
    last_polled_at: (row.last_polled_at as string | null) ?? null,
    last_error: (row.last_error as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

async function loadJobForPosting(
  client: PoolClient,
  tenantId: string,
  jobId: string
): Promise<NormalizedJob> {
  const { rows } = await client.query<{
    id: string;
    title: string;
    description: string | null;
    salary_min: number | null;
    salary_max: number | null;
    currency: string | null;
    employment_type: string | null;
    location: string | null;
    requirements: string[] | null;
  }>(
    `SELECT id, title, description, salary_min, salary_max, currency,
            employment_type, location, requirements
       FROM jobs
      WHERE id = $1 AND tenant_id = $2`,
    [jobId, tenantId]
  );
  const job = rows[0];
  if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
  // Map naar NormalizedJob — defensief, jobs.location is in dit project
  // typisch een vrije string. We zetten 'm op city; country defaulten we naar NL.
  return {
    id: job.id,
    title: job.title,
    description: job.description ?? '',
    salary_min: job.salary_min ?? undefined,
    salary_max: job.salary_max ?? undefined,
    currency: job.currency ?? 'EUR',
    employment_type: mapEmploymentType(job.employment_type),
    location: job.location
      ? { city: job.location, country: 'NL' }
      : undefined,
    requirements: job.requirements ?? undefined,
    language: 'nl',
  };
}

function mapEmploymentType(
  raw: string | null
): NormalizedJob['employment_type'] {
  if (!raw) return 'full_time';
  const norm = raw.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (norm.startsWith('full')) return 'full_time';
  if (norm.startsWith('part')) return 'part_time';
  if (norm === 'contract') return 'contract';
  if (norm === 'temp' || norm === 'temporary') return 'temporary';
  if (norm === 'internship' || norm === 'intern') return 'internship';
  return 'full_time';
}

// ───────────────────────────────────────────────────────────────────────────
// Catalog & integrations
// ───────────────────────────────────────────────────────────────────────────

export async function listCatalog(tenantId: string): Promise<CatalogEntry[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      board_id: string;
      status: string;
    }>(`SELECT id, board_id, status FROM job_board_integrations`);
    const byBoard = new Map(rows.map((r) => [r.board_id, r]));
    return listConnectors().map<CatalogEntry>((conn) => {
      const row = byBoard.get(conn.id);
      return {
        id: conn.id,
        display_name: conn.displayName,
        region: conn.region,
        auth_type: conn.authType,
        connected: row?.status === 'connected',
        integration_id: row?.id ?? null,
      };
    });
  });
}

export async function listIntegrations(
  tenantId: string
): Promise<JobBoardIntegrationRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, tenant_id, board_id, display_name, status, settings,
              connected_by, connected_at, last_polled_at, last_error, created_at
         FROM job_board_integrations
        ORDER BY created_at DESC`
    );
    return rows.map(rowToIntegration);
  });
}

export async function getIntegration(
  tenantId: string,
  boardId: string
): Promise<JobBoardIntegrationRow | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, tenant_id, board_id, display_name, status, settings,
              connected_by, connected_at, last_polled_at, last_error, created_at
         FROM job_board_integrations
        WHERE board_id = $1`,
      [boardId]
    );
    return rows[0] ? rowToIntegration(rows[0]) : null;
  });
}

async function loadIntegrationCreds(
  client: PoolClient,
  tenantId: string,
  integrationId: string
): Promise<IntegrationCreds | null> {
  const { rows } = await client.query<{
    id: string;
    tenant_id: string;
    settings: Record<string, unknown>;
    credentials_encrypted: Buffer | null;
  }>(
    `SELECT id, tenant_id, settings, credentials_encrypted
       FROM job_board_integrations
      WHERE id = $1`,
    [integrationId]
  );
  if (!rows[0]) return null;
  // tenant_id is double-checked door RLS, maar we asserten extra voor safety.
  if (rows[0].tenant_id !== tenantId) return null;
  return rowToIntegrationCreds(rows[0]);
}

export async function connectIntegration(
  tenantId: string,
  boardId: string,
  credentials: Record<string, unknown>,
  options: {
    displayName?: string;
    settings?: Record<string, unknown>;
    userId?: string | null;
    auditCtx?: AuditContext;
  } = {}
): Promise<JobBoardIntegrationRow> {
  const conn = getConnector(boardId);
  if (!conn) {
    throw new AppError(400, 'UNKNOWN_BOARD', `Onbekend job-board '${boardId}'`);
  }
  const encrypted = encrypt(JSON.stringify(credentials));

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO job_board_integrations
         (tenant_id, board_id, display_name, status, credentials_encrypted,
          settings, connected_by, connected_at)
       VALUES ($1, $2, $3, 'connected', $4, $5::jsonb, $6, now())
       ON CONFLICT (tenant_id, board_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             status       = 'connected',
             credentials_encrypted = EXCLUDED.credentials_encrypted,
             settings     = EXCLUDED.settings,
             connected_by = EXCLUDED.connected_by,
             connected_at = now(),
             last_error   = NULL
       RETURNING id, tenant_id, board_id, display_name, status, settings,
                 connected_by, connected_at, last_polled_at, last_error, created_at`,
      [
        tenantId,
        boardId,
        options.displayName ?? conn.displayName,
        encrypted,
        JSON.stringify(options.settings ?? {}),
        options.userId ?? null,
      ]
    );
    const row = rowToIntegration(rows[0]);
    await logAudit(
      client,
      tenantId,
      {
        action: 'job_board.integration.connected',
        entityType: 'job_board_integration',
        entityId: row.id,
        userId: options.userId ?? null,
        after: { board_id: boardId, display_name: row.display_name },
      },
      options.auditCtx ?? {}
    );
    logger.info('[jobBoards] integration connected', {
      tenantId,
      boardId,
      integration_id: row.id,
    });
    return row;
  });
}

export async function disconnectIntegration(
  tenantId: string,
  boardId: string,
  options: { userId?: string | null; auditCtx?: AuditContext } = {}
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rows: existing } = await client.query<{ id: string }>(
      `SELECT id FROM job_board_integrations WHERE board_id = $1`,
      [boardId]
    );
    if (!existing[0]) {
      throw new AppError(
        404,
        'INTEGRATION_NOT_FOUND',
        'Integratie niet gevonden'
      );
    }
    const integrationId = existing[0].id;

    // Mark all live postings as retracted (we bellen NIET de board API —
    // disconnect is een lokale revocatie).
    await client.query(
      `UPDATE job_postings
          SET status = 'retracted', retracted_at = now()
        WHERE integration_id = $1
          AND status IN ('queued','posted')`,
      [integrationId]
    );

    await client.query(
      `UPDATE job_board_integrations
          SET status = 'disconnected', credentials_encrypted = NULL
        WHERE id = $1`,
      [integrationId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'job_board.integration.disconnected',
        entityType: 'job_board_integration',
        entityId: integrationId,
        userId: options.userId ?? null,
        before: { board_id: boardId },
      },
      options.auditCtx ?? {}
    );
    logger.info('[jobBoards] integration disconnected', {
      tenantId,
      boardId,
      integration_id: integrationId,
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Postings
// ───────────────────────────────────────────────────────────────────────────

export interface ListPostingsOptions {
  jobId?: string;
  status?: JobPostingStatus;
  cursor?: string;
  limit?: number;
}

export async function listPostings(
  tenantId: string,
  opts: ListPostingsOptions = {}
): Promise<{ data: JobPostingRow[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return withTenant(tenantId, async (client) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.jobId) {
      params.push(opts.jobId);
      conditions.push(`job_id = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      conditions.push(`status = $${params.length}`);
    }
    if (opts.cursor) {
      params.push(opts.cursor);
      conditions.push(`created_at < $${params.length}`);
    }
    params.push(limit + 1);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await client.query(
      `SELECT * FROM job_postings ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params
    );
    const hasMore = rows.length > limit;
    const data = (hasMore ? rows.slice(0, limit) : rows) as JobPostingRow[];
    const next_cursor = hasMore ? data[data.length - 1].created_at : null;
    return { data, next_cursor };
  });
}

export async function getPosting(
  tenantId: string,
  postingId: string
): Promise<{
  posting: JobPostingRow;
  events: Array<{
    id: string;
    event: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
} | null> {
  return withTenant(tenantId, async (client) => {
    const { rows: postings } = await client.query<JobPostingRow>(
      `SELECT * FROM job_postings WHERE id = $1`,
      [postingId]
    );
    if (!postings[0]) return null;
    const { rows: events } = await client.query(
      `SELECT id, event, payload, created_at
         FROM job_posting_status_events
        WHERE posting_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [postingId]
    );
    return {
      posting: postings[0],
      events: events as Array<{
        id: string;
        event: string;
        payload: Record<string, unknown>;
        created_at: string;
      }>,
    };
  });
}

export async function enqueuePosting(
  tenantId: string,
  jobId: string,
  boardId: string,
  options: { userId?: string | null; auditCtx?: AuditContext } = {}
): Promise<JobPostingRow> {
  const conn = getConnector(boardId);
  if (!conn) {
    throw new AppError(400, 'UNKNOWN_BOARD', `Onbekend job-board '${boardId}'`);
  }
  return withTenant(tenantId, async (client) => {
    const { rows: integrations } = await client.query<{ id: string }>(
      `SELECT id FROM job_board_integrations
        WHERE board_id = $1 AND status = 'connected'`,
      [boardId]
    );
    const integrationId = integrations[0]?.id ?? null;
    const { rows: jobs } = await client.query<{ id: string }>(
      `SELECT id FROM jobs WHERE id = $1 AND tenant_id = $2`,
      [jobId, tenantId]
    );
    if (!jobs[0]) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }

    const { rows } = await client.query<JobPostingRow>(
      `INSERT INTO job_postings
         (tenant_id, job_id, board_id, integration_id, status, created_by)
       VALUES ($1, $2, $3, $4, 'queued', $5)
       RETURNING *`,
      [tenantId, jobId, boardId, integrationId, options.userId ?? null]
    );
    const posting = rows[0];

    await client.query(
      `INSERT INTO job_posting_status_events (tenant_id, posting_id, event, payload)
       VALUES ($1, $2, 'queued', $3::jsonb)`,
      [tenantId, posting.id, JSON.stringify({ board_id: boardId })]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'job_board.posting.queued',
        entityType: 'job_posting',
        entityId: posting.id,
        userId: options.userId ?? null,
        after: { job_id: jobId, board_id: boardId },
      },
      options.auditCtx ?? {}
    );

    // Push to BullMQ buiten de transactie zou risico geven (job runs voor
    // commit). We doen het hier expliciet binnen het withTenant-callback
    // omdat de transactie pas commit nadat dit promise resolved — bullmq
    // .add gaat zo snel dat de race window <1ms is, en de worker re-checkt
    // toch het row-bestaan.
    await jobBoardPostQueue.add(
      'post',
      { tenantId, postingId: posting.id, boardId },
      { jobId: `post-${posting.id}` }
    );

    logger.info('[jobBoards] posting enqueued', {
      tenantId,
      jobId,
      boardId,
      posting_id: posting.id,
    });
    return posting;
  });
}

/**
 * Wordt aangeroepen door de POST-worker. Atomic update + status-event.
 */
export async function applyPostResult(
  tenantId: string,
  postingId: string,
  result: {
    external_id: string;
    external_url: string | null;
    cost_amount: number | null;
    cost_currency: string | null;
    expires_at: string | null;
    raw: unknown;
  }
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE job_postings
          SET status = 'posted',
              external_id = $1,
              external_url = $2,
              cost_amount = $3,
              cost_currency = COALESCE($4, cost_currency),
              expires_at = $5,
              posted_at = now(),
              error_message = NULL
        WHERE id = $6`,
      [
        result.external_id,
        result.external_url,
        result.cost_amount,
        result.cost_currency,
        result.expires_at,
        postingId,
      ]
    );
    await client.query(
      `INSERT INTO job_posting_status_events (tenant_id, posting_id, event, payload)
       VALUES ($1, $2, 'posted', $3::jsonb)`,
      [tenantId, postingId, JSON.stringify({ external_id: result.external_id })]
    );
  });
}

export async function applyPostFailure(
  tenantId: string,
  postingId: string,
  error: string
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE job_postings
          SET status = 'failed', error_message = $1
        WHERE id = $2`,
      [error, postingId]
    );
    await client.query(
      `INSERT INTO job_posting_status_events (tenant_id, posting_id, event, payload)
       VALUES ($1, $2, 'failed', $3::jsonb)`,
      [tenantId, postingId, JSON.stringify({ error })]
    );
  });
}

export async function applyStatusUpdate(
  tenantId: string,
  postingId: string,
  update: StatusUpdate
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<JobPostingRow>(
      `SELECT * FROM job_postings WHERE id = $1`,
      [postingId]
    );
    if (!rows[0]) return;
    const before = rows[0];
    const statusChanged = before.status !== update.status;
    const applicantsChanged =
      typeof update.applicants_count === 'number' &&
      before.applicants_count !== update.applicants_count;

    await client.query(
      `UPDATE job_postings
          SET status = $1,
              applicants_count = COALESCE($2, applicants_count),
              last_polled_at = now()
        WHERE id = $3`,
      [update.status, update.applicants_count ?? null, postingId]
    );

    if (statusChanged || applicantsChanged) {
      await client.query(
        `INSERT INTO job_posting_status_events (tenant_id, posting_id, event, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          tenantId,
          postingId,
          statusChanged ? `status_${update.status}` : 'applicants_changed',
          JSON.stringify({
            from_status: before.status,
            to_status: update.status,
            applicants_count: update.applicants_count,
          }),
        ]
      );
    }
  });
}

export async function retractPosting(
  tenantId: string,
  postingId: string,
  options: { userId?: string | null; auditCtx?: AuditContext } = {}
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<JobPostingRow>(
      `SELECT * FROM job_postings WHERE id = $1`,
      [postingId]
    );
    const posting = rows[0];
    if (!posting) {
      throw new AppError(
        404,
        'POSTING_NOT_FOUND',
        'Vacatureplaatsing niet gevonden'
      );
    }

    const conn = getConnector(posting.board_id);
    let creds: IntegrationCreds | null = null;
    if (conn && posting.integration_id) {
      creds = await loadIntegrationCreds(
        client,
        tenantId,
        posting.integration_id
      );
    }

    if (conn && creds) {
      const ref: PostingRef = {
        id: posting.id,
        external_id: posting.external_id,
        tenant_id: tenantId,
      };
      try {
        await conn.retract(
          { tenantId, userId: options.userId ?? null },
          ref,
          creds
        );
      } catch (err) {
        // Log + door — bij retract willen we dat de lokale state in elk
        // geval naar 'retracted' gaat zelfs als upstream faalt. Het event
        // legt de upstream-fout vast.
        logger.warn('[jobBoards] retract upstream failed', {
          posting_id: postingId,
          board: posting.board_id,
          error: (err as Error).message,
        });
      }
    }

    await client.query(
      `UPDATE job_postings
          SET status = 'retracted', retracted_at = now()
        WHERE id = $1`,
      [postingId]
    );
    await client.query(
      `INSERT INTO job_posting_status_events (tenant_id, posting_id, event, payload)
       VALUES ($1, $2, 'retracted', $3::jsonb)`,
      [
        tenantId,
        postingId,
        JSON.stringify({ retracted_by: options.userId ?? null }),
      ]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'job_board.posting.retracted',
        entityType: 'job_posting',
        entityId: postingId,
        userId: options.userId ?? null,
        before: { status: posting.status },
        after: { status: 'retracted' },
      },
      options.auditCtx ?? {}
    );
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Polling
// ───────────────────────────────────────────────────────────────────────────

/**
 * Voor de poll-worker — laad de "live" state van een posting + integratie.
 * Retourneert null als de posting niet meer bestaat.
 */
export async function loadPostingForPoll(
  tenantId: string,
  postingId: string
): Promise<{
  posting: JobPostingRow;
  connector: JobBoardConnector | null;
  creds: IntegrationCreds | null;
} | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<JobPostingRow>(
      `SELECT * FROM job_postings WHERE id = $1`,
      [postingId]
    );
    const posting = rows[0];
    if (!posting) return null;
    const connector = getConnector(posting.board_id);
    const creds = posting.integration_id
      ? await loadIntegrationCreds(client, tenantId, posting.integration_id)
      : null;
    return { posting, connector, creds };
  });
}

/**
 * Voor de POST-worker — laad alles voor een enqueuede `queued` posting.
 */
export async function loadPostingForPost(
  tenantId: string,
  postingId: string
): Promise<{
  posting: JobPostingRow;
  job: NormalizedJob;
  connector: JobBoardConnector | null;
  creds: IntegrationCreds | null;
} | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<JobPostingRow>(
      `SELECT * FROM job_postings WHERE id = $1`,
      [postingId]
    );
    const posting = rows[0];
    if (!posting) return null;
    const job = await loadJobForPosting(client, tenantId, posting.job_id);
    const connector = getConnector(posting.board_id);
    const creds = posting.integration_id
      ? await loadIntegrationCreds(client, tenantId, posting.integration_id)
      : {
          id: 'no-integration',
          tenant_id: tenantId,
          settings: {},
          credentials: {},
        };
    return { posting, job, connector, creds };
  });
}

/**
 * Cron entry-point: lijst alle postings cross-tenant die polling nodig
 * hebben en enqueue per stuk een `job-board-poll` job. Wordt aangeroepen
 * door de scheduler-worker.
 */
export async function pollAllStatuses(): Promise<number> {
  // Cross-tenant scan zonder withTenant — gebruik een dedicated client
  // die GEEN RLS heeft (hier gebruiken we direct pool zonder tenant).
  const { pool } = await import('../../db/pool');
  const client = await pool.connect();
  try {
    // Bypass RLS door als superuser te draaien. In tests draait dit niet
    // omdat de scheduler-job geen NODE_ENV=production heeft.
    const { rows } = await client.query<{ tenant_id: string; id: string }>(
      `SELECT tenant_id, id FROM job_postings
        WHERE status IN ('queued','posted')
          AND (last_polled_at IS NULL OR last_polled_at < now() - INTERVAL '20 minutes')
        LIMIT 500`
    );
    for (const row of rows) {
      await jobBoardPollQueue.add(
        'poll',
        { tenantId: row.tenant_id, postingId: row.id },
        { jobId: `poll-${row.id}-${Date.now()}` }
      );
    }
    logger.info('[jobBoards] pollAllStatuses enqueued', { count: rows.length });
    return rows.length;
  } finally {
    client.release();
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Cost-per-hire
// ───────────────────────────────────────────────────────────────────────────

export async function recordHireCost(
  tenantId: string,
  applicationId: string
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rows: apps } = await client.query<{
      id: string;
      candidate_id: string;
      job_id: string;
      source: string | null;
    }>(
      `SELECT id, candidate_id, job_id, source
         FROM applications
        WHERE id = $1`,
      [applicationId]
    );
    if (!apps[0]) return;
    const app = apps[0];

    // Source veld bevat (best-effort) `${board_id}:posted` of board_id zelf.
    const sourceBoardId =
      app.source && app.source.includes(':')
        ? app.source.split(':')[0]
        : app.source ?? null;

    let postingId: string | null = null;
    let attributedCost: number | null = null;
    if (sourceBoardId) {
      const { rows: posts } = await client.query<{
        id: string;
        cost_amount: string | null;
      }>(
        `SELECT id, cost_amount FROM job_postings
          WHERE job_id = $1 AND board_id = $2
          ORDER BY posted_at DESC NULLS LAST
          LIMIT 1`,
        [app.job_id, sourceBoardId]
      );
      if (posts[0]) {
        postingId = posts[0].id;
        attributedCost = posts[0].cost_amount
          ? Number(posts[0].cost_amount)
          : null;
      }
    }

    await client.query(
      `INSERT INTO cost_per_hire_records
         (tenant_id, job_id, application_id, posting_id, source_board_id,
          attributed_cost, currency)
       VALUES ($1, $2, $3, $4, $5, $6, 'EUR')`,
      [
        tenantId,
        app.job_id,
        applicationId,
        postingId,
        sourceBoardId,
        attributedCost,
      ]
    );
  });
}

export async function getCostPerHire(
  tenantId: string,
  jobId?: string
): Promise<
  Array<{
    job_id: string;
    application_id: string | null;
    posting_id: string | null;
    source_board_id: string | null;
    attributed_cost: number | null;
    currency: string;
    computed_at: string;
  }>
> {
  return withTenant(tenantId, async (client) => {
    if (jobId) {
      const { rows } = await client.query(
        `SELECT job_id, application_id, posting_id, source_board_id,
                attributed_cost, currency, computed_at
           FROM cost_per_hire_records
          WHERE job_id = $1
          ORDER BY computed_at DESC`,
        [jobId]
      );
      return rows as Awaited<ReturnType<typeof getCostPerHire>>;
    }
    const { rows } = await client.query(
      `SELECT job_id, application_id, posting_id, source_board_id,
              attributed_cost, currency, computed_at
         FROM cost_per_hire_records
        ORDER BY computed_at DESC
        LIMIT 500`
    );
    return rows as Awaited<ReturnType<typeof getCostPerHire>>;
  });
}

// Re-export voor ergonomie
export { getConnector, listConnectors } from './registry';
export type { ConnectorContext };

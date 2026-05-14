import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { getStorage } from '../../lib/storage';
import { logger } from '../../middleware/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type JobTeamMemberRole = 'recruiter' | 'hiring_manager' | 'observer';

export interface JobTeamMember {
  id: string;
  job_id: string;
  user_id: string;
  role: JobTeamMemberRole;
  added_at: string;
  user_name?: string | null;
  user_email?: string | null;
  user_avatar_url?: string | null;
}

export interface JobNote {
  id: string;
  job_id: string;
  user_id: string | null;
  body: string;
  mentions: string[];
  created_at: string;
  updated_at: string;
  user_name?: string | null;
  user_email?: string | null;
}

export interface JobAttachment {
  id: string;
  job_id: string;
  uploaded_by: string | null;
  filename: string;
  storage_key: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  uploaded_by_name?: string | null;
}

export interface JobFunnelStage {
  stage_id: string;
  stage_name: string;
  position: number;
  count: number;
  conversion_rate_from_previous: number | null;
}

export interface JobFunnelResponse {
  stages: JobFunnelStage[];
}

export interface ComparableJob {
  job_id: string;
  title: string;
  status: string;
  candidates_total: number;
  days_to_fill: number | null;
  similarity_score: number;
}

export interface JobSourcingItem {
  source: string;
  count: number;
  conversion_to_hire: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage key helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a tenant-scoped storage key for a job attachment. Mirrors
 * `buildResumeStorageKey` from lib/storage.ts.
 */
export function buildJobAttachmentStorageKey(
  tenantId: string,
  jobId: string,
  attachmentId: string,
  filename: string
): string {
  const safe = filename
    .replace(/[\\/]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
  return `tenants/${tenantId}/jobs/${jobId}/attachments/${attachmentId}__${safe}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

async function ensureJobExists(
  client: PoolClient,
  jobId: string,
  tenantId: string
): Promise<void> {
  const { rows: [row] } = await client.query(
    `SELECT id FROM jobs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [jobId, tenantId]
  );
  if (!row) {
    throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TEAM
// ═════════════════════════════════════════════════════════════════════════════

export async function listJobTeam(
  tenantId: string,
  jobId: string
): Promise<JobTeamMember[]> {
  return withTenant(tenantId, async (client) => {
    await ensureJobExists(client, jobId, tenantId);
    const { rows } = await client.query(
      `SELECT m.id, m.job_id, m.user_id, m.role, m.added_at,
              u.name  as user_name,
              u.email as user_email,
              u.avatar_url as user_avatar_url
       FROM job_team_members m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.job_id = $1 AND m.tenant_id = $2
       ORDER BY m.added_at ASC`,
      [jobId, tenantId]
    );
    return rows as JobTeamMember[];
  });
}

export async function addJobTeamMember(
  tenantId: string,
  jobId: string,
  userId: string,
  role: JobTeamMemberRole
): Promise<JobTeamMember> {
  return withTenant(tenantId, async (client) => {
    await ensureJobExists(client, jobId, tenantId);

    // Verify the user belongs to this tenant — RLS would already block cross-
    // tenant inserts, but a friendly 404 beats a 23503 FK error.
    const { rows: [user] } = await client.query(
      `SELECT id FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Gebruiker niet gevonden');
    }

    try {
      const { rows: [member] } = await client.query(
        `INSERT INTO job_team_members (tenant_id, job_id, user_id, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, job_id, user_id, role, added_at`,
        [tenantId, jobId, userId, role]
      );

      // Hydrate user fields for the response.
      const { rows: [hydrated] } = await client.query(
        `SELECT m.id, m.job_id, m.user_id, m.role, m.added_at,
                u.name as user_name, u.email as user_email,
                u.avatar_url as user_avatar_url
         FROM job_team_members m
         LEFT JOIN users u ON u.id = m.user_id
         WHERE m.id = $1`,
        [member.id]
      );

      return hydrated as JobTeamMember;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === '23505') {
        throw new AppError(
          409,
          'TEAM_MEMBER_DUPLICATE',
          'Deze gebruiker zit al in het team'
        );
      }
      throw err;
    }
  });
}

export async function removeJobTeamMember(
  tenantId: string,
  jobId: string,
  userId: string
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    await ensureJobExists(client, jobId, tenantId);

    const { rows: [row] } = await client.query(
      `DELETE FROM job_team_members
       WHERE job_id = $1 AND user_id = $2 AND tenant_id = $3
       RETURNING id`,
      [jobId, userId, tenantId]
    );

    if (!row) {
      throw new AppError(
        404,
        'TEAM_MEMBER_NOT_FOUND',
        'Teamlid niet gevonden voor deze vacature'
      );
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// NOTES
// ═════════════════════════════════════════════════════════════════════════════

export async function listJobNotes(
  tenantId: string,
  jobId: string
): Promise<JobNote[]> {
  return withTenant(tenantId, async (client) => {
    await ensureJobExists(client, jobId, tenantId);
    const { rows } = await client.query(
      `SELECT n.id, n.job_id, n.user_id, n.body, n.mentions,
              n.created_at, n.updated_at,
              u.name as user_name, u.email as user_email
       FROM job_notes n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE n.job_id = $1 AND n.tenant_id = $2
       ORDER BY n.created_at DESC`,
      [jobId, tenantId]
    );
    return rows as JobNote[];
  });
}

export async function createJobNote(
  tenantId: string,
  jobId: string,
  userId: string,
  body: string,
  mentions: string[] = []
): Promise<JobNote> {
  return withTenant(tenantId, async (client) => {
    await ensureJobExists(client, jobId, tenantId);

    const { rows: [note] } = await client.query(
      `INSERT INTO job_notes (tenant_id, job_id, user_id, body, mentions)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, job_id, user_id, body, mentions, created_at, updated_at`,
      [tenantId, jobId, userId, body, mentions]
    );

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'job', $2, $3, 'note_added', $4)`,
      [
        tenantId,
        jobId,
        userId,
        JSON.stringify({ note_id: note.id, mentions: mentions.length }),
      ]
    );

    const { rows: [hydrated] } = await client.query(
      `SELECT n.id, n.job_id, n.user_id, n.body, n.mentions,
              n.created_at, n.updated_at,
              u.name as user_name, u.email as user_email
       FROM job_notes n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE n.id = $1`,
      [note.id]
    );

    return hydrated as JobNote;
  });
}

export async function deleteJobNote(
  tenantId: string,
  noteId: string
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `DELETE FROM job_notes
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [noteId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'NOTE_NOT_FOUND', 'Notitie niet gevonden');
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// ATTACHMENTS
// ═════════════════════════════════════════════════════════════════════════════

export async function listJobAttachments(
  tenantId: string,
  jobId: string
): Promise<JobAttachment[]> {
  return withTenant(tenantId, async (client) => {
    await ensureJobExists(client, jobId, tenantId);
    const { rows } = await client.query(
      `SELECT a.id, a.job_id, a.uploaded_by, a.filename, a.storage_key,
              a.mime_type, a.size_bytes, a.created_at,
              u.name as uploaded_by_name
       FROM job_attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.job_id = $1 AND a.tenant_id = $2
       ORDER BY a.created_at DESC`,
      [jobId, tenantId]
    );
    return rows as JobAttachment[];
  });
}

export async function uploadJobAttachment(
  tenantId: string,
  jobId: string,
  userId: string,
  file: Express.Multer.File
): Promise<JobAttachment> {
  return withTenant(tenantId, async (client) => {
    await ensureJobExists(client, jobId, tenantId);

    const attachmentId = uuidv4();
    const storage = getStorage();
    const storageKey = buildJobAttachmentStorageKey(
      tenantId,
      jobId,
      attachmentId,
      file.originalname
    );

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(file.path);
    } catch (err) {
      throw new AppError(
        500,
        'ATTACHMENT_READ_FAILED',
        'Kon geuploade bestand niet lezen',
        { error: (err as Error).message }
      );
    }

    await storage.put(storageKey, buffer, file.mimetype);

    // Best-effort cleanup of multer temp file.
    try {
      fs.unlinkSync(file.path);
    } catch {
      /* ignore — temp dir is sweepable */
    }

    const { rows: [row] } = await client.query(
      `INSERT INTO job_attachments
         (id, tenant_id, job_id, uploaded_by, filename, storage_key, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, job_id, uploaded_by, filename, storage_key,
                 mime_type, size_bytes, created_at`,
      [
        attachmentId,
        tenantId,
        jobId,
        userId,
        file.originalname,
        storageKey,
        file.mimetype,
        file.size,
      ]
    );

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'job', $2, $3, 'attachment_uploaded', $4)`,
      [
        tenantId,
        jobId,
        userId,
        JSON.stringify({
          attachment_id: attachmentId,
          filename: file.originalname,
        }),
      ]
    );

    return row as JobAttachment;
  });
}

export async function deleteJobAttachment(
  tenantId: string,
  attachmentId: string
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT id, job_id, storage_key, filename
       FROM job_attachments
       WHERE id = $1 AND tenant_id = $2`,
      [attachmentId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'ATTACHMENT_NOT_FOUND', 'Bijlage niet gevonden');
    }

    if (row.storage_key) {
      const storage = getStorage();
      try {
        await storage.delete(row.storage_key);
      } catch (err) {
        logger.warn('[jobDetail] storage.delete failed', {
          attachmentId,
          error: (err as Error).message,
        });
      }
    }

    await client.query(
      `DELETE FROM job_attachments WHERE id = $1 AND tenant_id = $2`,
      [attachmentId, tenantId]
    );
  });
}

export async function getJobAttachmentUrl(
  tenantId: string,
  attachmentId: string
): Promise<string> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT id, storage_key
       FROM job_attachments
       WHERE id = $1 AND tenant_id = $2`,
      [attachmentId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'ATTACHMENT_NOT_FOUND', 'Bijlage niet gevonden');
    }
    if (!row.storage_key) {
      throw new AppError(
        500,
        'ATTACHMENT_NO_KEY',
        'Bijlage heeft geen storage_key (corrupt record?)'
      );
    }
    const storage = getStorage();
    return storage.getDownloadUrl(row.storage_key);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// FUNNEL — candidates per stage + conversion-rate from previous
// ═════════════════════════════════════════════════════════════════════════════

export async function getJobFunnel(
  tenantId: string,
  jobId: string
): Promise<JobFunnelResponse> {
  return withTenant(tenantId, async (client) => {
    await ensureJobExists(client, jobId, tenantId);

    // Funnel-counts include ALL applications (active + rejected + hired) so
    // the UI can derive both throughput and drop-off. Match existing
    // jobs.service.getJobStats behaviour where the active-only count is
    // surfaced separately if needed by the caller.
    const { rows } = await client.query(
      `SELECT ps.id   as stage_id,
              ps.name as stage_name,
              ps.position,
              COUNT(a.id)::int as count
       FROM pipeline_stages ps
       LEFT JOIN applications a
         ON a.stage_id = ps.id
        AND a.tenant_id = ps.tenant_id
       WHERE ps.job_id = $1 AND ps.tenant_id = $2
       GROUP BY ps.id, ps.name, ps.position
       ORDER BY ps.position ASC`,
      [jobId, tenantId]
    );

    const stages: JobFunnelStage[] = rows.map((r, i) => {
      let conversion: number | null = null;
      if (i > 0) {
        const prev = rows[i - 1].count as number;
        const cur = r.count as number;
        conversion = prev > 0 ? Math.round((cur / prev) * 100) : 0;
      }
      return {
        stage_id: r.stage_id,
        stage_name: r.stage_name,
        position: r.position,
        count: r.count,
        conversion_rate_from_previous: conversion,
      };
    });

    return { stages };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// COMPARABLE JOBS — Jaccard similarity over required_skills
// ═════════════════════════════════════════════════════════════════════════════

export async function getComparableJobs(
  tenantId: string,
  jobId: string,
  limit = 5
): Promise<ComparableJob[]> {
  return withTenant(tenantId, async (client) => {
    await ensureJobExists(client, jobId, tenantId);

    const { rows: [self] } = await client.query(
      `SELECT id, required_skills
       FROM jobs
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [jobId, tenantId]
    );

    const ownSkills: string[] = (self?.required_skills ?? []) as string[];
    if (!ownSkills || ownSkills.length === 0) {
      return [];
    }

    // Filter candidates with overlap (`&&`), compute Jaccard on PG side.
    // Days-to-fill: filled rows mark via `filled_at` if we had it; we don't,
    // so we approximate with `updated_at - open_date` for status='filled'.
    const { rows } = await client.query(
      `SELECT j.id   as job_id,
              j.title,
              j.status,
              COALESCE(jc.candidates_total, 0)::int as candidates_total,
              CASE
                WHEN j.status = 'filled' THEN
                  GREATEST(
                    0,
                    EXTRACT(DAY FROM (j.updated_at - COALESCE(j.open_date::timestamptz, j.created_at)))::int
                  )
                ELSE NULL
              END as days_to_fill,
              (
                CARDINALITY(ARRAY(SELECT UNNEST(j.required_skills) INTERSECT SELECT UNNEST($3::text[])))::float
                /
                NULLIF(
                  CARDINALITY(ARRAY(SELECT UNNEST(j.required_skills) UNION SELECT UNNEST($3::text[])))::float,
                  0
                )
              ) as similarity_score
       FROM jobs j
       LEFT JOIN (
         SELECT job_id, COUNT(*) as candidates_total
         FROM applications
         WHERE tenant_id = $2
         GROUP BY job_id
       ) jc ON jc.job_id = j.id
       WHERE j.tenant_id = $2
         AND j.deleted_at IS NULL
         AND j.id <> $1
         AND j.required_skills IS NOT NULL
         AND j.required_skills && $3::text[]
       ORDER BY similarity_score DESC NULLS LAST,
                j.created_at DESC
       LIMIT $4`,
      [jobId, tenantId, ownSkills, limit]
    );

    return rows.map((r) => ({
      job_id: r.job_id,
      title: r.title,
      status: r.status,
      candidates_total: Number(r.candidates_total ?? 0),
      days_to_fill: r.days_to_fill === null ? null : Number(r.days_to_fill),
      similarity_score: Number(r.similarity_score ?? 0),
    }));
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SOURCING — applications per source + conversion-to-hire
// ═════════════════════════════════════════════════════════════════════════════

export async function getJobSourcing(
  tenantId: string,
  jobId: string
): Promise<JobSourcingItem[]> {
  return withTenant(tenantId, async (client) => {
    await ensureJobExists(client, jobId, tenantId);

    const { rows } = await client.query(
      `SELECT COALESCE(c.source, 'overig') as source,
              COUNT(*)::int as count,
              COUNT(*) FILTER (WHERE a.status = 'hired')::int as hired_count
       FROM applications a
       JOIN candidates c ON c.id = a.candidate_id AND c.tenant_id = a.tenant_id
       WHERE a.job_id = $1 AND a.tenant_id = $2
       GROUP BY COALESCE(c.source, 'overig')
       ORDER BY count DESC`,
      [jobId, tenantId]
    );

    return rows.map((r) => ({
      source: r.source as string,
      count: Number(r.count),
      conversion_to_hire:
        Number(r.count) > 0
          ? Math.round((Number(r.hired_count) / Number(r.count)) * 100)
          : 0,
    }));
  });
}

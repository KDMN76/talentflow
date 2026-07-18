/**
 * Interviews — scheduling + lifecycle voor de AI Interview Suite (Sprint Q3.4).
 *
 * Vier flows:
 *   - scheduleInterview      → INSERT + participants + reminders + workflow event
 *   - rescheduleInterview    → UPDATE start/end + status='rescheduled' → 'scheduled'
 *   - cancelInterview        → status='cancelled' + reason
 *   - markAttendance         → log attendance per participant
 *
 * Conflict-detection bij scheduleInterview: voor elke interviewer/observer
 * checken we of hun eigen scheduled-interviews overlappen met het nieuwe
 * tijdsvenster. Bij een hit gooit de service `INTERVIEWER_CONFLICT` met de
 * interviewer-id in details, zodat de UI een gerichte foutmelding toont.
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { emitWorkflowEvent } from '../workflows/workflowEmitter';
import { interviewRemindersQueue } from '../../queue/queues';
import { logger } from '../../middleware/errorHandler';
import type { PoolClient } from 'pg';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type InterviewStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled';

export type MeetingProvider =
  | 'google_meet'
  | 'teams'
  | 'zoom'
  | 'in_person'
  | 'phone';

export type ParticipantType = 'candidate' | 'interviewer' | 'observer';

export interface InterviewParticipant {
  id: string;
  tenant_id: string;
  interview_id: string;
  participant_type: ParticipantType;
  user_id: string | null;
  candidate_id: string | null;
  email: string;
  attended: boolean | null;
  attendance_logged_at: string | null;
}

export interface Interview {
  id: string;
  tenant_id: string;
  application_id: string;
  stage_id: string | null;
  scheduled_start: string;
  scheduled_end: string;
  duration_minutes: number;
  meeting_url: string | null;
  meeting_provider: MeetingProvider | null;
  location: string | null;
  interview_kit_id: string | null;
  notes: string | null;
  status: InterviewStatus;
  created_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface InterviewWithParticipants extends Interview {
  participants: InterviewParticipant[];
  kit?: { id: string; name: string } | null;
}

export interface ScheduleInterviewInput {
  application_id: string;
  scheduled_start: string;
  scheduled_end: string;
  interviewer_user_ids: string[];
  observer_user_ids?: string[];
  meeting_provider?: MeetingProvider;
  location?: string;
  meeting_url?: string;
  interview_kit_id?: string;
  notes?: string;
  stage_id?: string | null;
}

export interface ListInterviewsFilters {
  from?: Date;
  to?: Date;
  candidate_id?: string;
  interviewer_id?: string;
  status?: InterviewStatus;
}

// ────────────────────────────────────────────────────────────────────────────
// Schedule
// ────────────────────────────────────────────────────────────────────────────

export async function scheduleInterview(
  tenantId: string,
  userId: string,
  input: ScheduleInterviewInput,
  ctx: AuditContext = {}
): Promise<Interview> {
  // Front-loaded validatie zodat we vroeg duidelijke errors gooien.
  if (!input.interviewer_user_ids || input.interviewer_user_ids.length === 0) {
    throw new AppError(400, 'NO_INTERVIEWERS', 'Minimaal 1 interviewer vereist');
  }
  const startMs = Date.parse(input.scheduled_start);
  const endMs = Date.parse(input.scheduled_end);
  if (isNaN(startMs) || isNaN(endMs)) {
    throw new AppError(400, 'INVALID_TIME', 'scheduled_start/end ongeldig');
  }
  if (endMs <= startMs) {
    throw new AppError(400, 'INVALID_TIME_RANGE', 'end moet na start liggen');
  }

  const interview = await withTenant(tenantId, async (client) => {
    // 1. Check applicatie + haal kandidaat op (voor participant-rij).
    const { rows: appRows } = await client.query(
      `SELECT a.id, a.candidate_id, c.email AS candidate_email, c.first_name, c.last_name
       FROM applications a
       LEFT JOIN candidates c ON c.id = a.candidate_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [input.application_id, tenantId]
    );
    if (appRows.length === 0) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Sollicitatie niet gevonden');
    }
    const app = appRows[0] as {
      id: string;
      candidate_id: string;
      candidate_email: string | null;
    };

    // 2. Conflict-detect per interviewer + observer.
    const allUserIds = [
      ...input.interviewer_user_ids,
      ...(input.observer_user_ids ?? []),
    ];
    await assertNoConflicts(client, tenantId, allUserIds, startMs, endMs, null);

    // 3. Insert interview.
    const { rows: ivRows } = await client.query(
      `INSERT INTO interviews
         (tenant_id, application_id, stage_id, scheduled_start, scheduled_end,
          meeting_provider, meeting_url, location, interview_kit_id, notes,
          status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled', $11)
       RETURNING *`,
      [
        tenantId,
        input.application_id,
        input.stage_id ?? null,
        new Date(startMs),
        new Date(endMs),
        input.meeting_provider ?? null,
        input.meeting_url ?? null,
        input.location ?? null,
        input.interview_kit_id ?? null,
        input.notes ?? null,
        userId,
      ]
    );
    const iv = ivRows[0] as Interview;

    // 4. Insert participants — kandidaat + interviewers + observers.
    if (app.candidate_email) {
      await client.query(
        `INSERT INTO interview_participants
           (tenant_id, interview_id, participant_type, candidate_id, email)
         VALUES ($1, $2, 'candidate', $3, $4)`,
        [tenantId, iv.id, app.candidate_id, app.candidate_email]
      );
    }
    for (const uid of input.interviewer_user_ids) {
      const email = await fetchUserEmail(client, tenantId, uid);
      await client.query(
        `INSERT INTO interview_participants
           (tenant_id, interview_id, participant_type, user_id, email)
         VALUES ($1, $2, 'interviewer', $3, $4)`,
        [tenantId, iv.id, uid, email]
      );
    }
    for (const uid of input.observer_user_ids ?? []) {
      const email = await fetchUserEmail(client, tenantId, uid);
      await client.query(
        `INSERT INTO interview_participants
           (tenant_id, interview_id, participant_type, user_id, email)
         VALUES ($1, $2, 'observer', $3, $4)`,
        [tenantId, iv.id, uid, email]
      );
    }

    // 5. Audit.
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.INTERVIEW_SCHEDULED,
        entityType: 'interview',
        entityId: iv.id,
        after: {
          application_id: iv.application_id,
          start: iv.scheduled_start,
          end: iv.scheduled_end,
          interviewers: input.interviewer_user_ids,
        },
        userId,
      },
      ctx
    );

    return iv;
  });

  // Post-commit: workflow event + reminder-jobs. Bewust BUITEN de transactie:
  // we willen niet dat de DB-writes rollen wanneer Redis even niet bereikbaar
  // is, en de worker mag pas draaien nadat de interview persisted is.
  await emitWorkflowEvent(tenantId, 'interview.scheduled', interview.id, {
    application_id: interview.application_id,
    scheduled_start: interview.scheduled_start,
    scheduled_end: interview.scheduled_end,
  });
  await enqueueReminderJobs(tenantId, interview).catch((err) => {
    logger.warn('[interviews] failed to enqueue reminder jobs', {
      interviewId: interview.id,
      error: (err as Error).message,
    });
  });

  return interview;
}

// ────────────────────────────────────────────────────────────────────────────
// List + get
// ────────────────────────────────────────────────────────────────────────────

export async function listInterviews(
  tenantId: string,
  filters: ListInterviewsFilters = {}
): Promise<Interview[]> {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId];
    const where: string[] = ['i.tenant_id = $1'];
    if (filters.from) {
      params.push(filters.from);
      where.push(`i.scheduled_end >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`i.scheduled_start <= $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`i.status = $${params.length}`);
    }

    if (filters.interviewer_id) {
      params.push(filters.interviewer_id);
      where.push(
        `EXISTS (SELECT 1 FROM interview_participants p
                 WHERE p.interview_id = i.id
                   AND p.user_id = $${params.length}
                   AND p.participant_type IN ('interviewer','observer'))`
      );
    }

    if (filters.candidate_id) {
      params.push(filters.candidate_id);
      where.push(
        `EXISTS (SELECT 1 FROM interview_participants p
                 WHERE p.interview_id = i.id
                   AND p.candidate_id = $${params.length})`
      );
    }

    const { rows } = await client.query(
      `SELECT i.*,
              COALESCE(i.meeting_provider, CASE WHEN i.location IS NOT NULL THEN 'in_person' END) AS location_type,
              c.name AS candidate_name,
              j.title AS job_title
       FROM interviews i
       LEFT JOIN applications a ON a.id = i.application_id AND a.tenant_id = i.tenant_id
       LEFT JOIN candidates c ON c.id = a.candidate_id AND c.tenant_id = i.tenant_id
       LEFT JOIN jobs j ON j.id = a.job_id AND j.tenant_id = i.tenant_id
       WHERE ${where.join(' AND ')}
       ORDER BY i.scheduled_start ASC
       LIMIT 500`,
      params
    );
    return rows as Interview[];
  });
}

export async function getInterview(
  tenantId: string,
  id: string
): Promise<InterviewWithParticipants> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT i.*,
              COALESCE(i.meeting_provider, CASE WHEN i.location IS NOT NULL THEN 'in_person' END) AS location_type,
              c.name AS candidate_name,
              j.title AS job_title
       FROM interviews i
       LEFT JOIN applications a ON a.id = i.application_id AND a.tenant_id = i.tenant_id
       LEFT JOIN candidates c ON c.id = a.candidate_id AND c.tenant_id = i.tenant_id
       LEFT JOIN jobs j ON j.id = a.job_id AND j.tenant_id = i.tenant_id
       WHERE i.id = $1 AND i.tenant_id = $2`,
      [id, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview niet gevonden');
    }
    const iv = rows[0] as Interview;

    const { rows: parts } = await client.query(
      `SELECT * FROM interview_participants
       WHERE interview_id = $1 AND tenant_id = $2
       ORDER BY participant_type, email`,
      [id, tenantId]
    );

    let kit: { id: string; name: string } | null = null;
    if (iv.interview_kit_id) {
      const { rows: kRows } = await client.query(
        `SELECT id, name FROM interview_kits
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [iv.interview_kit_id, tenantId]
      );
      kit = kRows[0] ? { id: kRows[0].id, name: kRows[0].name } : null;
    }

    return { ...iv, participants: parts as InterviewParticipant[], kit };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Cancel + reschedule + attendance
// ────────────────────────────────────────────────────────────────────────────

export async function cancelInterview(
  tenantId: string,
  id: string,
  reason: string,
  userId?: string,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `UPDATE interviews
       SET status = 'cancelled',
           cancelled_at = now(),
           cancellation_reason = $3,
           updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status NOT IN ('cancelled', 'completed')
       RETURNING *`,
      [id, tenantId, reason]
    );
    if (rows.length === 0) {
      throw new AppError(
        404,
        'INTERVIEW_NOT_FOUND_OR_FINAL',
        'Interview niet gevonden of al afgesloten'
      );
    }
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.INTERVIEW_CANCELLED,
        entityType: 'interview',
        entityId: id,
        after: { reason },
        userId: userId ?? null,
      },
      ctx
    );
  });
}

export async function rescheduleInterview(
  tenantId: string,
  id: string,
  newStart: string,
  newEnd: string,
  userId?: string,
  ctx: AuditContext = {}
): Promise<Interview> {
  const startMs = Date.parse(newStart);
  const endMs = Date.parse(newEnd);
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
    throw new AppError(400, 'INVALID_TIME_RANGE', 'newStart/newEnd ongeldig');
  }

  const updated = await withTenant(tenantId, async (client) => {
    const { rows: existing } = await client.query(
      `SELECT * FROM interviews WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (existing.length === 0) {
      throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview niet gevonden');
    }
    const before = existing[0] as Interview;

    // Verzamel huidige interviewers/observers voor conflict-check tegen het
    // nieuwe venster (excludeert dit eigen interview-id).
    const { rows: parts } = await client.query(
      `SELECT user_id FROM interview_participants
       WHERE interview_id = $1 AND tenant_id = $2
         AND participant_type IN ('interviewer', 'observer')
         AND user_id IS NOT NULL`,
      [id, tenantId]
    );
    const userIds = parts.map((p: { user_id: string }) => p.user_id);
    await assertNoConflicts(client, tenantId, userIds, startMs, endMs, id);

    const { rows } = await client.query(
      `UPDATE interviews
       SET scheduled_start = $3,
           scheduled_end = $4,
           status = 'scheduled',
           updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [id, tenantId, new Date(startMs), new Date(endMs)]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.INTERVIEW_RESCHEDULED,
        entityType: 'interview',
        entityId: id,
        before: { start: before.scheduled_start, end: before.scheduled_end },
        after: { start: rows[0].scheduled_start, end: rows[0].scheduled_end },
        userId: userId ?? null,
      },
      ctx
    );
    return rows[0] as Interview;
  });

  await enqueueReminderJobs(tenantId, updated).catch((err) => {
    logger.warn('[interviews] reschedule reminder enqueue failed', {
      interviewId: updated.id,
      error: (err as Error).message,
    });
  });

  return updated;
}

export async function markAttendance(
  tenantId: string,
  interviewId: string,
  participantId: string,
  attended: boolean,
  userId?: string,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `UPDATE interview_participants
       SET attended = $4, attendance_logged_at = now()
       WHERE id = $1 AND interview_id = $2 AND tenant_id = $3
       RETURNING *`,
      [participantId, interviewId, tenantId, attended]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'PARTICIPANT_NOT_FOUND', 'Participant niet gevonden');
    }
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.INTERVIEW_ATTENDANCE_LOGGED,
        entityType: 'interview_participant',
        entityId: participantId,
        after: { attended },
        userId: userId ?? null,
      },
      ctx
    );
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

async function assertNoConflicts(
  client: PoolClient,
  tenantId: string,
  userIds: string[],
  startMs: number,
  endMs: number,
  excludeInterviewId: string | null
): Promise<void> {
  if (userIds.length === 0) return;
  const params: unknown[] = [tenantId, new Date(startMs), new Date(endMs), userIds];
  let exclude = '';
  if (excludeInterviewId) {
    params.push(excludeInterviewId);
    exclude = ` AND i.id <> $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT DISTINCT p.user_id
     FROM interviews i
     JOIN interview_participants p ON p.interview_id = i.id
     WHERE i.tenant_id = $1
       AND i.status = 'scheduled'
       AND i.scheduled_end > $2
       AND i.scheduled_start < $3
       AND p.user_id = ANY($4::uuid[])
       AND p.participant_type IN ('interviewer', 'observer')
       ${exclude}`,
    params
  );
  if (rows.length > 0) {
    const conflictingIds = rows.map((r: { user_id: string }) => r.user_id);
    throw new AppError(
      409,
      'INTERVIEWER_CONFLICT',
      'Eén of meer interviewers hebben al een afspraak in dit venster',
      { interviewer_ids: conflictingIds }
    );
  }
}

async function fetchUserEmail(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<string> {
  const { rows } = await client.query(
    `SELECT email FROM users WHERE id = $1 AND tenant_id = $2`,
    [userId, tenantId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'USER_NOT_FOUND', `Gebruiker ${userId} niet gevonden`);
  }
  return rows[0].email as string;
}

async function enqueueReminderJobs(
  tenantId: string,
  interview: Interview
): Promise<void> {
  const startMs = new Date(interview.scheduled_start).getTime();
  const now = Date.now();
  const minutes24 = 24 * 60 * 60 * 1000;
  const minutes1 = 60 * 60 * 1000;

  const jobs: Array<{ kind: '24h' | '1h'; delay: number }> = [
    { kind: '24h', delay: startMs - minutes24 - now },
    { kind: '1h', delay: startMs - minutes1 - now },
  ];
  for (const j of jobs) {
    const jobId = `interview-${interview.id}-${j.kind}`;

    // The jobId is static per interview+kind, so BullMQ's add() is a silent
    // no-op if a job with that id is still pending (e.g. delayed) — this is
    // what makes reschedule silently keep firing the OLD reminder time.
    // Always remove any previously-queued job for this id first so re-adding
    // below actually applies the new delay. No-op on first schedule (there's
    // nothing to remove yet).
    const existing = await interviewRemindersQueue.getJob(jobId);
    if (existing) {
      await existing.remove();
    }

    if (j.delay <= 0) continue; // te laat voor deze reminder, skip
    await interviewRemindersQueue.add(
      'send-interview-reminder',
      {
        tenantId,
        interviewId: interview.id,
        kind: j.kind,
      },
      { delay: j.delay, jobId }
    );
  }
}

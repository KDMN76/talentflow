/**
 * Interview calendar-sync service — Sprint Q3.4 (Agent CCC).
 *
 * 2-way sync tussen TalentFlow's `interviews`-rij en de Google/Outlook
 * Calendar van iedere uitgenodigde interviewer:
 *
 *   - Outgoing: bij `scheduleInterview` / reschedule / cancel maken / muteren
 *     we events in iedere interviewer's eigen kalender via hun gekoppelde
 *     `mailbox_integrations` (we hergebruiken hetzelfde access_token na
 *     auto-refresh).
 *   - Incoming: een polling worker (cron, default elke 10 min) loopt over de
 *     `interview_calendar_events`-rijen, vraagt per event de huidige status
 *     op bij de provider, en update de status of cancellt het interview als
 *     het remote event verdwenen is.
 *
 * Webhooks (Google `events.watch`, Outlook subscriptions) zijn de "premium"
 * implementatie — vereisen publiek bereikbare HTTPS-callbacks. Voor MVP
 * pollen we; webhooks landen in een vervolgsprint zodra we stable HTTPS in
 * dev hebben.
 */

import { withTenant, withoutTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import {
  getCalendarProvider,
  calendarProviderFromMailProvider,
  type CalendarProviderName,
} from '../../lib/providers/calendar';
import {
  getIntegrationFull,
  refreshTokenIfExpired,
  invalidateIntegration,
} from '../integrations/mailbox.service';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface InterviewCalendarEvent {
  id: string;
  tenant_id: string;
  interview_id: string;
  user_id: string;
  mailbox_integration_id: string | null;
  provider: CalendarProviderName;
  external_event_id: string;
  external_calendar_id: string | null;
  last_synced_at: string;
  status: 'synced' | 'out_of_sync' | 'deleted';
  created_at: string;
}

interface InterviewBundle {
  interview_id: string;
  application_id: string;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  meeting_url: string | null;
  location: string | null;
  job_title: string | null;
  candidate_name: string | null;
  candidate_email: string | null;
}

interface InterviewerWithIntegration {
  user_id: string;
  email: string;
  integration_id: string;
  provider: 'gmail' | 'outlook';
}

// ────────────────────────────────────────────────────────────────────────────
// Loaders
// ────────────────────────────────────────────────────────────────────────────

async function loadInterviewBundle(
  tenantId: string,
  interviewId: string
): Promise<InterviewBundle> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<InterviewBundle>(
      `SELECT
         i.id            AS interview_id,
         i.application_id,
         i.scheduled_start::text,
         i.scheduled_end::text,
         i.status,
         i.meeting_url,
         i.location,
         j.title         AS job_title,
         COALESCE(
           NULLIF(TRIM(CONCAT(c.first_name, ' ', c.last_name)), ''),
           c.name
         )               AS candidate_name,
         c.email         AS candidate_email
       FROM interviews i
       LEFT JOIN applications a ON a.id = i.application_id AND a.tenant_id = i.tenant_id
       LEFT JOIN jobs j         ON j.id = a.job_id           AND j.tenant_id = i.tenant_id
       LEFT JOIN candidates c   ON c.id = a.candidate_id     AND c.tenant_id = i.tenant_id
       WHERE i.id = $1 AND i.tenant_id = $2`,
      [interviewId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview niet gevonden');
    }
    return rows[0]!;
  });
}

/**
 * Vind alle interviewers voor een interview die een active mailbox-integratie
 * hebben (waarvan we de calendar-token kunnen gebruiken).
 *
 * Beperkt tot participant_type='interviewer' — observers en kandidaat krijgen
 * geen kalenderitem aangemaakt namens hen (zij kunnen wel als attendee in het
 * event verschijnen, maar de event-eigenaar is de interviewer).
 */
async function loadInterviewersWithIntegration(
  tenantId: string,
  interviewId: string,
  filterUserId?: string
): Promise<InterviewerWithIntegration[]> {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId, interviewId];
    let userClause = '';
    if (filterUserId) {
      params.push(filterUserId);
      userClause = `AND ip.user_id = $${params.length}`;
    }
    const { rows } = await client.query<InterviewerWithIntegration>(
      `SELECT DISTINCT ON (ip.user_id, mi.provider)
              ip.user_id, ip.email,
              mi.id       AS integration_id,
              mi.provider AS provider
       FROM interview_participants ip
       JOIN mailbox_integrations mi
         ON mi.user_id = ip.user_id
        AND mi.tenant_id = ip.tenant_id
        AND mi.active = TRUE
       WHERE ip.tenant_id = $1
         AND ip.interview_id = $2
         AND ip.participant_type = 'interviewer'
         AND ip.user_id IS NOT NULL
         ${userClause}
       ORDER BY ip.user_id, mi.provider, mi.created_at DESC`,
      params
    );
    return rows;
  });
}

async function loadParticipantEmails(
  tenantId: string,
  interviewId: string
): Promise<string[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ email: string }>(
      `SELECT email
       FROM interview_participants
       WHERE tenant_id = $1 AND interview_id = $2 AND email IS NOT NULL`,
      [tenantId, interviewId]
    );
    return rows.map((r) => r.email).filter(Boolean);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Event-builder
// ────────────────────────────────────────────────────────────────────────────

function buildEventParams(
  bundle: InterviewBundle,
  attendeeEmails: string[]
): {
  summary: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string | undefined;
  attendees: Array<{ email: string }>;
} {
  const summary = bundle.candidate_name && bundle.job_title
    ? `Sollicitatie: ${bundle.candidate_name} — ${bundle.job_title}`
    : bundle.job_title
      ? `Sollicitatiegesprek: ${bundle.job_title}`
      : 'Sollicitatiegesprek';

  const descLines: string[] = [];
  if (bundle.candidate_name) descLines.push(`Kandidaat: ${bundle.candidate_name}`);
  if (bundle.job_title) descLines.push(`Vacature: ${bundle.job_title}`);
  if (bundle.meeting_url) descLines.push(`\nLink: ${bundle.meeting_url}`);
  descLines.push('\nGepland via TalentFlow.');

  const uniqueAttendees = Array.from(new Set(attendeeEmails)).filter(Boolean);

  return {
    summary,
    description: descLines.join('\n'),
    startsAt: bundle.scheduled_start,
    endsAt: bundle.scheduled_end,
    location: bundle.meeting_url ?? bundle.location ?? undefined,
    attendees: uniqueAttendees.map((email) => ({ email })),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Maak voor elke interviewer met mailbox-integratie een calendar-event aan.
 * Idempotent: bestaande rijen (UNIQUE op interview_id + user_id + provider)
 * worden overgeslagen — gebruik `updateCalendarEventForInterview` om te
 * muteren.
 */
export async function createCalendarEventForInterview(
  tenantId: string,
  interviewId: string,
  ctx: AuditContext = {}
): Promise<{ events: InterviewCalendarEvent[] }> {
  const bundle = await loadInterviewBundle(tenantId, interviewId);
  const interviewers = await loadInterviewersWithIntegration(
    tenantId,
    interviewId
  );
  if (interviewers.length === 0) {
    logger.info(
      '[calendarSync] geen interviewers met integratie — niets te syncen',
      { interviewId }
    );
    return { events: [] };
  }
  const attendees = await loadParticipantEmails(tenantId, interviewId);
  const params = buildEventParams(bundle, attendees);

  const created: InterviewCalendarEvent[] = [];

  for (const iv of interviewers) {
    const calendarProviderName = calendarProviderFromMailProvider(iv.provider);
    try {
      const integration = await getIntegrationFull(tenantId, iv.integration_id);
      if (!integration.active) {
        logger.warn('[calendarSync] integratie inactief — skip', {
          integrationId: iv.integration_id,
        });
        continue;
      }
      const refreshed = await refreshTokenIfExpired(integration);
      const cal = getCalendarProvider(calendarProviderName);
      const result = await cal.createEvent(refreshed.access_token, params);

      const row = await withTenant(tenantId, async (client) => {
        const { rows } = await client.query<InterviewCalendarEvent>(
          `INSERT INTO interview_calendar_events
             (tenant_id, interview_id, user_id, mailbox_integration_id,
              provider, external_event_id, external_calendar_id,
              last_synced_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now(), 'synced')
           ON CONFLICT (interview_id, user_id, provider)
           DO UPDATE SET
             external_event_id    = EXCLUDED.external_event_id,
             external_calendar_id = EXCLUDED.external_calendar_id,
             last_synced_at       = now(),
             status               = 'synced'
           RETURNING *`,
          [
            tenantId,
            interviewId,
            iv.user_id,
            iv.integration_id,
            calendarProviderName,
            result.eventId,
            result.calendarId,
          ]
        );
        await logAudit(
          client,
          tenantId,
          {
            action: 'interview_calendar_event.created',
            entityType: 'interview_calendar_event',
            entityId: rows[0]!.id,
            after: {
              interview_id: interviewId,
              provider: calendarProviderName,
              external_event_id: result.eventId,
            },
          },
          ctx
        );
        return rows[0]!;
      });
      created.push(row);
    } catch (err) {
      const status = (err as { code?: number; statusCode?: number; status?: number }).statusCode
        ?? (err as { code?: number; statusCode?: number; status?: number }).code
        ?? (err as { code?: number; statusCode?: number; status?: number }).status;
      if (status === 401 || status === 403) {
        await invalidateIntegration(
          tenantId,
          iv.integration_id,
          `Calendar create rejected: ${(err as Error).message}`
        );
      }
      logger.error('[calendarSync] createEvent failed', {
        interviewId,
        userId: iv.user_id,
        provider: calendarProviderName,
        error: (err as Error).message,
      });
    }
  }

  return { events: created };
}

/**
 * Update het calendar-event voor een interview (bij reschedule).
 */
export async function updateCalendarEventForInterview(
  tenantId: string,
  interviewId: string,
  ctx: AuditContext = {}
): Promise<{ updated: number }> {
  const bundle = await loadInterviewBundle(tenantId, interviewId);
  const attendees = await loadParticipantEmails(tenantId, interviewId);
  const params = buildEventParams(bundle, attendees);

  const links = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<InterviewCalendarEvent>(
      `SELECT *
       FROM interview_calendar_events
       WHERE tenant_id = $1 AND interview_id = $2 AND status != 'deleted'`,
      [tenantId, interviewId]
    );
    return rows;
  });

  let updated = 0;
  for (const link of links) {
    if (!link.mailbox_integration_id) continue;
    try {
      const integration = await getIntegrationFull(
        tenantId,
        link.mailbox_integration_id
      );
      if (!integration.active) continue;
      const refreshed = await refreshTokenIfExpired(integration);
      const cal = getCalendarProvider(link.provider);
      await cal.updateEvent(
        refreshed.access_token,
        { ...params, eventId: link.external_event_id },
        link.external_calendar_id ?? undefined
      );
      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE interview_calendar_events
           SET last_synced_at = now(), status = 'synced'
           WHERE id = $1 AND tenant_id = $2`,
          [link.id, tenantId]
        );
        await logAudit(
          client,
          tenantId,
          {
            action: 'interview_calendar_event.updated',
            entityType: 'interview_calendar_event',
            entityId: link.id,
            after: {
              interview_id: interviewId,
              provider: link.provider,
              external_event_id: link.external_event_id,
            },
          },
          ctx
        );
      });
      updated++;
    } catch (err) {
      logger.error('[calendarSync] updateEvent failed', {
        interviewId,
        linkId: link.id,
        error: (err as Error).message,
      });
    }
  }
  return { updated };
}

/**
 * Verwijder de calendar-events voor een interview (bij cancel).
 *
 * We markeren rijen als status='deleted' i.p.v. ze fysiek te verwijderen
 * zodat we audit-trail behouden.
 */
export async function deleteCalendarEventForInterview(
  tenantId: string,
  interviewId: string,
  ctx: AuditContext = {}
): Promise<{ deleted: number }> {
  const links = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<InterviewCalendarEvent>(
      `SELECT *
       FROM interview_calendar_events
       WHERE tenant_id = $1 AND interview_id = $2 AND status != 'deleted'`,
      [tenantId, interviewId]
    );
    return rows;
  });

  let deleted = 0;
  for (const link of links) {
    if (!link.mailbox_integration_id) continue;
    try {
      const integration = await getIntegrationFull(
        tenantId,
        link.mailbox_integration_id
      );
      if (integration.active) {
        const refreshed = await refreshTokenIfExpired(integration);
        const cal = getCalendarProvider(link.provider);
        await cal.deleteEvent(
          refreshed.access_token,
          link.external_event_id,
          link.external_calendar_id ?? undefined
        );
      }
      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE interview_calendar_events
           SET status = 'deleted', last_synced_at = now()
           WHERE id = $1 AND tenant_id = $2`,
          [link.id, tenantId]
        );
        await logAudit(
          client,
          tenantId,
          {
            action: 'interview_calendar_event.deleted',
            entityType: 'interview_calendar_event',
            entityId: link.id,
            before: {
              interview_id: interviewId,
              provider: link.provider,
              external_event_id: link.external_event_id,
            },
          },
          ctx
        );
      });
      deleted++;
    } catch (err) {
      logger.error('[calendarSync] deleteEvent failed', {
        interviewId,
        linkId: link.id,
        error: (err as Error).message,
      });
    }
  }
  return { deleted };
}

// ────────────────────────────────────────────────────────────────────────────
// Polling worker entrypoint — incoming changes
// ────────────────────────────────────────────────────────────────────────────

/**
 * Voor elke active calendar-event-link binnen `tenantId` (of voor één
 * specifieke integratie wanneer `integrationId` gegeven is): vraag de
 * huidige event-status op bij de provider en update / cancel het lokale
 * interview indien nodig.
 *
 * Uitgevoerd door de `interview-calendar-sync` BullMQ-cron (default elke
 * 10 min, configureerbaar via env CALENDAR_POLL_CRON).
 *
 * @returns aantal updated en cancelled interviews.
 */
export async function syncIncomingCalendarChanges(
  tenantId: string,
  integrationId?: string
): Promise<{ updated: number; cancelled: number }> {
  // Step 1: list candidate links (binnen tenant, alleen status='synced').
  const links = await withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId];
    let extraClause = '';
    if (integrationId) {
      params.push(integrationId);
      extraClause = `AND ce.mailbox_integration_id = $${params.length}`;
    }
    const { rows } = await client.query<
      InterviewCalendarEvent & { interview_status: string; scheduled_start: string }
    >(
      `SELECT ce.*,
              i.status              AS interview_status,
              i.scheduled_start::text AS scheduled_start
       FROM interview_calendar_events ce
       JOIN interviews i ON i.id = ce.interview_id AND i.tenant_id = ce.tenant_id
       WHERE ce.tenant_id = $1
         AND ce.status = 'synced'
         AND i.status IN ('scheduled')
         ${extraClause}
       ORDER BY ce.last_synced_at ASC
       LIMIT 200`,
      params
    );
    return rows;
  });

  let updated = 0;
  let cancelled = 0;

  for (const link of links) {
    if (!link.mailbox_integration_id) continue;
    try {
      const integration = await getIntegrationFull(
        tenantId,
        link.mailbox_integration_id
      );
      if (!integration.active) continue;
      const refreshed = await refreshTokenIfExpired(integration);
      const cal = getCalendarProvider(link.provider);
      const snap = await cal.getEvent(
        refreshed.access_token,
        link.external_event_id,
        link.external_calendar_id ?? undefined
      );

      if (snap.status === 'cancelled') {
        // Remote cancelled → mark interview cancelled + link deleted.
        await withTenant(tenantId, async (client) => {
          await client.query(
            `UPDATE interviews
             SET status = 'cancelled',
                 cancelled_at = COALESCE(cancelled_at, now()),
                 cancellation_reason = COALESCE(cancellation_reason, 'Verwijderd uit kalender')
             WHERE id = $1 AND tenant_id = $2`,
            [link.interview_id, tenantId]
          );
          await client.query(
            `UPDATE interview_calendar_events
             SET status = 'deleted', last_synced_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            [link.id, tenantId]
          );
          await logAudit(client, tenantId, {
            action: 'interview.cancelled',
            entityType: 'interview',
            entityId: link.interview_id,
            after: {
              source: 'calendar_sync',
              provider: link.provider,
            },
          });
        });
        cancelled++;
        continue;
      }

      // Remote moved → update interviews.scheduled_start/end.
      const newStart = snap.startsAt;
      const newEnd = snap.endsAt;
      if (newStart && newEnd && newStart !== link.scheduled_start) {
        await withTenant(tenantId, async (client) => {
          await client.query(
            `UPDATE interviews
             SET scheduled_start = $1::timestamptz,
                 scheduled_end   = $2::timestamptz,
                 updated_at      = now()
             WHERE id = $3 AND tenant_id = $4 AND status = 'scheduled'`,
            [newStart, newEnd, link.interview_id, tenantId]
          );
          await client.query(
            `UPDATE interview_calendar_events
             SET last_synced_at = now(), status = 'synced'
             WHERE id = $1 AND tenant_id = $2`,
            [link.id, tenantId]
          );
          await logAudit(client, tenantId, {
            action: 'interview.rescheduled',
            entityType: 'interview',
            entityId: link.interview_id,
            after: {
              source: 'calendar_sync',
              new_start: newStart,
              new_end: newEnd,
            },
          });
        });
        updated++;
        continue;
      }

      // No-op: refresh last_synced_at.
      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE interview_calendar_events
           SET last_synced_at = now()
           WHERE id = $1 AND tenant_id = $2`,
          [link.id, tenantId]
        );
      });
    } catch (err) {
      logger.error('[calendarSync] poll failed for link', {
        linkId: link.id,
        provider: link.provider,
        error: (err as Error).message,
      });
      // Mark out_of_sync zodat UI dit kan tonen.
      try {
        await withTenant(tenantId, async (client) => {
          await client.query(
            `UPDATE interview_calendar_events
             SET status = 'out_of_sync', last_synced_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            [link.id, tenantId]
          );
        });
      } catch {
        /* swallow */
      }
    }
  }

  return { updated, cancelled };
}

/**
 * Cron-entrypoint zonder tenant-scope: itereert over alle tenants met
 * actieve calendar-links. Niet exposen aan request-handlers.
 */
export async function syncAllTenantsIncomingChanges(): Promise<{
  tenants: number;
  updated: number;
  cancelled: number;
}> {
  const tenantIds = await withoutTenant(async (client) => {
    const { rows } = await client.query<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id
       FROM interview_calendar_events
       WHERE status = 'synced'`
    );
    return rows.map((r) => r.tenant_id);
  });

  let totUpd = 0;
  let totCanc = 0;
  for (const tid of tenantIds) {
    try {
      const r = await syncIncomingCalendarChanges(tid);
      totUpd += r.updated;
      totCanc += r.cancelled;
    } catch (err) {
      logger.error('[calendarSync] tenant sync failed', {
        tenantId: tid,
        error: (err as Error).message,
      });
    }
  }
  return { tenants: tenantIds.length, updated: totUpd, cancelled: totCanc };
}

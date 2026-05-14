/**
 * Pre-built push-events — Sprint Q2.4.
 *
 * Helpers voor de meest voorkomende push-flows. Zorgen voor consistente
 * Nederlandse copy en stable tag-keys (zodat herhaalde events binnen één
 * vacature/kandidaat de oudere notificatie in de tray vervangen i.p.v.
 * stapelen).
 *
 * Iedere helper roept `enqueuePush` aan — niet `sendPushNotification`
 * direct. Zo loopt alles via de worker (preferences, quiet-hours, log).
 */

import { enqueuePush } from '../queue/workers/pushNotifications.worker';
import type { PushPayload } from './webPush';

const ICON = '/icons/notif-icon-192.png';
const BADGE = '/icons/notif-badge-72.png';

export async function pushNewCandidateForReview(
  tenantId: string,
  hmUserId: string,
  candidateName: string,
  jobTitle: string,
  candidateId: string,
  applicationId?: string
): Promise<void> {
  const payload: PushPayload = {
    title: 'Nieuwe kandidaat voor je review',
    body: `${candidateName} heeft gesolliciteerd op ${jobTitle}`,
    icon: ICON,
    badge: BADGE,
    tag: `new-candidate-${applicationId ?? candidateId}`,
    requireInteraction: false,
    data: {
      type: 'new_candidate_review',
      url: applicationId
        ? `/hm/applications/${applicationId}`
        : `/hm?candidate=${candidateId}`,
      entityId: applicationId ?? candidateId,
    },
  };
  await enqueuePush(tenantId, hmUserId, 'new_candidate_review', payload);
}

export async function pushScorecardReminder(
  tenantId: string,
  userId: string,
  candidateName: string,
  hoursRemaining: number,
  applicationId: string
): Promise<void> {
  const payload: PushPayload = {
    title: 'Scorecard herinnering',
    body: `Je hebt nog ${hoursRemaining} uur om de scorecard voor ${candidateName} af te ronden`,
    icon: ICON,
    badge: BADGE,
    tag: `scorecard-${applicationId}`,
    requireInteraction: hoursRemaining <= 4,
    data: {
      type: 'scorecard_deadline',
      url: `/hm/applications/${applicationId}/scorecard`,
      entityId: applicationId,
    },
  };
  await enqueuePush(tenantId, userId, 'scorecard_deadline', payload);
}

export async function pushInterviewReminder(
  tenantId: string,
  userId: string,
  candidateName: string,
  whenLabel: string,
  applicationId: string
): Promise<void> {
  // whenLabel: bv. "vandaag om 14:00", "morgen om 10:30", "over 60 minuten".
  const payload: PushPayload = {
    title: 'Interview herinnering',
    body: `Interview met ${candidateName} ${whenLabel}`,
    icon: ICON,
    badge: BADGE,
    tag: `interview-${applicationId}`,
    requireInteraction: true,
    data: {
      type: 'interview_reminder',
      url: `/hm/applications/${applicationId}`,
      entityId: applicationId,
    },
  };
  await enqueuePush(tenantId, userId, 'interview_reminder', payload);
}

export interface DailyDigestStats {
  pendingReviews: number;
  scorecardsDue: number;
  interviewsToday: number;
}

export async function pushDailyDigest(
  tenantId: string,
  userId: string,
  stats: DailyDigestStats
): Promise<void> {
  const parts: string[] = [];
  if (stats.pendingReviews > 0)
    parts.push(`${stats.pendingReviews} reviews wachten`);
  if (stats.scorecardsDue > 0)
    parts.push(`${stats.scorecardsDue} scorecards te doen`);
  if (stats.interviewsToday > 0)
    parts.push(`${stats.interviewsToday} interviews vandaag`);

  // Geen items? Stuur niet — niemand wil "0 te doen" als notificatie.
  if (parts.length === 0) return;

  const payload: PushPayload = {
    title: 'Goedemorgen — vandaag op je bordje',
    body: `Vandaag: ${parts.join(', ')}`,
    icon: ICON,
    badge: BADGE,
    tag: `daily-digest-${new Date().toISOString().slice(0, 10)}`,
    requireInteraction: false,
    data: {
      type: 'daily_digest',
      url: '/hm',
    },
  };
  await enqueuePush(tenantId, userId, 'daily_digest', payload);
}

export async function pushApplicationStatusChange(
  tenantId: string,
  userId: string,
  candidateName: string,
  newStatus: string,
  applicationId: string
): Promise<void> {
  const payload: PushPayload = {
    title: 'Status gewijzigd',
    body: `${candidateName}: ${newStatus}`,
    icon: ICON,
    badge: BADGE,
    tag: `app-status-${applicationId}`,
    data: {
      type: 'application_status_change',
      url: `/hm/applications/${applicationId}`,
      entityId: applicationId,
    },
  };
  await enqueuePush(tenantId, userId, 'application_status_change', payload);
}

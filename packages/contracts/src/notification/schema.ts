import { z } from "zod";

/**
 * Notification-preferences contract — geconsolideerde wire-shape voor
 * `GET/PUT /api/notifications/preferences`.
 *
 * Achtergrond (ROADMAP "Notificatie-voorkeuren: frontend/backend-contract
 * mismatch"): de settings-pagina werkt met één object
 * `{ push_enabled, events{}, quiet_hours_start/end, timezone }`, terwijl de
 * database per (channel, event_type)-rij opslaat. Dit schema is de single
 * source of truth voor beide kanten van de wire; de mapping object ↔ rijen
 * gebeurt in `apps/api` (preferences.service.ts).
 *
 * Representatie-keuzes:
 *   - `push_enabled` wordt server-side bewaard als master-rij met
 *     `event_type = '_master'` (kanaal 'push'). Geen master-rij = enabled
 *     (opt-out policy, consistent met de delivery-worker).
 *   - `quiet_hours_*`: "HH:MM" of null. Null = geen stille uren. Een half
 *     ingevuld venster (alleen start of alleen einde) round-tript wel, maar
 *     is inactief in de worker.
 *   - `timezone`: IANA-naam; default Europe/Amsterdam.
 */

export const NOTIFICATION_EVENT_TYPES = [
  "new_candidate_review",
  "scorecard_deadline",
  "interview_reminder",
  "application_status_change",
  "daily_digest",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

/** "HH:MM" — 24-uurs, zero-padded (zoals <input type="time"> levert). */
const timeHHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: "verwacht tijd-formaat HH:MM (24-uurs)",
  });

export const NotificationEventTogglesSchema = z.object({
  new_candidate_review: z.boolean(),
  scorecard_deadline: z.boolean(),
  interview_reminder: z.boolean(),
  application_status_change: z.boolean(),
  daily_digest: z.boolean(),
});

/** Response-shape van GET en PUT — altijd volledig ingevuld. */
export const NotificationPreferencesSchema = z.object({
  push_enabled: z.boolean(),
  events: NotificationEventTogglesSchema,
  quiet_hours_start: timeHHMM.nullable(),
  quiet_hours_end: timeHHMM.nullable(),
  timezone: z.string().min(1).max(64),
});

/**
 * Request-body van PUT.
 *
 * Semantiek (full-replace met tolerantie voor oudere clients):
 *   - `push_enabled` is verplicht.
 *   - `events`: alleen meegegeven keys worden geschreven; ontbrekende keys
 *     blijven op hun huidige (of default-)waarde.
 *   - `quiet_hours_*`: weggelaten of null = stille uren wissen.
 *   - `timezone`: weggelaten = huidige waarde behouden.
 */
export const NotificationPreferencesUpdateSchema = z.object({
  push_enabled: z.boolean(),
  events: NotificationEventTogglesSchema.partial().optional(),
  quiet_hours_start: timeHHMM.nullable().optional(),
  quiet_hours_end: timeHHMM.nullable().optional(),
  timezone: z.string().min(1).max(64).optional(),
});

export type NotificationEventToggles = z.infer<
  typeof NotificationEventTogglesSchema
>;
export type NotificationPreferences = z.infer<
  typeof NotificationPreferencesSchema
>;
export type NotificationPreferencesUpdate = z.infer<
  typeof NotificationPreferencesUpdateSchema
>;

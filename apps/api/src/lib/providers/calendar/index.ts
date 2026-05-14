/**
 * Calendar provider — uniform interface voor 2-way kalendersync.
 *
 * Spiegelt het ontwerp van `lib/mailProvider.ts`: twee implementaties
 * (Google Calendar via `googleapis`, Outlook via Microsoft Graph) achter
 * een neutrale shape zodat de service-laag (`calendarSync.service.ts`)
 * provider-agnostisch is.
 *
 * **Auth**: hergebruikt het access_token dat al in `mailbox_integrations`
 * staat — Google's gmail-OAuth scope geeft (na uitbreiding) ook calendar
 * toegang via `https://www.googleapis.com/auth/calendar.events`. Outlook's
 * Microsoft Graph token werkt identiek voor mail- en calendar-endpoints
 * mits de Calendars.ReadWrite scope was aangevraagd. Beide scopes worden
 * via een env-flag (`CALENDAR_SCOPES_ENABLED=true`) toegevoegd aan de
 * OAuth-flow zodat bestaande integraties zonder calendar-scope in een
 * graceful 'reconnect required'-state belanden.
 *
 * **Geen webhooks**: providers ondersteunen push-notifications (Google
 * `events.watch`, Outlook subscription) maar dat vereist publiek
 * bereikbare HTTPS-callback endpoints + cert pinning. Voor MVP gebruiken
 * we polling via `syncIncomingCalendarChanges` (BullMQ cron, default
 * elke 10 min). Webhooks komen in een vervolgsprint zodra we tunneling
 * (ngrok-like) of stable HTTPS hebben in dev.
 */

export type CalendarProviderName = 'google' | 'outlook';

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  /** True voor verplichte deelnemers, false voor optional. Default true. */
  required?: boolean;
}

export interface CreateCalendarEventParams {
  summary: string;
  description?: string;
  /** ISO-8601 starttijd. */
  startsAt: string;
  /** ISO-8601 eindtijd. */
  endsAt: string;
  /** IANA timezone-naam, bv. 'Europe/Amsterdam'. */
  timezone?: string;
  /** Locatie of conferencing-link. Optioneel. */
  location?: string;
  /** Aanwezigen — providers sturen invites per email. */
  attendees?: CalendarAttendee[];
  /** Default 'primary' voor de eigenaar van het token. */
  calendarId?: string;
}

export interface UpdateCalendarEventParams extends Partial<CreateCalendarEventParams> {
  /** Het bestaande event-id, vereist bij update. */
  eventId: string;
}

export interface CalendarEventSnapshot {
  /** Provider event id. */
  id: string;
  status: 'confirmed' | 'tentative' | 'cancelled' | 'unknown';
  summary?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  location?: string;
  attendees?: Array<{ email: string; responseStatus?: string }>;
  /** Wanneer het event in de provider voor het laatst is bijgewerkt. */
  updatedAt?: string;
}

export interface CalendarProvider {
  /**
   * Maak een nieuw event aan op de kalender van de tokenhouder.
   * Returnt minstens het provider event-id.
   */
  createEvent(
    accessToken: string,
    params: CreateCalendarEventParams
  ): Promise<{ eventId: string; calendarId: string; htmlLink?: string }>;
  /**
   * Update een bestaand event. Leeggelaten velden blijven onveranderd.
   */
  updateEvent(
    accessToken: string,
    params: UpdateCalendarEventParams,
    calendarId?: string
  ): Promise<void>;
  /**
   * Cancel/delete een bestaand event. Idempotent: 404 = niet meer bestaat
   * → return zonder fout.
   */
  deleteEvent(
    accessToken: string,
    eventId: string,
    calendarId?: string
  ): Promise<void>;
  /**
   * Haal de huidige status van het event op. Gebruikt door de polling-
   * worker om out-of-sync / cancelled events te detecteren.
   */
  getEvent(
    accessToken: string,
    eventId: string,
    calendarId?: string
  ): Promise<CalendarEventSnapshot>;
}

export { googleCalendarProvider } from './google';
export { outlookCalendarProvider } from './outlook';

import { googleCalendarProvider } from './google';
import { outlookCalendarProvider } from './outlook';

export function getCalendarProvider(
  provider: CalendarProviderName
): CalendarProvider {
  if (provider === 'google') return googleCalendarProvider;
  if (provider === 'outlook') return outlookCalendarProvider;
  throw new Error(`Unknown calendar provider: ${provider as string}`);
}

/**
 * Map mail-provider-naam naar calendar-provider-naam — handig wanneer een
 * `mailbox_integrations`-row als basis dient voor calendar-sync.
 */
export function calendarProviderFromMailProvider(
  mailProvider: 'gmail' | 'outlook'
): CalendarProviderName {
  return mailProvider === 'gmail' ? 'google' : 'outlook';
}

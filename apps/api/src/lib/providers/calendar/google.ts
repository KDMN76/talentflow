/**
 * Google Calendar provider — implementeert CalendarProvider via `googleapis`.
 *
 * Hergebruikt het OAuth2-token dat al door `gmailProvider` is verkregen
 * (we nemen aan dat de calendar-scope is meegevraagd via de Q3.1
 * mailbox-OAuth-flow zodra `CALENDAR_SCOPES_ENABLED=true` is gezet).
 *
 * Endpoints (https://developers.google.com/calendar/api/v3/reference):
 *   - events.insert    — maak event
 *   - events.patch     — partial update
 *   - events.delete    — cancel
 *   - events.get       — single event lookup
 *
 * Mock-mode: ontbrekende GOOGLE_OAUTH_CLIENT_ID/SECRET (zelfde flag als
 * gmailProvider) → provider gooit duidelijke fouten zodat de service-laag
 * een nette 501 (NOT_CONFIGURED) terug kan geven.
 */

import { google, calendar_v3 } from 'googleapis';
import {
  CalendarEventSnapshot,
  CalendarProvider,
  CreateCalendarEventParams,
  UpdateCalendarEventParams,
} from './index';
import { logger } from '../../../middleware/errorHandler';

const DEFAULT_CALENDAR_ID = 'primary';
const DEFAULT_TIMEZONE = 'Europe/Amsterdam';

function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
}

function withAuth(accessToken: string): calendar_v3.Calendar {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth });
}

function buildEventBody(
  params: CreateCalendarEventParams | UpdateCalendarEventParams
): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = {};
  if (params.summary !== undefined) body.summary = params.summary;
  if (params.description !== undefined) body.description = params.description;
  if (params.location !== undefined) body.location = params.location;

  if (params.startsAt) {
    body.start = {
      dateTime: params.startsAt,
      timeZone: params.timezone ?? DEFAULT_TIMEZONE,
    };
  }
  if (params.endsAt) {
    body.end = {
      dateTime: params.endsAt,
      timeZone: params.timezone ?? DEFAULT_TIMEZONE,
    };
  }

  if (params.attendees) {
    body.attendees = params.attendees.map((a) => ({
      email: a.email,
      displayName: a.displayName,
      optional: a.required === false,
    }));
  }
  return body;
}

async function createEvent(
  accessToken: string,
  params: CreateCalendarEventParams
): Promise<{ eventId: string; calendarId: string; htmlLink?: string }> {
  if (!isGoogleConfigured()) {
    throw new Error(
      'Google Calendar OAuth not configured (GOOGLE_OAUTH_CLIENT_ID missing)'
    );
  }
  const calendar = withAuth(accessToken);
  const calendarId = params.calendarId ?? DEFAULT_CALENDAR_ID;

  const { data } = await calendar.events.insert({
    calendarId,
    sendUpdates: 'all',
    requestBody: buildEventBody(params),
  });
  if (!data.id) {
    throw new Error('Google Calendar events.insert leverde geen id op');
  }
  return {
    eventId: data.id,
    calendarId,
    htmlLink: data.htmlLink ?? undefined,
  };
}

async function updateEvent(
  accessToken: string,
  params: UpdateCalendarEventParams,
  calendarId: string = DEFAULT_CALENDAR_ID
): Promise<void> {
  if (!isGoogleConfigured()) {
    throw new Error('Google Calendar OAuth not configured');
  }
  const calendar = withAuth(accessToken);
  await calendar.events.patch({
    calendarId,
    eventId: params.eventId,
    sendUpdates: 'all',
    requestBody: buildEventBody(params),
  });
}

async function deleteEvent(
  accessToken: string,
  eventId: string,
  calendarId: string = DEFAULT_CALENDAR_ID
): Promise<void> {
  if (!isGoogleConfigured()) {
    throw new Error('Google Calendar OAuth not configured');
  }
  const calendar = withAuth(accessToken);
  try {
    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: 'all',
    });
  } catch (err) {
    const status = (err as { code?: number; status?: number }).code
      ?? (err as { code?: number; status?: number }).status;
    if (status === 404 || status === 410) {
      // Event al verdwenen — idempotent.
      logger.info('[googleCalendar] delete: event already gone', { eventId });
      return;
    }
    throw err;
  }
}

function mapStatus(status?: string | null): CalendarEventSnapshot['status'] {
  switch ((status ?? '').toLowerCase()) {
    case 'confirmed':
      return 'confirmed';
    case 'tentative':
      return 'tentative';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

async function getEvent(
  accessToken: string,
  eventId: string,
  calendarId: string = DEFAULT_CALENDAR_ID
): Promise<CalendarEventSnapshot> {
  if (!isGoogleConfigured()) {
    throw new Error('Google Calendar OAuth not configured');
  }
  const calendar = withAuth(accessToken);
  try {
    const { data } = await calendar.events.get({ calendarId, eventId });
    return {
      id: data.id ?? eventId,
      status: mapStatus(data.status),
      summary: data.summary ?? undefined,
      description: data.description ?? undefined,
      startsAt: data.start?.dateTime ?? data.start?.date ?? undefined,
      endsAt: data.end?.dateTime ?? data.end?.date ?? undefined,
      location: data.location ?? undefined,
      attendees:
        data.attendees?.map((a) => ({
          email: a.email ?? '',
          responseStatus: a.responseStatus ?? undefined,
        })) ?? [],
      updatedAt: data.updated ?? undefined,
    };
  } catch (err) {
    const status = (err as { code?: number; status?: number }).code
      ?? (err as { code?: number; status?: number }).status;
    if (status === 404 || status === 410) {
      // Behandel als cancelled zodat de polling-worker het kan opruimen.
      return { id: eventId, status: 'cancelled' };
    }
    throw err;
  }
}

export const googleCalendarProvider: CalendarProvider = {
  createEvent,
  updateEvent,
  deleteEvent,
  getEvent,
};

export { isGoogleConfigured as _isGoogleCalendarConfigured };

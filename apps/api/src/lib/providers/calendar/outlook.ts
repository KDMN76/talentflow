/**
 * Outlook Calendar provider — implementeert CalendarProvider via Microsoft
 * Graph (`/me/events` endpoint).
 *
 * Hergebruikt het access_token dat al door `outlookProvider` (mailbox) is
 * verkregen — Microsoft Graph deelt één token-flow tussen mail- en calendar-
 * scopes (Calendars.ReadWrite). Bij oudere integraties zonder calendar-scope
 * gooit de Graph-call een 403 die door de service-laag wordt vertaald in een
 * "reconnect required"-melding.
 *
 * Endpoints:
 *   POST   /me/events                  — create
 *   PATCH  /me/events/{id}             — update
 *   DELETE /me/events/{id}             — cancel
 *   GET    /me/events/{id}             — read
 */

import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch';
import {
  CalendarEventSnapshot,
  CalendarProvider,
  CreateCalendarEventParams,
  UpdateCalendarEventParams,
} from './index';
import { logger } from '../../../middleware/errorHandler';

const DEFAULT_TIMEZONE = 'Europe/Amsterdam';

function isOutlookConfigured(): boolean {
  return Boolean(
    process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET
  );
}

function graphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => done(null, accessToken),
  });
}

interface GraphAttendee {
  emailAddress: { address: string; name?: string };
  type: 'required' | 'optional';
}

interface GraphEventBody {
  subject?: string;
  body?: { contentType: 'HTML' | 'Text'; content: string };
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  attendees?: GraphAttendee[];
}

function buildBody(
  params: CreateCalendarEventParams | UpdateCalendarEventParams
): GraphEventBody {
  const body: GraphEventBody = {};
  if (params.summary !== undefined) body.subject = params.summary;
  if (params.description !== undefined) {
    body.body = { contentType: 'HTML', content: params.description };
  }
  if (params.location !== undefined) {
    body.location = { displayName: params.location };
  }
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
      emailAddress: { address: a.email, name: a.displayName },
      type: a.required === false ? 'optional' : 'required',
    }));
  }
  return body;
}

interface GraphEventResponse {
  id?: string;
  webLink?: string;
}

async function createEvent(
  accessToken: string,
  params: CreateCalendarEventParams
): Promise<{ eventId: string; calendarId: string; htmlLink?: string }> {
  if (!isOutlookConfigured()) {
    throw new Error(
      'Outlook Calendar OAuth not configured (AZURE_AD_CLIENT_ID missing)'
    );
  }
  const client = graphClient(accessToken);
  const path = params.calendarId
    ? `/me/calendars/${params.calendarId}/events`
    : `/me/events`;
  const data: GraphEventResponse = await client.api(path).post(buildBody(params));
  if (!data.id) {
    throw new Error('Outlook Graph create event leverde geen id op');
  }
  return {
    eventId: data.id,
    calendarId: params.calendarId ?? 'primary',
    htmlLink: data.webLink,
  };
}

async function updateEvent(
  accessToken: string,
  params: UpdateCalendarEventParams,
  _calendarId?: string
): Promise<void> {
  if (!isOutlookConfigured()) {
    throw new Error('Outlook Calendar OAuth not configured');
  }
  const client = graphClient(accessToken);
  await client.api(`/me/events/${params.eventId}`).patch(buildBody(params));
}

async function deleteEvent(
  accessToken: string,
  eventId: string,
  _calendarId?: string
): Promise<void> {
  if (!isOutlookConfigured()) {
    throw new Error('Outlook Calendar OAuth not configured');
  }
  const client = graphClient(accessToken);
  try {
    await client.api(`/me/events/${eventId}`).delete();
  } catch (err) {
    const status = (err as { statusCode?: number; status?: number; code?: number }).statusCode
      ?? (err as { statusCode?: number; status?: number; code?: number }).status
      ?? (err as { statusCode?: number; status?: number; code?: number }).code;
    if (status === 404 || status === 410) {
      logger.info('[outlookCalendar] delete: event already gone', { eventId });
      return;
    }
    throw err;
  }
}

interface GraphFullEvent {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  isCancelled?: boolean;
  showAs?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string };
  attendees?: Array<{
    emailAddress?: { address?: string };
    status?: { response?: string };
  }>;
  lastModifiedDateTime?: string;
}

function mapStatus(event: GraphFullEvent): CalendarEventSnapshot['status'] {
  if (event.isCancelled === true) return 'cancelled';
  const showAs = (event.showAs ?? '').toLowerCase();
  if (showAs === 'tentative') return 'tentative';
  if (showAs === 'free' || showAs === 'busy' || showAs === 'oof') return 'confirmed';
  return event.id ? 'confirmed' : 'unknown';
}

async function getEvent(
  accessToken: string,
  eventId: string,
  _calendarId?: string
): Promise<CalendarEventSnapshot> {
  if (!isOutlookConfigured()) {
    throw new Error('Outlook Calendar OAuth not configured');
  }
  const client = graphClient(accessToken);
  try {
    const data: GraphFullEvent = await client.api(`/me/events/${eventId}`).get();
    return {
      id: data.id ?? eventId,
      status: mapStatus(data),
      summary: data.subject,
      description: data.bodyPreview,
      startsAt: data.start?.dateTime,
      endsAt: data.end?.dateTime,
      location: data.location?.displayName,
      attendees:
        data.attendees?.map((a) => ({
          email: a.emailAddress?.address ?? '',
          responseStatus: a.status?.response,
        })) ?? [],
      updatedAt: data.lastModifiedDateTime,
    };
  } catch (err) {
    const status = (err as { statusCode?: number; status?: number; code?: number }).statusCode
      ?? (err as { statusCode?: number; status?: number; code?: number }).status
      ?? (err as { statusCode?: number; status?: number; code?: number }).code;
    if (status === 404 || status === 410) {
      return { id: eventId, status: 'cancelled' };
    }
    throw err;
  }
}

export const outlookCalendarProvider: CalendarProvider = {
  createEvent,
  updateEvent,
  deleteEvent,
  getEvent,
};

export { isOutlookConfigured as _isOutlookCalendarConfigured };

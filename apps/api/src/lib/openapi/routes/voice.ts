/**
 * OpenAPI route specs for `/api/voice/*` — Sprint Q4.6 (Agent AAAA).
 *
 * Tag: `Voice`. Twilio-backed VoIP with mock-mode for dev/test.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

const directionEnum = z.enum(['inbound', 'outbound']);
const statusEnum = z.enum([
  'queued',
  'ringing',
  'in_progress',
  'completed',
  'busy',
  'no_answer',
  'failed',
  'canceled',
  'voicemail',
]);

const VoiceIntegration = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    provider: z.literal('twilio'),
    status: z.enum(['connected', 'disconnected', 'error']),
    account_sid: z.string().nullable(),
    phone_number: z.string().nullable(),
    connected_by: z.string().uuid().nullable(),
    connected_at: z.string().datetime().nullable(),
    last_error: z.string().nullable(),
    metadata: z.record(z.unknown()),
    created_at: z.string().datetime(),
  })
  .openapi('VoiceIntegration');

const VoiceCall = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    integration_id: z.string().uuid().nullable(),
    candidate_id: z.string().uuid().nullable(),
    direction: directionEnum,
    status: statusEnum,
    from_number: z.string().nullable(),
    to_number: z.string().nullable(),
    external_sid: z.string().nullable(),
    duration_seconds: z.number().int(),
    recording_url: z.string().nullable(),
    recording_duration_seconds: z.number().int().nullable(),
    transcription_text: z.string().nullable(),
    transcription_status: z.enum(['pending', 'done', 'failed']).nullable(),
    voicemail: z.boolean(),
    notes: z.string().nullable(),
    initiated_by: z.string().uuid().nullable(),
    started_at: z.string().datetime().nullable(),
    answered_at: z.string().datetime().nullable(),
    ended_at: z.string().datetime().nullable(),
    communication_id: z.string().uuid().nullable(),
    metadata: z.record(z.unknown()),
    created_at: z.string().datetime(),
  })
  .openapi('VoiceCall');

const ConnectBody = z
  .object({
    account_sid: z.string(),
    auth_token: z.string(),
    phone_number: z.string(),
  })
  .openapi('VoiceConnectBody');

const InitiateBody = z
  .object({
    candidate_id: z.string().uuid(),
    to_number: z.string().optional(),
  })
  .openapi('VoiceInitiateBody');

const NotesBody = z.object({ notes: z.string() }).openapi('VoiceNotesBody');

registry.registerPath({
  method: 'get',
  path: '/api/voice/integration',
  tags: ['Voice'],
  summary: 'Get the per-tenant Twilio voice integration (or null)',
  security: authSecurity,
  responses: {
    200: jsonResponse('OK', z.object({ data: VoiceIntegration.nullable() })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/voice/integration/connect',
  tags: ['Voice'],
  summary: 'Connect or update the Twilio voice integration',
  security: authSecurity,
  request: { body: { content: { 'application/json': { schema: ConnectBody } } } },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: VoiceIntegration })),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/voice/integration',
  tags: ['Voice'],
  summary: 'Disconnect the Twilio integration',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.object({ data: VoiceIntegration })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/voice/calls',
  tags: ['Voice'],
  summary: 'List voice calls (cursor-paginated)',
  security: authSecurity,
  request: {
    query: z.object({
      candidate_id: z.string().uuid().optional(),
      direction: directionEnum.optional(),
      status: statusEnum.optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(VoiceCall),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/voice/calls/{id}',
  tags: ['Voice'],
  summary: 'Get a single voice call (includes transcription)',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: VoiceCall })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/voice/calls',
  tags: ['Voice'],
  summary: 'Initiate an outbound call to a candidate',
  security: authSecurity,
  request: { body: { content: { 'application/json': { schema: InitiateBody } } } },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: VoiceCall })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/voice/calls/{id}/end',
  tags: ['Voice'],
  summary: 'End an in-progress call',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: VoiceCall })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/voice/calls/{id}/notes',
  tags: ['Voice'],
  summary: 'Append recruiter notes to a call',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: NotesBody } } },
  },
  responses: { 200: jsonResponse('OK', z.object({ data: VoiceCall })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/voice/calls/{id}/transcribe',
  tags: ['Voice'],
  summary: 'Request transcription of a call recording (Whisper)',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: VoiceCall })) },
});

// Public Twilio webhook
registry.registerPath({
  method: 'post',
  path: '/api/webhooks/twilio/{tenantSlug}',
  tags: ['Voice'],
  summary: 'Twilio status / recording-complete webhook (HMAC-SHA1 verified)',
  request: {
    params: z.object({ tenantSlug: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              CallSid: z.string(),
              CallStatus: z.string().optional(),
              RecordingUrl: z.string().optional(),
              RecordingDuration: z.string().optional(),
              CallDuration: z.string().optional(),
              From: z.string().optional(),
              To: z.string().optional(),
            })
            .openapi('TwilioWebhookBody'),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      'Recorded',
      z.object({
        data: z.object({
          updated: z.boolean(),
          transcribed: z.boolean(),
          call_id: z.string().uuid().nullable(),
        }),
      })
    ),
    401: { description: 'Invalid signature' },
    404: { description: 'Tenant niet gevonden' },
  },
});

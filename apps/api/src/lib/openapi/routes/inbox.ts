/**
 * OpenAPI route specs for `/api/inbox/*` — Sprint Q4.6 (Agent AAAA).
 *
 * Tag: `Inbox`. The omni-channel timeline merges email + WhatsApp + voice +
 * LinkedIn outreach into one per-candidate thread.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

const UnifiedThread = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    last_message_at: z.string().datetime().nullable(),
    last_channel: z.string().nullable(),
    last_message_preview: z.string().nullable(),
    unread_count_for_assignee: z.number().int(),
    assignee_user_id: z.string().uuid().nullable(),
    pinned: z.boolean(),
    archived_at: z.string().datetime().nullable(),
    labels: z.array(z.string()),
    metadata: z.record(z.unknown()),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    candidate_name: z.string().nullable().optional(),
  })
  .openapi('UnifiedThread');

const TimelineEvent = z
  .object({
    id: z.string(),
    channel: z.string(),
    direction: z.enum(['inbound', 'outbound']),
    timestamp: z.string().datetime(),
    sender_name: z.string().nullable(),
    preview: z.string(),
    body: z.string().nullable(),
    attachments: z.array(
      z.object({
        url: z.string(),
        type: z.string().optional(),
        name: z.string().optional(),
      })
    ),
    metadata: z.record(z.unknown()),
  })
  .openapi('InboxTimelineEvent');

const AssignBody = z
  .object({ user_id: z.string().uuid().nullable() })
  .openapi('InboxAssignBody');

const LabelBody = z.object({ label: z.string() }).openapi('InboxLabelBody');

registry.registerPath({
  method: 'get',
  path: '/api/inbox/threads',
  tags: ['Inbox'],
  summary: 'List unified inbox threads (cursor-paginated)',
  security: authSecurity,
  request: {
    query: z.object({
      unread: z.coerce.boolean().optional(),
      channel: z.string().optional(),
      assignee_user_id: z.string().uuid().optional(),
      pinned: z.coerce.boolean().optional(),
      archived: z.coerce.boolean().optional(),
      q: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(UnifiedThread),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/inbox/threads/{id}',
  tags: ['Inbox'],
  summary: 'Get a single unified inbox thread',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse('OK', z.object({ data: UnifiedThread })),
    404: { description: 'Thread niet gevonden' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/inbox/threads/{id}/timeline',
  tags: ['Inbox'],
  summary: 'Get a merged timeline of all channel events for a thread',
  security: authSecurity,
  request: {
    params: idParam,
    query: z.object({
      before: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(TimelineEvent),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/inbox/threads/{id}/read',
  tags: ['Inbox'],
  summary: 'Mark a thread as read',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: UnifiedThread })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/inbox/threads/{id}/assign',
  tags: ['Inbox'],
  summary: 'Assign a thread to a recruiter',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: AssignBody } } },
  },
  responses: { 200: jsonResponse('OK', z.object({ data: UnifiedThread })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/inbox/threads/{id}/pin',
  tags: ['Inbox'],
  summary: 'Pin a thread to the top of the inbox',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: UnifiedThread })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/inbox/threads/{id}/unpin',
  tags: ['Inbox'],
  summary: 'Remove pin from a thread',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: UnifiedThread })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/inbox/threads/{id}/archive',
  tags: ['Inbox'],
  summary: 'Archive a thread',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: UnifiedThread })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/inbox/threads/{id}/unarchive',
  tags: ['Inbox'],
  summary: 'Unarchive a thread',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.object({ data: UnifiedThread })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/inbox/threads/{id}/labels',
  tags: ['Inbox'],
  summary: 'Add a label to a thread',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: LabelBody } } },
  },
  responses: { 200: jsonResponse('OK', z.object({ data: UnifiedThread })) },
});

registry.registerPath({
  method: 'delete',
  path: '/api/inbox/threads/{id}/labels/{label}',
  tags: ['Inbox'],
  summary: 'Remove a label from a thread',
  security: authSecurity,
  request: {
    params: z.object({
      id: z.string().uuid(),
      label: z.string(),
    }),
  },
  responses: { 200: jsonResponse('OK', z.object({ data: UnifiedThread })) },
});

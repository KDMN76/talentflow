/**
 * Communications route-specs — `/api/communications/*`.
 */

import { z } from 'zod';
import { registry } from '../registry';
import {
  authSecurity,
  jsonResponse,
  standardErrorResponses,
} from '../common';

const CommunicationRecord = z
  .object({
    id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    channel: z.enum(['email', 'whatsapp', 'sms']),
    direction: z.enum(['outbound', 'inbound']),
    subject: z.string().nullable(),
    body: z.string(),
    status: z.enum(['queued', 'sent', 'delivered', 'failed', 'received']),
    provider_id: z.string().nullable(),
    sent_at: z.string().datetime().nullable(),
    delivered_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
  })
  .openapi('CommunicationRecord');

const BulkCampaign = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    subject: z.string(),
    via: z.enum(['resend', 'mailbox_integration']),
    candidate_count: z.number().int(),
    sent_count: z.number().int(),
    failed_count: z.number().int(),
    status: z.enum(['queued', 'running', 'completed', 'failed']),
    created_at: z.string().datetime(),
  })
  .openapi('BulkCampaign');

registry.registerPath({
  method: 'get',
  path: '/api/communications/inbox',
  tags: ['Communications'],
  summary: 'Unified inbox (alle kanalen)',
  security: authSecurity,
  request: {
    query: z.object({
      channel: z.enum(['email', 'whatsapp', 'sms']).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(CommunicationRecord) })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/communications/send',
  tags: ['Communications'],
  summary: 'Send transactional e-mail (queued)',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            candidate_id: z.string().uuid(),
            template_id: z.string().uuid().optional(),
            subject: z.string().min(1).max(500),
            body_html: z.string().min(1),
            body_text: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    202: jsonResponse('In wachtrij geplaatst', z.object({ queued_id: z.string() })),
    400: standardErrorResponses[400],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/communications/candidates/{candidateId}',
  tags: ['Communications'],
  summary: 'Communication history for a candidate',
  security: authSecurity,
  request: { params: z.object({ candidateId: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(CommunicationRecord) })) },
});

registry.registerPath({
  method: 'post',
  path: '/api/communications/candidates/{candidateId}/email',
  tags: ['Communications'],
  summary: 'Send e-mail to candidate',
  security: authSecurity,
  request: {
    params: z.object({ candidateId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            subject: z.string().min(1).max(500),
            body: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: { 201: jsonResponse('Verzonden', CommunicationRecord) },
});

registry.registerPath({
  method: 'post',
  path: '/api/communications/candidates/{candidateId}/whatsapp',
  tags: ['Communications'],
  summary: 'Send WhatsApp message',
  description: 'Vereist tenant met WhatsApp-integratie. Beta — kanaal kan tijdelijk uitgeschakeld zijn (zie roadmap).',
  security: authSecurity,
  request: {
    params: z.object({ candidateId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: z.object({ body: z.string().min(1) }) } } },
  },
  responses: { 201: jsonResponse('Verzonden', CommunicationRecord) },
});

registry.registerPath({
  method: 'post',
  path: '/api/communications/candidates/{candidateId}/sms',
  tags: ['Communications'],
  summary: 'Send SMS',
  security: authSecurity,
  request: {
    params: z.object({ candidateId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: z.object({ body: z.string().min(1).max(1600) }) } } },
  },
  responses: { 201: jsonResponse('Verzonden', CommunicationRecord) },
});

registry.registerPath({
  method: 'post',
  path: '/api/communications/bulk-campaign',
  tags: ['Communications'],
  summary: 'Start bulk campaign',
  description:
    'Verzendt e-mail naar tot 5000 kandidaten. Wanneer `via=mailbox_integration`, wordt verzonden via de mailbox van de recruiter (Gmail/Outlook OAuth).',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            candidate_ids: z.array(z.string().uuid()).min(1).max(5000),
            subject: z.string().min(1).max(500),
            body_html: z.string().min(1),
            template_id: z.string().uuid().optional(),
            via: z.enum(['resend', 'mailbox_integration']),
            mailbox_integration_id: z.string().uuid().optional(),
          }),
        },
      },
    },
  },
  responses: {
    202: jsonResponse('Campaign gestart', BulkCampaign),
    400: standardErrorResponses[400],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/communications/bulk-campaigns',
  tags: ['Communications'],
  summary: 'List bulk campaigns',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.object({ data: z.array(BulkCampaign) })) },
});

registry.registerPath({
  method: 'get',
  path: '/api/communications/bulk-campaigns/{id}',
  tags: ['Communications'],
  summary: 'Get bulk campaign status',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: jsonResponse('OK', BulkCampaign) },
});

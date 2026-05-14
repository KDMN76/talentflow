/**
 * OpenAPI route specs for `/api/whatsapp/*` — Sprint Q4.6 (Agent ZZZ).
 *
 * Tag: `WhatsApp`. Pragmatic schemas — `z.unknown()` for nested-heavy fields
 * keeps the spec compact.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, jsonResponse } from '../common';

const statusEnum = z.enum(['connected', 'disconnected', 'suspended', 'error']);
const messageStatusEnum = z.enum([
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'received',
]);
const directionEnum = z.enum(['outbound', 'inbound']);
const templateStatusEnum = z.enum([
  'draft',
  'submitted',
  'approved',
  'rejected',
  'paused',
  'disabled',
]);
const consentStatusEnum = z.enum(['pending', 'granted', 'withdrawn', 'blocked']);

const Integration = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    provider: z.string(),
    status: statusEnum,
    phone_number: z.string(),
    display_name: z.string().nullable(),
    waba_id: z.string().nullable(),
    quality_rating: z.enum(['green', 'yellow', 'red', 'unknown']),
    messaging_limit: z.string().nullable(),
    connected_by: z.string().uuid().nullable(),
    connected_at: z.string().datetime().nullable(),
    last_health_check_at: z.string().datetime().nullable(),
    last_error: z.string().nullable(),
    metadata: z.record(z.unknown()),
    created_at: z.string().datetime(),
  })
  .openapi('WhatsAppIntegration');

const Template = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    integration_id: z.string().uuid().nullable(),
    name: z.string(),
    external_id: z.string().nullable(),
    language: z.string(),
    category: z.enum(['marketing', 'utility', 'authentication']).nullable(),
    status: templateStatusEnum,
    header: z.record(z.unknown()).nullable(),
    body: z.string(),
    footer: z.string().nullable(),
    buttons: z.array(z.record(z.unknown())),
    example_variables: z.array(z.unknown()),
    rejection_reason: z.string().nullable(),
    submitted_at: z.string().datetime().nullable(),
    approved_at: z.string().datetime().nullable(),
    created_by: z.string().uuid().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi('WhatsAppTemplate');

const WhatsAppMessage = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    integration_id: z.string().uuid().nullable(),
    candidate_id: z.string().uuid().nullable(),
    conversation_id: z.string().nullable(),
    direction: directionEnum,
    message_type: z.string(),
    template_id: z.string().uuid().nullable(),
    template_variables: z.array(z.unknown()),
    body_text: z.string().nullable(),
    media_url: z.string().nullable(),
    media_mime: z.string().nullable(),
    status: messageStatusEnum,
    external_id: z.string().nullable(),
    reply_to_id: z.string().uuid().nullable(),
    pricing_category: z.string().nullable(),
    pricing_amount_cents: z.number().nullable(),
    sent_at: z.string().datetime().nullable(),
    delivered_at: z.string().datetime().nullable(),
    read_at: z.string().datetime().nullable(),
    error_code: z.string().nullable(),
    error_message: z.string().nullable(),
    communication_id: z.string().uuid().nullable(),
    metadata: z.record(z.unknown()),
    created_at: z.string().datetime(),
  })
  .openapi('WhatsAppMessage');

const Consent = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    phone_number: z.string(),
    status: consentStatusEnum,
    opt_in_source: z
      .enum(['career_page', 'recruiter_invite', 'reply', 'imported'])
      .nullable(),
    opt_in_message_id: z.string().uuid().nullable(),
    granted_at: z.string().datetime().nullable(),
    withdrawn_at: z.string().datetime().nullable(),
    withdrawal_reason: z.string().nullable(),
    ip_address: z.string().nullable(),
    user_agent: z.string().nullable(),
    created_at: z.string().datetime(),
  })
  .openapi('WhatsAppConsent');

// ───── Integration ─────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/whatsapp/integration',
  tags: ['WhatsApp'],
  summary: 'Haal de WhatsApp-integratie van de tenant op',
  security: authSecurity,
  responses: {
    200: jsonResponse('OK', z.object({ data: Integration.nullable() })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/whatsapp/integration/connect',
  tags: ['WhatsApp'],
  summary: 'Verbind een 360dialog WhatsApp Business-account',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            phone_number: z.string(),
            api_key: z.string(),
            waba_id: z.string().nullable().optional(),
            display_name: z.string().nullable().optional(),
            webhook_secret: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: Integration })),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/whatsapp/integration',
  tags: ['WhatsApp'],
  summary: 'Ontkoppel de WhatsApp-integratie',
  security: authSecurity,
  responses: { 204: { description: 'Ontkoppeld' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/whatsapp/integration/health-check',
  tags: ['WhatsApp'],
  summary: 'Forceer een health-check tegen 360dialog (kwaliteitsrating, limiet)',
  security: authSecurity,
  responses: {
    200: jsonResponse('OK', z.object({ data: Integration })),
  },
});

// ───── Templates ───────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/whatsapp/templates',
  tags: ['WhatsApp'],
  summary: 'Lijst WhatsApp-templates van de tenant (cursor-paginated)',
  security: authSecurity,
  request: {
    query: z.object({
      status: templateStatusEnum.optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(Template),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/whatsapp/templates',
  tags: ['WhatsApp'],
  summary: 'Maak een nieuwe WhatsApp-template aan (status=draft)',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string(),
            language: z.string(),
            category: z.enum(['marketing', 'utility', 'authentication']),
            header: z.record(z.unknown()).nullable().optional(),
            body: z.string(),
            footer: z.string().nullable().optional(),
            buttons: z.array(z.record(z.unknown())).optional(),
            example_variables: z.array(z.unknown()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: Template })),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/whatsapp/templates/{id}',
  tags: ['WhatsApp'],
  summary: 'Update een draft template',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonResponse('OK', z.object({ data: Template })),
    409: { description: 'Template is al ingediend of goedgekeurd' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/whatsapp/templates/{id}',
  tags: ['WhatsApp'],
  summary: 'Verwijder een draft template',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 204: { description: 'Verwijderd' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/whatsapp/templates/{id}/submit',
  tags: ['WhatsApp'],
  summary: 'Dien template in bij Meta voor review',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonResponse('OK', z.object({ data: Template })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/whatsapp/templates/{id}/sync',
  tags: ['WhatsApp'],
  summary: 'Sync templatestatus opnieuw met 360dialog/Meta',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonResponse('OK', z.object({ data: Template })),
  },
});

// ───── Messages ────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/whatsapp/messages',
  tags: ['WhatsApp'],
  summary: 'Lijst WhatsApp-berichten (cursor-paginated)',
  security: authSecurity,
  request: {
    query: z.object({
      candidate_id: z.string().uuid().optional(),
      direction: directionEnum.optional(),
      status: messageStatusEnum.optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(WhatsAppMessage),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/whatsapp/messages/{id}',
  tags: ['WhatsApp'],
  summary: 'Haal één WhatsApp-bericht op',
  security: authSecurity,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonResponse('OK', z.object({ data: WhatsAppMessage })),
    404: { description: 'Bericht niet gevonden' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/whatsapp/messages',
  tags: ['WhatsApp'],
  summary: 'Verstuur een WhatsApp-bericht (text/template/media)',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            candidate_id: z.string().uuid(),
            kind: z.enum(['text', 'template', 'media']),
            body: z.string().optional(),
            template_id: z.string().uuid().optional(),
            variables: z.array(z.unknown()).optional(),
            media_url: z.string().url().optional(),
            media_type: z.enum(['image', 'video', 'document', 'audio']).optional(),
            caption: z.string().optional(),
            reply_to_id: z.string().uuid().optional(),
          }),
        },
      },
    },
  },
  responses: {
    202: jsonResponse('In de wachtrij', z.object({ data: WhatsAppMessage })),
    403: { description: 'Geen actieve WhatsApp-toestemming' },
    409: { description: 'Buiten 24h-venster — template vereist' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/whatsapp/conversations',
  tags: ['WhatsApp'],
  summary: 'Lijst gesprekken (gegroepeerd per conversation_id)',
  security: authSecurity,
  request: {
    query: z.object({ candidate_id: z.string().uuid().optional() }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(
          z.object({
            conversation_id: z.string(),
            candidate_id: z.string().uuid().nullable(),
            message_count: z.number(),
            last_message_at: z.string().datetime(),
            messages: z.array(WhatsAppMessage),
          })
        ),
      })
    ),
  },
});

// ───── Consents ────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/whatsapp/consents',
  tags: ['WhatsApp'],
  summary: 'Lijst WhatsApp-consents',
  security: authSecurity,
  request: {
    query: z.object({
      status: consentStatusEnum.optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(Consent),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/whatsapp/consents/{candidate_id}',
  tags: ['WhatsApp'],
  summary: 'Haal consentstatus van één kandidaat op',
  security: authSecurity,
  request: { params: z.object({ candidate_id: z.string().uuid() }) },
  responses: {
    200: jsonResponse('OK', z.object({ data: Consent.nullable() })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/whatsapp/consents/invite',
  tags: ['WhatsApp'],
  summary: 'Stuur een opt-in invitation token + URL voor een kandidaat',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            candidate_id: z.string().uuid(),
            phone_number: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse(
      'Aangemaakt',
      z.object({
        data: z.object({ token_url: z.string(), expires_at: z.string().datetime() }),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/whatsapp/consents/{candidate_id}/withdraw',
  tags: ['WhatsApp'],
  summary: 'Trek WhatsApp-consent in (recruiter-initiated)',
  security: authSecurity,
  request: {
    params: z.object({ candidate_id: z.string().uuid() }),
    body: {
      content: {
        'application/json': { schema: z.object({ reason: z.string() }) },
      },
    },
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: Consent })),
  },
});

// ───── Public opt-in ───────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/public/whatsapp/opt-in/{token}',
  tags: ['WhatsApp'],
  summary: 'Public landing — haal kandidaatnaam + telefoon op voor opt-in pagina',
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.object({
          candidate_name: z.string().nullable(),
          phone_number: z.string(),
        }),
      })
    ),
    404: { description: 'Token ongeldig of verlopen' },
    429: { description: 'Rate-limit' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/public/whatsapp/opt-in/{token}/accept',
  tags: ['WhatsApp'],
  summary: 'Public — bevestig opt-in (flipt consent naar granted, audit-log met IP+UA)',
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.object({
          status: consentStatusEnum,
          granted_at: z.string().datetime().nullable(),
        }),
      })
    ),
    429: { description: 'Rate-limit' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/public/whatsapp/opt-in/{token}/decline',
  tags: ['WhatsApp'],
  summary: 'Public — wijs opt-in af (geen state-wijziging; token blijft pending)',
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.object({ status: z.literal('declined') }),
      })
    ),
  },
});

// ───── Webhook ─────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/webhooks/whatsapp/{tenantSlug}',
  tags: ['WhatsApp'],
  summary:
    'Inbound 360dialog webhook — geverifieerd via X-Hub-Signature-256, idempotent op external_id',
  request: { params: z.object({ tenantSlug: z.string() }) },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.object({
          messages: z.number(),
          statuses: z.number(),
          dupes: z.number(),
        }),
      })
    ),
    401: { description: 'Invalid signature' },
    404: { description: 'Tenant niet gevonden' },
  },
});

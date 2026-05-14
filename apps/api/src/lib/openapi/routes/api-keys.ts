/**
 * API Keys route-specs — `/api/api-keys/*`.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

const ApiKey = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    name: z.string(),
    permissions: z.array(z.string()),
    last_used_at: z.string().datetime().nullable(),
    created_by: z.string().uuid(),
    created_at: z.string().datetime(),
    revoked_at: z.string().datetime().nullable(),
  })
  .openapi('ApiKey');

const ApiKeyWithSecret = ApiKey.extend({
  key: z.string().openapi({
    description: 'Plaintext API-key. Wordt ALLEEN bij creatie gereturned — bewaar veilig.',
    example: 'tf_live_AbCdEf123456...',
  }),
}).openapi('ApiKeyWithSecret');

registry.registerPath({
  method: 'get',
  path: '/api/api-keys',
  tags: ['API Keys'],
  summary: 'List API keys (zonder secret)',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(ApiKey)) },
});

registry.registerPath({
  method: 'post',
  path: '/api/api-keys',
  tags: ['API Keys'],
  summary: 'Create API key',
  description: 'Returnt eenmalig de plaintext key. Daarna alleen hashed.',
  security: authSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(200),
            permissions: z.array(z.string()).default([]),
          }),
        },
      },
    },
  },
  responses: { 201: jsonResponse('Aangemaakt', ApiKeyWithSecret) },
});

registry.registerPath({
  method: 'delete',
  path: '/api/api-keys/{id}',
  tags: ['API Keys'],
  summary: 'Revoke API key',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('Ingetrokken', z.object({ message: z.string() })) },
});

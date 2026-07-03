/**
 * Auth route-specs — `/api/auth/*`.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { ErrorResponse, jsonResponse, standardErrorResponses } from '../common';

const UserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: z.enum(['owner', 'admin', 'recruiter', 'hiring_manager', 'viewer']),
    tenant_id: z.string().uuid(),
    tenant_slug: z.string(),
    created_at: z.string().datetime(),
  })
  .openapi('User');

const LoginRequest = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
    tenantSlug: z.string().min(1).openapi({ example: 'acme' }),
  })
  .openapi('LoginRequest');

const LoginResponse = z
  .object({
    accessToken: z.string().openapi({ example: 'eyJhbGciOi...' }),
    user: UserSchema,
  })
  .openapi('LoginResponse');

const RegisterRequest = z
  .object({
    tenantName: z.string().min(2).max(100).openapi({ example: 'Acme Recruitment' }),
    tenantSlug: z
      .string()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9-]+$/)
      .openapi({ example: 'acme' }),
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1).max(100),
  })
  .openapi('RegisterRequest');

const RefreshResponse = z
  .object({
    accessToken: z.string(),
  })
  .openapi('RefreshResponse');

const MessageResponse = z.object({ message: z.string() }).openapi('MessageResponse');

// ─── Routes ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/auth/register',
  tags: ['Authentication'],
  summary: 'Register a new tenant + owner-user',
  description:
    'Maakt tenant + eerste owner-user aan. Returns access-token + user. Refresh-token wordt als httpOnly-cookie gezet.',
  request: {
    body: {
      content: { 'application/json': { schema: RegisterRequest } },
    },
  },
  responses: {
    201: jsonResponse('Tenant + user aangemaakt', LoginResponse),
    400: standardErrorResponses[400],
    409: jsonResponse('Tenant slug of e-mail al in gebruik', ErrorResponse),
    429: standardErrorResponses[429],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  tags: ['Authentication'],
  summary: 'Authenticate user',
  description:
    'Wisselt email+password+tenantSlug in voor een access-token (15min) + refresh-token (httpOnly-cookie, 7 dagen).',
  request: {
    body: {
      content: { 'application/json': { schema: LoginRequest } },
    },
  },
  responses: {
    200: jsonResponse('Login succesvol', LoginResponse),
    401: jsonResponse('Ongeldige credentials', ErrorResponse),
    429: standardErrorResponses[429],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/refresh',
  tags: ['Authentication'],
  summary: 'Refresh access token',
  description:
    'Genereert nieuwe access-token op basis van de refresh-token cookie. Cookie wordt geroteerd.',
  responses: {
    200: jsonResponse('Nieuwe access-token', RefreshResponse),
    401: jsonResponse('Refresh-token ontbreekt of ongeldig', ErrorResponse),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  tags: ['Authentication'],
  summary: 'Logout',
  description: 'Invalideert refresh-token + clearcookie.',
  responses: {
    200: jsonResponse('Uitgelogd', MessageResponse),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/forgot-password',
  tags: ['Authentication'],
  summary: 'Request password reset',
  description:
    'Stuurt reset-mail indien account bestaat. Antwoord is altijd 200 om enumeratie te voorkomen.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string().email(),
            tenantSlug: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse('Mail verstuurd (als account bestaat)', MessageResponse),
    429: standardErrorResponses[429],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/reset-password',
  tags: ['Authentication'],
  summary: 'Reset password with token',
  description:
    'Zet een nieuw wachtwoord via een reset-token uit de mail. Token is single-use en ' +
    'verloopt na 1 uur; alle bestaande sessies worden ingetrokken. Geen auto-login.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            token: z.string().min(20),
            password: z.string().min(8),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse('Wachtwoord opnieuw ingesteld', MessageResponse),
    404: standardErrorResponses[404],
    409: standardErrorResponses[409],
    410: standardErrorResponses[410],
    429: standardErrorResponses[429],
  },
});

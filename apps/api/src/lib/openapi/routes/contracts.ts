/**
 * OpenAPI route specs voor `/api/contracts/*` — Sprint Q4.4 (Agent TTT).
 *
 * Tag: `Contracts`. Pragmatische schemas — `z.unknown()` voor zwaar geneste
 * velden zodat de spec compact blijft.
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

const contractTypeEnum = z.enum(['temp', 'contract', 'permanent', 'freelance']);
const contractStatusEnum = z.enum([
  'draft',
  'active',
  'ended',
  'terminated',
  'renewed',
]);

const Contract = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    candidate_id: z.string().uuid(),
    application_id: z.string().uuid().nullable(),
    client_organization_id: z.string().uuid().nullable(),
    job_id: z.string().uuid().nullable(),
    contract_type: contractTypeEnum,
    status: contractStatusEnum,
    start_date: z.string(),
    end_date: z.string().nullable(),
    weekly_hours: z.number().nullable(),
    hourly_rate_candidate: z.number().nullable(),
    hourly_rate_client: z.number().nullable(),
    margin_percent: z.number().nullable(),
    currency: z.string(),
    cao: z.string().nullable(),
    wtza_compliant: z.boolean().nullable(),
    metadata: z.record(z.unknown()),
    signed_at: z.string().datetime().nullable(),
    terminated_at: z.string().datetime().nullable(),
    termination_reason: z.string().nullable(),
    created_by: z.string().uuid().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi('Contract');

const ContractExtension = z
  .object({
    id: z.string().uuid(),
    contract_id: z.string().uuid(),
    previous_end_date: z.string(),
    new_end_date: z.string(),
    reason: z.string().nullable(),
    signed_at: z.string().datetime().nullable(),
    signed_by: z.string().uuid().nullable(),
    created_at: z.string().datetime(),
  })
  .openapi('ContractExtension');

const ContractNotification = z
  .object({
    id: z.string().uuid(),
    contract_id: z.string().uuid(),
    notification_type: z.enum([
      'expiring_30d',
      'expiring_14d',
      'expiring_7d',
      'ended',
    ]),
    scheduled_for: z.string(),
    sent_at: z.string().datetime().nullable(),
    recipients: z.array(z.unknown()),
    created_at: z.string().datetime(),
  })
  .openapi('ContractNotification');

const CreateContractBody = z
  .object({
    candidate_id: z.string().uuid(),
    application_id: z.string().uuid().nullable().optional(),
    client_organization_id: z.string().uuid().nullable().optional(),
    job_id: z.string().uuid().nullable().optional(),
    contract_type: contractTypeEnum.optional(),
    status: contractStatusEnum.optional(),
    start_date: z.string(),
    end_date: z.string().nullable().optional(),
    weekly_hours: z.number().min(0).max(168).nullable().optional(),
    hourly_rate_candidate: z.number().nonnegative().nullable().optional(),
    hourly_rate_client: z.number().nonnegative().nullable().optional(),
    currency: z.string().length(3).optional(),
    cao: z.string().nullable().optional(),
    wtza_compliant: z.boolean().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
    signed_at: z.string().datetime().nullable().optional(),
  })
  .openapi('CreateContractBody');

const UpdateContractBody = CreateContractBody.partial().openapi(
  'UpdateContractBody'
);

const ExtendBody = z
  .object({
    new_end_date: z.string(),
    reason: z.string().nullable().optional(),
  })
  .openapi('ExtendContractBody');

const TerminateBody = z
  .object({
    reason: z.string(),
    effective_date: z.string().nullable().optional(),
  })
  .openapi('TerminateContractBody');

// ───────────────────────────────────────────────────────────────────────────
// Path operations
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/contracts',
  tags: ['Contracts'],
  summary: 'List contracts (paginated cursor)',
  security: authSecurity,
  request: {
    query: z.object({
      status: contractStatusEnum.optional(),
      candidate_id: z.string().uuid().optional(),
      job_id: z.string().uuid().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.array(Contract),
        next_cursor: z.string().nullable(),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/contracts',
  tags: ['Contracts'],
  summary: 'Create a new contract',
  security: authSecurity,
  request: {
    body: { content: { 'application/json': { schema: CreateContractBody } } },
  },
  responses: {
    201: jsonResponse('Aangemaakt', z.object({ data: Contract })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/contracts/{id}',
  tags: ['Contracts'],
  summary: 'Get a contract (incl. extensions)',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: Contract.extend({ extensions: z.array(ContractExtension) }),
      })
    ),
    404: { description: 'Niet gevonden' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/contracts/{id}',
  tags: ['Contracts'],
  summary: 'Update a contract',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: UpdateContractBody } } },
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: Contract })),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/contracts/{id}/extend',
  tags: ['Contracts'],
  summary: 'Extend a contract — inserts contract_extensions row',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: ExtendBody } } },
  },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({
        data: z.object({ contract: Contract, extension: ContractExtension }),
      })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/contracts/{id}/terminate',
  tags: ['Contracts'],
  summary: 'Terminate a contract — cancels pending notifications',
  security: authSecurity,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: TerminateBody } } },
  },
  responses: {
    200: jsonResponse('OK', z.object({ data: Contract })),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/contracts/{id}/notifications',
  tags: ['Contracts'],
  summary: 'List expiry notification queue rows',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({ data: z.array(ContractNotification) })
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/contracts/{id}/notifications/schedule',
  tags: ['Contracts'],
  summary: 'Schedule expiry notifications (idempotent)',
  security: authSecurity,
  request: { params: idParam },
  responses: {
    200: jsonResponse(
      'OK',
      z.object({ data: z.array(ContractNotification) })
    ),
  },
});

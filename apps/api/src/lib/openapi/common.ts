/**
 * Gedeelde zod-schemas + response-helpers voor OpenAPI route-specs.
 *
 * Sprint Q4.1 — Agent KKK.
 *
 * Houdt route-files DRY: dezelfde error-shape, paginatie en uuid-param hoeven
 * niet per file opnieuw gedefinieerd te worden.
 */

import { z } from 'zod';

// ─── Reusable primitives ────────────────────────────────────────────────────

export const uuidSchema = z.string().uuid().openapi({
  example: '00000000-0000-0000-0000-000000000000',
});

export const idParam = z.object({
  id: uuidSchema,
});

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
  limit: z.coerce.number().int().min(1).max(200).default(50).openapi({ example: 50 }),
});

export const paginationResponse = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
});

// ─── Standaard error-shape (apps/api errorHandler) ─────────────────────────

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_FAILED' }),
      message: z.string().openapi({ example: 'Validatie mislukt' }),
      details: z.record(z.unknown()).optional(),
    }),
  })
  .openapi('ErrorResponse');

// ─── Standaard responses voor reuse ─────────────────────────────────────────

export const standardErrorResponses = {
  400: {
    description: 'Bad Request — validatie mislukt',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  401: {
    description: 'Unauthorized — geen of ongeldige JWT/API-key',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  403: {
    description: 'Forbidden — onvoldoende rol/permissions',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  404: {
    description: 'Not Found',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  429: {
    description: 'Rate limit exceeded — zie `Retry-After`-header',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  500: {
    description: 'Internal Server Error',
    content: { 'application/json': { schema: ErrorResponse } },
  },
};

// ─── Authenticated security default ─────────────────────────────────────────
// Een endpoint dat zowel JWT als API-key accepteert. We typen dit expliciet
// als `Record<string, string[]>[]` zodat zod-to-openapi het accepteert
// (SecurityRequirementObject is een index-signature type).

export const authSecurity: Record<string, string[]>[] = [
  { bearerAuth: [] },
  { apiKey: [] },
];

// ─── Helper: JSON response builder ──────────────────────────────────────────

export function jsonResponse(description: string, schema: z.ZodTypeAny) {
  return {
    description,
    content: { 'application/json': { schema } },
  };
}

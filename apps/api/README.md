# @talentflow/api

Express + TypeScript backend for TalentFlow.

## Local development

```bash
npm install
npm run dev          # tsx watch on port 4000
npm test             # vitest run
npm run test:coverage
```

Required env-vars (see `.env.example` of the project root):

- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` / `JWT_REFRESH_SECRET` — 64-char random strings
- `REDIS_URL`
- `ANTHROPIC_API_KEY` (optional — falls back to OpenAI when set)
- `OPENAI_API_KEY` (optional — used for embeddings + fallback LLM)

## API Documentation

OpenAPI 3.1 spec is auto-generated from zod schemas via `@asteasolutions/zod-to-openapi`:

| Resource | URL |
|---|---|
| Swagger UI (interactive) | `https://api.talentflow.app/api-docs` |
| OpenAPI JSON | `https://api.talentflow.app/api-docs/openapi.json` |
| Postman Collection 2.1 | `https://api.talentflow.app/api-docs/postman.json` |

### Pillar 3 — Open API on every plan

The API is an explicit differentiator vs Manatal: no feature gating on access.
The OpenAPI document is therefore mounted publicly (no auth) on every
environment — anyone can inspect the surface area without being a tenant.

Authentication for actual API calls uses two schemes:

- `bearerAuth` (JWT) — recruiter session token from `POST /api/auth/login`.
- `apiKey` (`X-API-Key` header) — tenant-scoped API key managed via
  `/api/api-keys`. Open on every plan, no per-feature paywall.

### Extending the spec

Each module registers its endpoints in
`apps/api/src/lib/openapi/routes/<module>.ts`. To add a new endpoint:

1. Open (or create) the module's route-spec file.
2. Define your zod schemas (or import from the existing `<module>.schema.ts`).
3. Call `registry.registerPath({ method, path, tags, summary, request, responses })`.
4. Run `npm test -- openapi` — the test suite asserts every operation has
   summary + tags + responses + a declared root tag.

Webhook event-payloads live in `routes/webhooks.ts` and mirror the audit-action
constants in `apps/api/src/lib/auditActions.ts`.

### Contracts

- All authenticated endpoints accept either `Authorization: Bearer <jwt>` OR
  `X-API-Key: <key>` — the middleware tries both.
- Error shape across the API is `{ error: { code, message, details? } }`.
- Pagination shape: `{ data: [...], pagination: { page, limit, total } }`.

## Deployment

Built via `npm run build` (tsc → `dist/`), deployed via Docker on Hetzner VPS
behind nginx + Let's Encrypt. PM2 keeps the process alive. See `docs/deploy.md`.

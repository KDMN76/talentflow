# TalentFlow API — Build Status

## Phase 1 Complete

`npx tsc --noEmit` → **0 errors**

---

## What was built

### Infrastructure
- `package.json` — all Phase 1 dependencies pinned
- `tsconfig.json` — strict TypeScript, ES2022, commonjs
- `.env.example` — all required environment variables documented
- `migrations/001_init.sql` — idempotent schema: tenants, users, refresh_tokens, candidates, jobs, pipeline_stages, applications, activities. RLS policies via DO $$ blocks (compatible with older PG).

### Database layer (`src/db/`)
- `pool.ts` — pg Pool with `withTenant(tenantId, fn)` (UUID-validated before SET) and `withoutTenant(fn)` for auth flows
- `migrate.ts` — auto-migration runner with `schema_migrations` tracking table

### Middleware (`src/middleware/`)
- `auth.ts` — JWT Bearer verification, `requireAuth`, `requireRole(...roles)`, typed JwtPayload on `req.user`
- `tenant.ts` — validates tenant context is present after requireAuth
- `rateLimit.ts` — Redis-backed express-rate-limit: 200 req/15min general, 10 req/15min auth
- `errorHandler.ts` — Winston logger, `AppError` class, standardized `{ error: { code, message, details } }` JSON format

### Modules

#### Auth (`/api/auth`)
- `POST /register` — creates tenant + admin user, returns JWT pair + sets httpOnly refreshToken cookie
- `POST /login` — verifies credentials by tenantSlug + email, returns JWT pair
- `POST /refresh` — exchanges cookie refresh token for new access token
- `POST /logout` — invalidates refresh token from DB, clears cookie
- `POST /forgot-password` — stub (200 always, queues email, prevents enumeration)

#### Tenants (`/api/tenants`)
- `GET /current` — returns current tenant info from JWT tenantId
- `PATCH /current` — admin-only tenant settings update

#### Users (`/api/users`)
- `GET /` — admin-only paginated list
- `POST /invite` — create inactive user + queue invitation email stub
- `PATCH /:id` — update role/name (admins can change role; users can only update themselves)
- `DELETE /:id` — soft deactivate, invalidates all refresh tokens
- `GET /me` — current user profile
- `PATCH /me` — update own name/avatar/password

#### Candidates (`/api/candidates`)
- `GET /` — paginated list with filters: search (name/email), skills[], tags[], source
- `POST /` — create candidate
- `GET /:id` — candidate detail + associated applications
- `PATCH /:id` — update candidate fields
- `DELETE /:id` — soft delete (deleted_at)
- `POST /:id/resume` — multer upload (PDF/DOCX, 10MB max) → stores file, queues async parse job
- `GET /:id/timeline` — activity log for candidate

#### Jobs (`/api/jobs`)
- `GET /` — paginated list with status/recruiter filters, includes application_count
- `POST /` — create job + auto-create 5 default pipeline stages
- `GET /:id` — job detail with stages and per-stage application counts
- `PATCH /:id` — update job fields
- `DELETE /:id` — soft delete
- `POST /:id/duplicate` — clone job + pipeline stages (status resets to draft)
- `GET /:id/stats` — byStage counts, byStatus counts, weekly/monthly totals

#### Pipeline (`/api/pipeline`)
- `GET /jobs/:jobId/stages` — stages with application counts
- `POST /jobs/:jobId/stages` — add stage (auto-assigns next position)
- `PATCH /stages/:stageId` — update name/color/position
- `DELETE /stages/:stageId` — delete stage, moves applications to previous stage
- `GET /jobs/:jobId/applications` — grouped by stage with candidate detail
- `POST /applications` — add candidate to job (uses first stage by default)
- `PATCH /applications/:id` — move stage / change status
- `DELETE /applications/:id` — remove from pipeline

#### Dashboard (`/api/dashboard`)
- `GET /stats` — openJobs, candidatesThisMonth, applicationsThisWeek, hiredThisMonth, recentActivity (20), topJobs (5)

### Queue (`src/queue/`)
- `queues.ts` — BullMQ queues: `resume-parser`, `email-sender` with exponential backoff
- `workers/resumeParser.worker.ts` — parses PDF (pdf-parse) and DOCX (mammoth), extracts 60+ tech skill keywords, updates candidate
- `workers/emailSender.worker.ts` — Phase 1 stub: logs email, ready for SendGrid/SES integration

---

## Known Limitations / Phase 2 Work

1. **Email sending** is stubbed — `emailSenderWorker` logs emails but does not send them. Integration with SendGrid/Resend needed.
2. **File storage** uses local disk (`uploads/resumes/`). Phase 2 should upload to S3/R3 and store CDN URLs.
3. **Password reset** is stubbed — forgot-password queues an email but no token/link is generated.
4. **User invitation** creates a user with a random temp password logged in the email stub. Phase 2 needs a proper invite token flow.
5. **AI scoring** (`ai_score`) field exists and is writable but no scoring algorithm runs. Phase 2 can add LLM-based scoring on resume parse.
6. **Super admin** role has no cross-tenant operations exposed yet — it is validated in guards but the tenant-level RLS means super_admin still only sees their tenant data through normal routes.
7. **multer v1** is in use (v2 is breaking change) — the deprecation warning is expected. Upgrade requires API changes.
8. **Refresh token rotation** is not implemented — each login issues a new token but old ones aren't rotated/revoked on use. Add rotation in Phase 2.

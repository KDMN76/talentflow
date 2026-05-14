/**
 * Sourcing-agent HTTP routes — Sprint Q4.5 (Agent WWW).
 *
 * Mount path: `/api/sourcing` (zie src/index.ts).
 *
 * Alle routes vereisen JWT (`requireAuth`) + tenant-context (`tenantMiddleware`).
 * Validatie via zod. Audit-events worden door de service-laag geschreven.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { auditCtxFromReq } from '../../lib/audit';
import {
  createBriefSchema,
  updateBriefSchema,
  createBrief,
  getBrief,
  listBriefs,
  updateBrief,
  archiveBrief,
} from './brief.service';
import {
  enqueueRun,
  getRun,
  listRuns,
  cancelRun,
  listFindings,
  approveFinding,
  rejectFinding,
  bulkApprove,
  bulkReject,
  listActionsForRun,
  listMemory,
  upsertMemory,
  deleteMemory,
} from './runs.service';

const router = Router();
router.use(requireAuth, tenantMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() });
const runIdParam = z.object({ runId: z.string().uuid() });
const briefIdParam = z.object({ id: z.string().uuid() });
const findingIdParam = z.object({ id: z.string().uuid() });
const memoryIdParam = z.object({ id: z.string().uuid() });

const listBriefsQuery = z.object({
  job_id: z.string().uuid().optional(),
  active: z.enum(['true', 'false']).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const triggerRunBody = z.object({
  trigger: z.enum(['manual', 'scheduled', 'reactivation', 'expansion']).optional(),
});

const listRunsQuery = z.object({
  status: z.enum(['queued', 'running', 'review_required', 'completed', 'failed', 'cancelled']).optional(),
  brief_id: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const listFindingsQuery = z.object({
  status: z.enum(['pending_review', 'approved', 'rejected', 'contacted', 'dismissed']).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const approveBody = z.object({
  note: z.string().max(2000).nullable().optional(),
});

const rejectBody = z.object({
  reason: z.string().min(1).max(2000),
});

const bulkApproveBody = z.object({
  finding_ids: z.array(z.string().uuid()).min(1).max(500),
});

const bulkRejectBody = z.object({
  finding_ids: z.array(z.string().uuid()).min(1).max(500),
  reason: z.string().max(2000).optional(),
});

const memoryListQuery = z.object({
  scope: z.enum(['tenant', 'recruiter', 'brief']).optional(),
  scope_id: z.string().uuid().optional(),
});

const memoryUpsertBody = z.object({
  scope: z.enum(['tenant', 'recruiter', 'brief']),
  scope_id: z.string().uuid().nullable().optional(),
  key: z.string().min(1).max(120),
  value: z.unknown(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Briefs
// ─────────────────────────────────────────────────────────────────────────────

router.get('/briefs', async (req, res, next) => {
  try {
    const q = listBriefsQuery.parse(req.query);
    const result = await listBriefs(req.user!.tenantId, {
      job_id: q.job_id,
      active: q.active === undefined ? undefined : q.active === 'true',
      cursor: q.cursor ?? null,
      limit: q.limit,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/briefs', async (req, res, next) => {
  try {
    const body = createBriefSchema.parse(req.body);
    const brief = await createBrief(
      req.user!.tenantId,
      body,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.status(201).json({ data: brief });
  } catch (err) { next(err); }
});

router.get('/briefs/:id', async (req, res, next) => {
  try {
    const { id } = briefIdParam.parse(req.params);
    const brief = await getBrief(req.user!.tenantId, id);
    res.json({ data: brief });
  } catch (err) { next(err); }
});

router.patch('/briefs/:id', async (req, res, next) => {
  try {
    const { id } = briefIdParam.parse(req.params);
    const body = updateBriefSchema.parse(req.body);
    const brief = await updateBrief(
      req.user!.tenantId,
      id,
      body,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ data: brief });
  } catch (err) { next(err); }
});

router.post('/briefs/:id/archive', async (req, res, next) => {
  try {
    const { id } = briefIdParam.parse(req.params);
    const brief = await archiveBrief(
      req.user!.tenantId,
      id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ data: brief });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Runs
// ─────────────────────────────────────────────────────────────────────────────

router.post('/briefs/:id/runs', async (req, res, next) => {
  try {
    const { id } = briefIdParam.parse(req.params);
    const body = triggerRunBody.parse(req.body ?? {});
    const run = await enqueueRun(
      req.user!.tenantId,
      id,
      body.trigger ?? 'manual',
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.status(202).json({ data: run });
  } catch (err) { next(err); }
});

router.get('/runs', async (req, res, next) => {
  try {
    const q = listRunsQuery.parse(req.query);
    const result = await listRuns(req.user!.tenantId, {
      status: q.status,
      brief_id: q.brief_id,
      cursor: q.cursor ?? null,
      limit: q.limit,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/runs/:runId', async (req, res, next) => {
  try {
    const { runId } = runIdParam.parse(req.params);
    const run = await getRun(req.user!.tenantId, runId);
    const actions = await listActionsForRun(req.user!.tenantId, runId, 100);
    res.json({ data: run, actions });
  } catch (err) { next(err); }
});

router.post('/runs/:runId/cancel', async (req, res, next) => {
  try {
    const { runId } = runIdParam.parse(req.params);
    const run = await cancelRun(
      req.user!.tenantId,
      runId,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ data: run });
  } catch (err) { next(err); }
});

router.get('/runs/:runId/findings', async (req, res, next) => {
  try {
    const { runId } = runIdParam.parse(req.params);
    const q = listFindingsQuery.parse(req.query);
    const result = await listFindings(req.user!.tenantId, {
      run_id: runId,
      status: q.status,
      cursor: q.cursor ?? null,
      limit: q.limit,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Findings (cross-run)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/findings/:id/approve', async (req, res, next) => {
  try {
    const { id } = findingIdParam.parse(req.params);
    const body = approveBody.parse(req.body ?? {});
    const finding = await approveFinding(
      req.user!.tenantId,
      id,
      req.user!.userId,
      body.note ?? null,
      auditCtxFromReq(req)
    );
    res.json({ data: finding });
  } catch (err) { next(err); }
});

router.post('/findings/:id/reject', async (req, res, next) => {
  try {
    const { id } = findingIdParam.parse(req.params);
    const body = rejectBody.parse(req.body);
    const finding = await rejectFinding(
      req.user!.tenantId,
      id,
      body.reason,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ data: finding });
  } catch (err) { next(err); }
});

router.post('/findings/bulk-approve', async (req, res, next) => {
  try {
    const body = bulkApproveBody.parse(req.body);
    const result = await bulkApprove(
      req.user!.tenantId,
      body.finding_ids,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ data: result });
  } catch (err) { next(err); }
});

router.post('/findings/bulk-reject', async (req, res, next) => {
  try {
    const body = bulkRejectBody.parse(req.body);
    const result = await bulkReject(
      req.user!.tenantId,
      body.finding_ids,
      body.reason ?? 'Bulk reject',
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ data: result });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Memory
// ─────────────────────────────────────────────────────────────────────────────

router.get('/memory', async (req, res, next) => {
  try {
    const q = memoryListQuery.parse(req.query);
    const data = await listMemory(req.user!.tenantId, q.scope, q.scope_id ?? undefined);
    res.json({ data });
  } catch (err) { next(err); }
});

router.put('/memory', async (req, res, next) => {
  try {
    const body = memoryUpsertBody.parse(req.body);
    const data = await upsertMemory(
      req.user!.tenantId,
      body.scope,
      body.scope_id ?? null,
      body.key,
      body.value
    );
    res.json({ data });
  } catch (err) { next(err); }
});

router.delete('/memory/:id', async (req, res, next) => {
  try {
    const { id } = memoryIdParam.parse(req.params);
    await deleteMemory(req.user!.tenantId, id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit timeline (read-only)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/actions/:runId', async (req, res, next) => {
  try {
    const { runId } = runIdParam.parse(req.params);
    const data = await listActionsForRun(req.user!.tenantId, runId, 500);
    res.json({ data });
  } catch (err) { next(err); }
});

export default router;

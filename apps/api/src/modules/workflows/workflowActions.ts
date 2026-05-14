import { PoolClient } from 'pg';
import axios from 'axios';
import { logger } from '../../middleware/errorHandler';
import { emailSenderQueue } from '../../queue/queues';
import { applyMergeVars } from '../../lib/mergeVariables';
import type { WorkflowAction } from './workflows.service';

// ─────────────────────────────────────────────────────────────────────────────
// Action context — passed to every executor.
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowActionContext {
  /** PoolClient inside the same `withTenant` transaction the workflow runner opened. */
  client: PoolClient;
  tenantId: string;
  /** The trigger event name, e.g. `candidate.created`. */
  event: string;
  /**
   * Semantics of `entityId` depend on the trigger event:
   *  - `candidate.*` events    → candidate id
   *  - `job.*` events          → job id
   *  - `candidate.stage_changed` (pipeline) → application id
   *
   * Each executor that cares unwraps it accordingly.
   */
  entityId: string;
  /** Free-form payload provided by the emitter — already JSON-safe. */
  payload: Record<string, unknown>;
  /** User that initiated the trigger, or `null` for system-driven events. */
  userId?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Read a `name.field` path off `{ candidate, job, tenant, ... }`. Used for
 * resolving `to_field` strings like `'candidate.email'`. */
function resolveDotPath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = root;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

async function loadCandidate(client: PoolClient, tenantId: string, candidateId: string) {
  const { rows: [row] } = await client.query(
    `SELECT * FROM candidates
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [candidateId, tenantId]
  );
  return row ?? null;
}

async function loadJob(client: PoolClient, tenantId: string, jobId: string) {
  const { rows: [row] } = await client.query(
    `SELECT * FROM jobs
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [jobId, tenantId]
  );
  return row ?? null;
}

async function loadTenant(client: PoolClient, tenantId: string) {
  const { rows: [row] } = await client.query(
    `SELECT id, name, slug, plan, settings FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return row ?? null;
}

async function loadApplication(client: PoolClient, tenantId: string, applicationId: string) {
  const { rows: [row] } = await client.query(
    `SELECT a.*, c.name as candidate_name, c.email as candidate_email,
            j.title as job_title
     FROM applications a
     JOIN candidates c ON c.id = a.candidate_id
     JOIN jobs j       ON j.id = a.job_id
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [applicationId, tenantId]
  );
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// send_email
// ─────────────────────────────────────────────────────────────────────────────

async function executeSendEmail(action: WorkflowAction, ctx: WorkflowActionContext): Promise<void> {
  const templateId = action.config.template_id;
  if (!templateId) {
    throw new Error('send_email action missing config.template_id');
  }
  const toField = action.config.to_field || 'candidate.email';

  // Hydrate context based on which entity this trigger refers to.
  let candidate: Record<string, unknown> | null = null;
  let job: Record<string, unknown> | null = null;

  if (ctx.event.startsWith('candidate.')) {
    if (ctx.event === 'candidate.stage_changed') {
      // entityId is application_id — derive candidate + job via the app.
      const app = await loadApplication(ctx.client, ctx.tenantId, ctx.entityId);
      if (app) {
        candidate = await loadCandidate(ctx.client, ctx.tenantId, app.candidate_id as string);
        job = await loadJob(ctx.client, ctx.tenantId, app.job_id as string);
      }
    } else {
      candidate = await loadCandidate(ctx.client, ctx.tenantId, ctx.entityId);
      // Also pull job from payload if emitter provided it.
      const payloadJobId = (ctx.payload as Record<string, unknown>).job_id;
      if (typeof payloadJobId === 'string') {
        job = await loadJob(ctx.client, ctx.tenantId, payloadJobId);
      }
    }
  } else if (ctx.event.startsWith('job.')) {
    job = await loadJob(ctx.client, ctx.tenantId, ctx.entityId);
    const payloadCandidateId = (ctx.payload as Record<string, unknown>).candidate_id;
    if (typeof payloadCandidateId === 'string') {
      candidate = await loadCandidate(ctx.client, ctx.tenantId, payloadCandidateId);
    }
  }

  const tenant = await loadTenant(ctx.client, ctx.tenantId);

  // Lookup email template (created by Agent M's migration 004).
  const { rows: [template] } = await ctx.client.query(
    `SELECT id, subject, body_html, body_text
     FROM email_templates
     WHERE id = $1 AND tenant_id = $2`,
    [templateId, ctx.tenantId]
  );
  if (!template) {
    throw new Error(`email template ${templateId} not found for tenant`);
  }

  // Resolve recipient via dot-path. Default `candidate.email`.
  const renderCtx: Record<string, unknown> = {
    candidate: candidate ?? {},
    job: job ?? {},
    tenant: tenant ?? {},
    payload: ctx.payload,
  };
  const recipient = resolveDotPath(renderCtx, toField);
  if (typeof recipient !== 'string' || !recipient.includes('@')) {
    throw new Error(`send_email: could not resolve recipient via to_field="${toField}"`);
  }

  // Render via Agent M's mergeVariables helper.
  const subject = applyMergeVars(template.subject ?? '', renderCtx);
  const bodyHtml = applyMergeVars(template.body_html ?? '', renderCtx);
  const bodyText = template.body_text ? applyMergeVars(template.body_text, renderCtx) : undefined;

  // Hand off to the email worker (Agent M's contract).
  await emailSenderQueue.add('send-email', {
    tenantId: ctx.tenantId,
    candidateId: candidate?.id ?? null,
    templateId,
    to: recipient,
    subject,
    bodyHtml,
    bodyText,
    userId: ctx.userId ?? null,
  });

  logger.info('[workflowActions] send_email enqueued', {
    tenantId: ctx.tenantId,
    templateId,
    to: recipient,
    event: ctx.event,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// send_whatsapp / send_sms — parked per product memo. No-op + warn.
// ─────────────────────────────────────────────────────────────────────────────

async function executeParkedChannel(channel: string, ctx: WorkflowActionContext): Promise<void> {
  logger.warn(`[workflowActions] ${channel} action skipped (channel parked)`, {
    tenantId: ctx.tenantId,
    event: ctx.event,
    entityId: ctx.entityId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// add_tag / remove_tag — work on candidates only (entityId = candidate_id for
// `candidate.*` triggers). For other triggers we look up via payload.candidate_id.
// ─────────────────────────────────────────────────────────────────────────────

function resolveCandidateIdForTagOps(ctx: WorkflowActionContext): string | null {
  if (ctx.event.startsWith('candidate.')) {
    if (ctx.event === 'candidate.stage_changed') {
      const cid = (ctx.payload as Record<string, unknown>).candidate_id;
      return typeof cid === 'string' ? cid : null;
    }
    return ctx.entityId;
  }
  const cid = (ctx.payload as Record<string, unknown>).candidate_id;
  return typeof cid === 'string' ? cid : null;
}

async function executeAddTag(action: WorkflowAction, ctx: WorkflowActionContext): Promise<void> {
  const tag = action.config.tag;
  if (!tag) throw new Error('add_tag action missing config.tag');

  const candidateId = resolveCandidateIdForTagOps(ctx);
  if (!candidateId) {
    logger.warn('[workflowActions] add_tag: no candidate_id resolvable', {
      event: ctx.event,
      entityId: ctx.entityId,
    });
    return;
  }

  await ctx.client.query(
    `UPDATE candidates
     SET tags = array_append(tags, $1), updated_at = now()
     WHERE id = $2 AND tenant_id = $3 AND NOT (tags @> ARRAY[$1]::text[])`,
    [tag, candidateId, ctx.tenantId]
  );

  logger.info('[workflowActions] add_tag applied', { candidateId, tag });
}

async function executeRemoveTag(action: WorkflowAction, ctx: WorkflowActionContext): Promise<void> {
  const tag = action.config.tag;
  if (!tag) throw new Error('remove_tag action missing config.tag');

  const candidateId = resolveCandidateIdForTagOps(ctx);
  if (!candidateId) {
    logger.warn('[workflowActions] remove_tag: no candidate_id resolvable', {
      event: ctx.event,
      entityId: ctx.entityId,
    });
    return;
  }

  await ctx.client.query(
    `UPDATE candidates
     SET tags = array_remove(tags, $1), updated_at = now()
     WHERE id = $2 AND tenant_id = $3`,
    [tag, candidateId, ctx.tenantId]
  );

  logger.info('[workflowActions] remove_tag applied', { candidateId, tag });
}

// ─────────────────────────────────────────────────────────────────────────────
// move_to_stage — only meaningful for `candidate.stage_changed` (entityId =
// application_id). For other triggers, requires payload.application_id.
// ─────────────────────────────────────────────────────────────────────────────

async function executeMoveToStage(action: WorkflowAction, ctx: WorkflowActionContext): Promise<void> {
  const stageId = action.config.stage_id;
  const stageName = action.config.stage_name;
  if (!stageId && !stageName) {
    throw new Error('move_to_stage action requires config.stage_id or config.stage_name');
  }

  // Resolve applicationId. For the dedicated stage trigger, entityId IS the
  // application_id. For every other trigger we expect payload.application_id.
  let applicationId: string | null = null;
  if (ctx.event === 'candidate.stage_changed') {
    applicationId = ctx.entityId;
  } else {
    const aid = (ctx.payload as Record<string, unknown>).application_id;
    if (typeof aid === 'string') applicationId = aid;
  }

  if (!applicationId) {
    logger.warn('[workflowActions] move_to_stage: no application_id resolvable', {
      event: ctx.event,
      entityId: ctx.entityId,
    });
    return;
  }

  // Get the job_id for this application so we can scope stage_name lookup.
  const { rows: [app] } = await ctx.client.query(
    `SELECT id, job_id FROM applications WHERE id = $1 AND tenant_id = $2`,
    [applicationId, ctx.tenantId]
  );
  if (!app) {
    logger.warn('[workflowActions] move_to_stage: application not found', { applicationId });
    return;
  }

  let resolvedStageId = stageId;
  if (!resolvedStageId && stageName) {
    const { rows: [stage] } = await ctx.client.query(
      `SELECT id FROM pipeline_stages
       WHERE job_id = $1 AND tenant_id = $2 AND lower(name) = lower($3)
       LIMIT 1`,
      [app.job_id, ctx.tenantId, stageName]
    );
    if (!stage) {
      logger.warn('[workflowActions] move_to_stage: stage_name not found on job', {
        jobId: app.job_id,
        stageName,
      });
      return;
    }
    resolvedStageId = stage.id;
  }

  await ctx.client.query(
    `UPDATE applications
     SET stage_id = $1, updated_at = now()
     WHERE id = $2 AND tenant_id = $3`,
    [resolvedStageId, applicationId, ctx.tenantId]
  );

  logger.info('[workflowActions] move_to_stage applied', {
    applicationId,
    stageId: resolvedStageId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// create_task
// ─────────────────────────────────────────────────────────────────────────────

async function executeCreateTask(action: WorkflowAction, ctx: WorkflowActionContext): Promise<void> {
  const title = action.config.title;
  if (!title) throw new Error('create_task action missing config.title');

  const description = action.config.description ?? null;
  const dueInDaysRaw = action.config.due_in_days;
  let dueDate: string | null = null;
  if (dueInDaysRaw !== undefined && dueInDaysRaw !== '') {
    const n = Number(dueInDaysRaw);
    if (Number.isFinite(n)) {
      const due = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
      dueDate = due.toISOString();
    }
  }

  const assigneeId = action.config.assignee_id || ctx.userId || null;

  // Link to candidate / job based on the trigger semantics.
  let candidateId: string | null = null;
  let jobId: string | null = null;

  if (ctx.event.startsWith('candidate.')) {
    if (ctx.event === 'candidate.stage_changed') {
      const cid = (ctx.payload as Record<string, unknown>).candidate_id;
      const jid = (ctx.payload as Record<string, unknown>).job_id;
      if (typeof cid === 'string') candidateId = cid;
      if (typeof jid === 'string') jobId = jid;
    } else {
      candidateId = ctx.entityId;
    }
  } else if (ctx.event.startsWith('job.')) {
    jobId = ctx.entityId;
  }

  await ctx.client.query(
    `INSERT INTO tasks (tenant_id, title, description, assignee_id, candidate_id, job_id, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ctx.tenantId,
      title,
      description,
      assigneeId,
      candidateId,
      jobId,
      dueDate,
      ctx.userId ?? null,
    ]
  );

  logger.info('[workflowActions] create_task inserted', {
    tenantId: ctx.tenantId,
    title,
    assigneeId,
    candidateId,
    jobId,
    dueDate,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// trigger_webhook — fire-and-forget POST. Failures are logged but do NOT
// throw, so a flaky downstream URL doesn't fail the whole workflow run.
// ─────────────────────────────────────────────────────────────────────────────

async function executeTriggerWebhook(action: WorkflowAction, ctx: WorkflowActionContext): Promise<void> {
  const url = action.config.url;
  if (!url) {
    throw new Error('trigger_webhook action missing config.url');
  }

  try {
    await axios.post(
      url,
      {
        event: ctx.event,
        entityId: ctx.entityId,
        tenantId: ctx.tenantId,
        payload: ctx.payload,
      },
      {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
        // Treat any non-2xx as a logical "delivered to endpoint, endpoint chose to reject".
        validateStatus: () => true,
      }
    );
    logger.info('[workflowActions] trigger_webhook posted', {
      url,
      event: ctx.event,
      tenantId: ctx.tenantId,
    });
  } catch (err) {
    // Network / timeout errors — log and swallow.
    logger.warn('[workflowActions] trigger_webhook failed (logged, not retried)', {
      url,
      error: (err as Error).message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export async function executeAction(
  action: WorkflowAction,
  ctx: WorkflowActionContext
): Promise<void> {
  switch (action.type) {
    case 'send_email':
      return executeSendEmail(action, ctx);
    case 'send_whatsapp':
      return executeParkedChannel('send_whatsapp', ctx);
    case 'add_tag':
      return executeAddTag(action, ctx);
    case 'remove_tag':
      return executeRemoveTag(action, ctx);
    case 'move_to_stage':
      return executeMoveToStage(action, ctx);
    case 'create_task':
      return executeCreateTask(action, ctx);
    case 'trigger_webhook':
      return executeTriggerWebhook(action, ctx);
    default: {
      // Defensive: an unknown action type (e.g. `send_sms`) must not crash the
      // run. Log a warning and continue.
      const unknownType = (action as { type: string }).type;
      logger.warn('[workflowActions] Unknown action type — skipping', {
        actionType: unknownType,
        event: ctx.event,
      });
    }
  }
}

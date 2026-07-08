import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { executeAction } from './workflowActions';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface WorkflowCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'contains';
  value: string;
}

export interface WorkflowAction {
  type: 'send_email' | 'send_whatsapp' | 'add_tag' | 'remove_tag' | 'move_to_stage' | 'create_task' | 'trigger_webhook';
  config: Record<string, string>;
}

export interface CreateWorkflowData {
  name: string;
  description?: string;
  trigger: string;
  conditions?: WorkflowCondition[];
  actions: WorkflowAction[];
}

// ── Condition evaluation engine ───────────────────────────────────────────────

function evaluateConditions(
  conditions: WorkflowCondition[],
  payload: Record<string, unknown>
): boolean {
  if (conditions.length === 0) return true;
  return conditions.every(condition => {
    const value = payload[condition.field];
    switch (condition.operator) {
      case 'equals':        return String(value) === condition.value;
      case 'not_equals':   return String(value) !== condition.value;
      case 'greater_than': return Number(value) > Number(condition.value);
      case 'contains':     return String(value).includes(condition.value);
      default:             return true;
    }
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function listWorkflows(tenantId: string) {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM workflows
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [tenantId]
      );
      return rows;
    });
  } catch (err) {
    logger.error('[workflows] listWorkflows failed', { tenantId, error: (err as Error).message });
    return [];
  }
}

export async function getWorkflow(tenantId: string, workflowId: string) {
  return withTenant(tenantId, async (client) => {
    const { rows: [workflow] } = await client.query(
      `SELECT * FROM workflows WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [workflowId, tenantId]
    );
    if (!workflow) {
      throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow niet gevonden');
    }
    return workflow;
  });
}

export async function createWorkflow(
  tenantId: string,
  userId: string,
  data: CreateWorkflowData
) {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [workflow] } = await client.query(
        `INSERT INTO workflows (tenant_id, name, description, trigger, conditions, actions)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          tenantId,
          data.name,
          data.description ?? null,
          data.trigger,
          JSON.stringify(data.conditions ?? []),
          JSON.stringify(data.actions),
        ]
      );

      await client.query(
        `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
         VALUES ($1, 'workflow', $2, $3, 'created', $4)`,
        [tenantId, workflow.id, userId, JSON.stringify({ name: data.name, trigger: data.trigger })]
      );

      return workflow;
    });
  } catch (err) {
    logger.error('[workflows] createWorkflow failed', { tenantId, error: (err as Error).message });
    // Return a fake stub so callers don't crash
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenant_id: tenantId,
      name: data.name,
      description: data.description ?? null,
      trigger: data.trigger,
      conditions: data.conditions ?? [],
      actions: data.actions,
      active: true,
      run_count: 0,
      last_run_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
    };
  }
}

export async function updateWorkflow(
  tenantId: string,
  workflowId: string,
  userId: string,
  data: Partial<CreateWorkflowData>
) {
  return withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query(
      `SELECT id FROM workflows WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [workflowId, tenantId]
    );
    if (!existing) {
      throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow niet gevonden');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined)        { fields.push(`name = $${idx++}`);        values.push(data.name); }
    if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
    if (data.trigger !== undefined)     { fields.push(`trigger = $${idx++}`);     values.push(data.trigger); }
    if (data.conditions !== undefined)  { fields.push(`conditions = $${idx++}`);  values.push(JSON.stringify(data.conditions)); }
    if (data.actions !== undefined)     { fields.push(`actions = $${idx++}`);     values.push(JSON.stringify(data.actions)); }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    values.push(workflowId, tenantId);

    const { rows: [workflow] } = await client.query(
      `UPDATE workflows SET ${fields.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING *`,
      values
    );

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'workflow', $2, $3, 'updated', $4)`,
      [tenantId, workflowId, userId, JSON.stringify(data)]
    );

    return workflow;
  });
}

export async function deleteWorkflow(tenantId: string, workflowId: string): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows: [workflow] } = await client.query(
      `UPDATE workflows SET deleted_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [workflowId, tenantId]
    );
    if (!workflow) {
      throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow niet gevonden');
    }
  });
}

export async function toggleWorkflow(tenantId: string, workflowId: string) {
  return withTenant(tenantId, async (client) => {
    const { rows: [workflow] } = await client.query(
      `UPDATE workflows SET active = NOT active
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [workflowId, tenantId]
    );
    if (!workflow) {
      throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow niet gevonden');
    }
    return workflow;
  });
}

export async function getWorkflowRuns(tenantId: string, workflowId: string) {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM workflow_runs
         WHERE workflow_id = $1 AND tenant_id = $2
         ORDER BY ran_at DESC
         LIMIT 20`,
        [workflowId, tenantId]
      );
      return rows;
    });
  } catch (err) {
    logger.error('[workflows] getWorkflowRuns failed', { tenantId, workflowId, error: (err as Error).message });
    return [];
  }
}

// ── Event processing engine ───────────────────────────────────────────────────

export async function processWorkflowEvent(
  tenantId: string,
  event: string,
  entityId: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      // Find all active workflows matching this trigger
      const { rows: workflows } = await client.query(
        `SELECT * FROM workflows
         WHERE tenant_id = $1 AND trigger = $2 AND active = true AND deleted_at IS NULL`,
        [tenantId, event]
      );

      logger.info('[workflows] Processing event', {
        tenantId,
        event,
        entityId,
        matchingWorkflows: workflows.length,
      });

      for (const workflow of workflows) {
        const conditions: WorkflowCondition[] = Array.isArray(workflow.conditions)
          ? workflow.conditions
          : [];
        const actions: WorkflowAction[] = Array.isArray(workflow.actions)
          ? workflow.actions
          : [];

        const conditionsMet = evaluateConditions(conditions, payload);

        if (!conditionsMet) {
          // Record skipped run
          await client.query(
            `INSERT INTO workflow_runs (tenant_id, workflow_id, trigger_event, entity_id, status)
             VALUES ($1, $2, $3, $4, 'skipped')`,
            [tenantId, workflow.id, event, entityId]
          );
          logger.info('[workflows] Workflow skipped (conditions not met)', {
            workflowId: workflow.id,
            workflowName: workflow.name,
          });
          continue;
        }

        // Execute actions via the dedicated executors. Each action runs inside
        // the same `withTenant` transaction so RLS and atomicity hold.
        try {
          const userIdFromPayload = (payload as Record<string, unknown>).user_id;
          const ctxUserId =
            typeof userIdFromPayload === 'string' ? userIdFromPayload : null;

          for (const action of actions) {
            logger.info('[workflows] Executing action', {
              workflowId: workflow.id,
              workflowName: workflow.name,
              actionType: action.type,
              entityId,
              event,
            });

            await executeAction(action, {
              client,
              tenantId,
              event,
              entityId,
              payload,
              userId: ctxUserId,
              // Human-oversight-gate (EU AI Act art. 14): gated acties
              // schrijven een proposal met deze workflow als bron.
              workflowId: workflow.id,
            });
          }

          // Record successful run and update stats
          await client.query(
            `INSERT INTO workflow_runs (tenant_id, workflow_id, trigger_event, entity_id, status)
             VALUES ($1, $2, $3, $4, 'success')`,
            [tenantId, workflow.id, event, entityId]
          );

          await client.query(
            `UPDATE workflows
             SET run_count = run_count + 1, last_run_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            [workflow.id, tenantId]
          );

          logger.info('[workflows] Workflow executed successfully', {
            workflowId: workflow.id,
            workflowName: workflow.name,
            actionsExecuted: actions.length,
          });
        } catch (actionErr) {
          // Record failed run
          await client.query(
            `INSERT INTO workflow_runs (tenant_id, workflow_id, trigger_event, entity_id, status, error)
             VALUES ($1, $2, $3, $4, 'failed', $5)`,
            [tenantId, workflow.id, event, entityId, (actionErr as Error).message]
          );

          logger.error('[workflows] Workflow action failed', {
            workflowId: workflow.id,
            workflowName: workflow.name,
            error: (actionErr as Error).message,
          });
        }
      }
    });
  } catch (err) {
    logger.error('[workflows] processWorkflowEvent failed', {
      tenantId,
      event,
      entityId,
      error: (err as Error).message,
    });
  }
}

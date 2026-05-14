import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as workflowsService from './workflows.service';

// ── Validation schemas ────────────────────────────────────────────────────────

const conditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['equals', 'not_equals', 'greater_than', 'contains']),
  value: z.string(),
});

const actionSchema = z.object({
  type: z.enum([
    'send_email',
    'send_whatsapp',
    'add_tag',
    'remove_tag',
    'move_to_stage',
    'create_task',
    'trigger_webhook',
  ]),
  config: z.record(z.string()),
});

const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  trigger: z.string().min(1),
  conditions: z.array(conditionSchema).optional(),
  actions: z.array(actionSchema).min(1),
});

const updateWorkflowSchema = createWorkflowSchema.partial();

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function listWorkflows(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const workflows = await workflowsService.listWorkflows(req.user!.tenantId);
    res.json({ data: workflows });
  } catch (err) {
    next(err);
  }
}

export async function getWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const workflow = await workflowsService.getWorkflow(req.user!.tenantId, req.params.id);
    res.json(workflow);
  } catch (err) {
    next(err);
  }
}

export async function createWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createWorkflowSchema.parse(req.body);
    const workflow = await workflowsService.createWorkflow(req.user!.tenantId, req.user!.userId, data);
    res.status(201).json(workflow);
  } catch (err) {
    next(err);
  }
}

export async function updateWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateWorkflowSchema.parse(req.body);
    const workflow = await workflowsService.updateWorkflow(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      data
    );
    res.json(workflow);
  } catch (err) {
    next(err);
  }
}

export async function deleteWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await workflowsService.deleteWorkflow(req.user!.tenantId, req.params.id);
    res.json({ message: 'Workflow verwijderd' });
  } catch (err) {
    next(err);
  }
}

export async function toggleWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const workflow = await workflowsService.toggleWorkflow(req.user!.tenantId, req.params.id);
    res.json(workflow);
  } catch (err) {
    next(err);
  }
}

export async function getWorkflowRuns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const runs = await workflowsService.getWorkflowRuns(req.user!.tenantId, req.params.id);
    res.json({ data: runs });
  } catch (err) {
    next(err);
  }
}

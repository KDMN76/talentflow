import { workflowEventsQueue } from '../../queue/queues';
import { logger } from '../../middleware/errorHandler';
import { emitWebhookEvent } from '../webhooks/deliveries.service';

/**
 * Enqueue a workflow event for async processing by `workflow.worker`.
 *
 * Call this AFTER the originating DB transaction has committed — otherwise the
 * worker may pick up the job before the entity is visible (or, worse, the
 * transaction rolls back and the workflow runs against a non-existent entity).
 *
 * Failures are caught and logged: a workflow trigger failure must never
 * cascade into the caller's request path.
 *
 * Sprint Q4.1: dezelfde call dispatcht óók naar webhook-subscribers via
 * `emitWebhookEvent`. Workflow-engine en webhooks zijn afzonderlijke
 * consumers van dezelfde domain-event-stream.
 */
export async function emitWorkflowEvent(
  tenantId: string,
  event: string,
  entityId: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    await workflowEventsQueue.add('process-event', {
      tenantId,
      event,
      entityId,
      payload,
    });
    logger.info('[workflowEmitter] Event enqueued', { tenantId, event, entityId });
  } catch (err) {
    logger.error('[workflowEmitter] Failed to enqueue event', {
      tenantId,
      event,
      entityId,
      error: (err as Error).message,
    });
  }

  // Webhook fan-out — onafhankelijk van workflow-queue zodat een failure in
  // de webhook-tabellen de workflow-engine niet kapotmaakt en vice versa.
  try {
    await emitWebhookEvent(tenantId, event, { entity_id: entityId, ...payload }, { entityId });
  } catch (err) {
    logger.warn('[workflowEmitter] webhook fan-out failed', {
      tenantId,
      event,
      entityId,
      error: (err as Error).message,
    });
  }
}

/**
 * Centrale domain-event helper. Beschikbaar voor toekomstige call-sites die
 * niet via de workflow-engine willen, maar wel webhook-fan-out willen.
 *
 * Identical wrapper rond emitWorkflowEvent — bewust, zodat de naamgeving in
 * code-reviews duidelijk maakt dat een service een DOMAIN-event broadcast
 * (workflows + webhooks) en niet een interne mutation event.
 */
export async function emitDomainEvent(
  tenantId: string,
  event: string,
  entityId: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  return emitWorkflowEvent(tenantId, event, entityId, payload);
}

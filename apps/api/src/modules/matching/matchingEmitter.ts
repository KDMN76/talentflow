import { embeddingsQueue } from '../../queue/queues';
import { logger } from '../../middleware/errorHandler';

/**
 * Enqueue an embedding-(re)generation job.
 *
 * Aanroepen NA de COMMIT van de bijbehorende DB-transactie. Als we vóór de
 * commit zouden enqueueen, zou de worker mogelijk een entiteit proberen te
 * laden die nog niet bestaat (read-after-write race), of erger: bij rollback
 * een stale embedding genereren voor data die nooit gepersisteerd werd.
 *
 * Falen wordt gevangen + gelogd: matching is best-effort, het mag nooit
 * cascaden naar het request-pad van create/update.
 */
export async function queueEmbedding(
  tenantId: string,
  entityType: 'candidate' | 'job',
  entityId: string
): Promise<void> {
  try {
    const jobName = entityType === 'candidate' ? 'embed-candidate' : 'embed-job';
    await embeddingsQueue.add(jobName, {
      tenantId,
      entityType,
      entityId,
    });
    logger.info('[matchingEmitter] embedding job enqueued', {
      tenantId,
      entityType,
      entityId,
    });
  } catch (err) {
    logger.error('[matchingEmitter] failed to enqueue embedding', {
      tenantId,
      entityType,
      entityId,
      error: (err as Error).message,
    });
  }
}

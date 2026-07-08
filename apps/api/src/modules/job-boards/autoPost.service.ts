/**
 * Auto-post-on-publish — tenant opt-in job-board distribution.
 *
 * When a tenant enables auto-post and selects one or more boards, a job that
 * transitions to `open` (published) is automatically enqueued to each of the
 * chosen boards via the existing `enqueuePosting` path. Boards without valid
 * credentials fail honestly downstream in the post-worker — nothing here
 * short-circuits on missing credentials.
 *
 * Storage: `tenants.settings -> 'job_board_auto_post'` JSONB
 *   { "enabled": boolean, "boards": string[] }
 * No dedicated table / migration needed; `jsonb_set` keeps sibling settings
 * intact.
 *
 * Safety: `autoPostJobToBoards` NEVER throws. A distribution problem must not
 * roll back the publish that triggered it.
 */

import { withTenant, withoutTenant } from '../../db/pool';
import { logger } from '../../middleware/errorHandler';
import { getConnector } from './registry';
import { enqueuePosting } from './service';

/** JSONB key under `tenants.settings`. */
const SETTINGS_KEY = 'job_board_auto_post';

export interface AutoPostSettings {
  /** Master switch — default OFF. */
  enabled: boolean;
  /** Board ids to post to on publish (validated against the connector registry). */
  boards: string[];
}

const EMPTY: AutoPostSettings = { enabled: false, boards: [] };

/**
 * Coerce raw JSONB (or user input) into a safe settings object. Unknown /
 * unregistered board ids are dropped so we never enqueue to a board the
 * platform can't service.
 */
export function normalizeAutoPostSettings(raw: unknown): AutoPostSettings {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const r = raw as { enabled?: unknown; boards?: unknown };
  const enabled = r.enabled === true;
  const seen = new Set<string>();
  const boards = Array.isArray(r.boards)
    ? r.boards.filter((b): b is string => {
        if (typeof b !== 'string' || seen.has(b)) return false;
        if (!getConnector(b)) return false;
        seen.add(b);
        return true;
      })
    : [];
  return { enabled, boards };
}

export async function getAutoPostSettings(
  tenantId: string
): Promise<AutoPostSettings> {
  return withoutTenant(async (client) => {
    const { rows } = await client.query<{
      settings: Record<string, unknown> | null;
    }>(`SELECT settings FROM tenants WHERE id = $1`, [tenantId]);
    return normalizeAutoPostSettings(rows[0]?.settings?.[SETTINGS_KEY]);
  });
}

export async function updateAutoPostSettings(
  tenantId: string,
  input: { enabled: boolean; boards: string[] }
): Promise<AutoPostSettings> {
  const clean = normalizeAutoPostSettings(input);
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      settings: Record<string, unknown> | null;
    }>(
      `UPDATE tenants
          SET settings = jsonb_set(
            COALESCE(settings, '{}'::jsonb),
            '{${SETTINGS_KEY}}',
            $2::jsonb,
            true
          )
        WHERE id = $1
        RETURNING settings`,
      [tenantId, JSON.stringify(clean)]
    );
    return normalizeAutoPostSettings(rows[0]?.settings?.[SETTINGS_KEY]);
  });
}

/**
 * Enqueue `jobId` to every configured board when auto-post is enabled.
 *
 * Returns the board ids that were successfully enqueued. Never throws:
 *   - auto-post disabled           → `{ enqueued: [] }`
 *   - enabled but no boards chosen → `{ enqueued: [] }`
 *   - a single board enqueue fails → logged, other boards still attempted
 */
export async function autoPostJobToBoards(
  tenantId: string,
  jobId: string,
  userId: string | null
): Promise<{ enqueued: string[] }> {
  const enqueued: string[] = [];
  try {
    const settings = await getAutoPostSettings(tenantId);
    if (!settings.enabled || settings.boards.length === 0) {
      return { enqueued };
    }
    for (const boardId of settings.boards) {
      try {
        await enqueuePosting(tenantId, jobId, boardId, { userId });
        enqueued.push(boardId);
      } catch (err) {
        logger.warn('[jobBoards] auto-post enqueue faalde voor board', {
          tenantId,
          jobId,
          boardId,
          error: (err as Error)?.message,
        });
      }
    }
  } catch (err) {
    logger.warn('[jobBoards] auto-post overgeslagen', {
      tenantId,
      jobId,
      error: (err as Error)?.message,
    });
  }
  return { enqueued };
}

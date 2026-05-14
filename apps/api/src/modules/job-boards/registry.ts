/**
 * Job-board connector registry — Sprint Q4.3.
 *
 * Eén centrale dispatcher: alle code die met een specifiek job-board moet
 * praten, lookt het op via `JOB_BOARD_REGISTRY[boardId]`. Zo blijft de
 * service-laag (en de queue-workers) board-onafhankelijk en hoef je voor
 * een nieuw board enkel een nieuwe `JobBoardConnector` toe te voegen.
 *
 * Coordination — agents die deze file aanraken:
 *   - Agent QQQ (deze sprint, internationale boards): voegt LinkedIn + Indeed toe.
 *   - Agent RRR (parallel sprint, NL-boards): voegt 6 NL-connectors toe NA
 *     het marker-comment hieronder. Niet boven de marker editen om merge-
 *     conflicts te voorkomen.
 */

import type { JobBoardConnector } from './types';
import { linkedinConnector } from './connectors/linkedin';
import { indeedConnector } from './connectors/indeed';
// RRR's `registry.rrr.ts` types its connectors against a local copy of the
// contract (`connectors/_helpers/types.local`). The runtime shape is identical
// to ours — we cast through `unknown` so TS accepts it without us having to
// edit RRR's file.
import { rrrConnectorsById as rrrConnectorsRaw } from './registry.rrr';
const rrrConnectorsById = rrrConnectorsRaw as unknown as Record<
  string,
  JobBoardConnector
>;

export const JOB_BOARD_REGISTRY: Record<string, JobBoardConnector> = {
  [linkedinConnector.id]: linkedinConnector,
  [indeedConnector.id]: indeedConnector,
  // === Agent RRR appends below ===
  ...rrrConnectorsById,
};

/**
 * Lookup met null-fallback (controllers gebruiken dit i.p.v. directe access
 * zodat onbekende board-id's niet crashen op undefined).
 */
export function getConnector(boardId: string): JobBoardConnector | null {
  return JOB_BOARD_REGISTRY[boardId] ?? null;
}

/**
 * Enumereer alle geregistreerde connectors — gebruikt door /catalog endpoint.
 */
export function listConnectors(): JobBoardConnector[] {
  return Object.values(JOB_BOARD_REGISTRY);
}

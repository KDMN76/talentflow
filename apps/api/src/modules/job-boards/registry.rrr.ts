/**
 * RRR-owned connector exports — Sprint Q4.3.
 *
 * QQQ's `registry.ts` spreads `rrrConnectorsById` after the marker line.
 * After the integration, both teams share the same `JobBoardConnector`
 * interface from `./types`, so no casts are needed.
 */

import type { JobBoardConnector } from './types';
import { broadbeanConnector } from './connectors/broadbean';
import { jobbirdConnector } from './connectors/jobbird';
import { jobsnlConnector } from './connectors/jobsnl';
import { nationaleVacaturebankConnector } from './connectors/nationale-vacaturebank';
import { stepstoneConnector } from './connectors/stepstone';
import { werkzoekenConnector } from './connectors/werkzoeken';

export const rrrConnectors: JobBoardConnector[] = [
  nationaleVacaturebankConnector,
  jobbirdConnector,
  stepstoneConnector,
  werkzoekenConnector,
  jobsnlConnector,
  broadbeanConnector,
];

/**
 * Lookup-by-id map. O(1) at call time; cheap enough to build at module-load
 * (six entries). QQQ's `registry.ts` spreads this in.
 */
export const rrrConnectorsById: Record<string, JobBoardConnector> = Object.fromEntries(
  rrrConnectors.map((c) => [c.id, c])
);

/**
 * Sourcing-source registry — Sprint Q4.5 (Agent WWW).
 *
 * Exporteert alle bekende sources en een helper om de actieve set op te halen.
 * `runSearchAgent` itereert over `getEnabledSources()`. Een source kan zelf via
 * env's bepalen of hij enabled is — registratie hier zegt niets over runtime.
 */

import type { SourcingSource } from './types';
import { existingDbSource } from './existingDb';
import { linkedinScraperSource } from './linkedinScraper';
import { githubSource } from './github';
import { hunterSource } from './hunter';

export const ALL_SOURCES: SourcingSource[] = [
  existingDbSource,
  linkedinScraperSource,
  githubSource,
  hunterSource,
];

export function getEnabledSources(): SourcingSource[] {
  return ALL_SOURCES.filter((s) => s.isEnabled());
}

export {
  existingDbSource,
  linkedinScraperSource,
  githubSource,
  hunterSource,
};
export type { SourcingSource, RawCandidate, BooleanQuery, SourcingSourceContext } from './types';

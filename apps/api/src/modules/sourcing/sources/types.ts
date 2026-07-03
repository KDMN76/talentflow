/**
 * Sourcing source connector contract — Sprint Q4.5 (Agent WWW).
 *
 * Iedere external source (LinkedIn, GitHub, Hunter, eigen DB, etc.) implementeert
 * deze interface. De `searchAgent.service` orkestreert ze: fan-out, dedupe,
 * rangschikt op match_score.
 *
 * RawCandidate is de genormaliseerde shape — we trimmen vendor-specific velden
 * weg zodat de agent uniform kan werken.
 */

import type { AgentBrief } from '../brief.service';
import { mocksAllowed } from '../../../lib/env';

/**
 * Mogen sources mock-kandidaten leveren? Zelfde patroon als de AI-client
 * (searchAgent `shouldUseMock`): mocks alleen wanneer credentials ontbreken
 * ÉN we NIET in productie draaien. In productie zonder key levert een source
 * een eerlijk leeg resultaat — nooit verzonnen kandidaten.
 */
export function mockCandidatesAllowed(): boolean {
  return mocksAllowed();
}

export interface BooleanQuery {
  /** Boolean-string zoals "(react OR vue) AND typescript AND amsterdam" */
  query: string;
  /** Geografische filters (city/region/country). */
  locations?: string[];
  /** Skill-/title-/company-uitsluitingen. */
  exclusions?: string[];
  /** Optionele extra metadata (limit, sortField). */
  meta?: Record<string, unknown>;
}

export interface RawCandidate {
  /** Stable external id binnen deze source (bijv. linkedin URN, github login). */
  externalId: string | null;
  externalUrl: string | null;
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  skills: string[];
  languages: string[];
  /** 0-100. Source-zijde mag al een raw similarity geven; agent rescored. */
  rawScore?: number;
  /** Optionele extra payload (links naar profielen, etc.). */
  metadata?: Record<string, unknown>;
}

export interface SourcingSourceContext {
  tenantId: string;
  brief: AgentBrief;
  /** Cap op aantal kandidaten per source per call. */
  limit: number;
}

export interface SourcingSource {
  /** Stable id — moet matchen met external_source op agent_findings. */
  id: 'linkedin' | 'github' | 'xing' | 'existing_db' | 'hunter';
  /** Human-readable label voor UI / logs. */
  name: string;
  /**
   * Geeft true als de source momenteel bruikbaar is (bijv. API-key configured).
   * Een source die niet enabled is wordt geskipt zonder error.
   */
  isEnabled(): boolean;
  /**
   * Voer een zoekopdracht uit. Mag nooit throwen voor "geen resultaten" — return
   * een leeg array. Throw alleen bij configuratie-fouten of definitieve errors.
   */
  search(query: BooleanQuery, ctx: SourcingSourceContext): Promise<RawCandidate[]>;
}

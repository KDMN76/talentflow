/**
 * Hunter.io connector — Sprint Q4.5 (Agent WWW).
 *
 * Hunter is een email-discovery API die per company-domain employees + e-mails
 * vindt. Voor sourcing gebruiken we het minder voor pure search en meer voor
 * "ik heb een lijst doelbedrijven, geef me alle relevante mensen daar".
 *
 * Endpoint: GET https://api.hunter.io/v2/domain-search?domain=...&api_key=...
 * Doc: https://hunter.io/api-documentation/v2#domain-search
 *
 * Mock-fallback wanneer geen `HUNTER_API_KEY` of geen detecteerbare bedrijfsnaam
 * in de query. Voor MVP scrapen we company-tokens uit de boolean (woorden die
 * met hoofdletter beginnen) — recruiter kan straks via brief.metadata een
 * lijstje target-companies meegeven.
 */

import type {
  SourcingSource,
  RawCandidate,
  BooleanQuery,
  SourcingSourceContext,
} from './types';
import { logger } from '../../../middleware/errorHandler';

interface HunterEmail {
  value: string;
  type: string | null;
  confidence: number | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  seniority: string | null;
  department: string | null;
  linkedin: string | null;
}

interface HunterDomainSearch {
  data?: {
    domain: string;
    organization: string | null;
    emails?: HunterEmail[];
  };
}

function extractCompanyTokens(query: string): string[] {
  // Pak woorden met hoofdletter — heuristic voor company-namen.
  return Array.from(query.matchAll(/\b([A-Z][a-zA-Z0-9]{2,30}(?:\s[A-Z][a-zA-Z0-9]{2,30})?)\b/g))
    .map((m) => m[1])
    .filter((t) => !/^(NOT|AND|OR)$/i.test(t))
    .slice(0, 3);
}

function inferDomain(company: string): string {
  return `${company.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')}.com`;
}

function mockCandidates(query: BooleanQuery, count: number): RawCandidate[] {
  const company = extractCompanyTokens(query.query)[0] ?? 'TargetCo';
  const out: RawCandidate[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      externalId: `hunter-mock-${company.toLowerCase()}-${i + 1}`,
      externalUrl: null,
      fullName: `Hunter Mock ${i + 1}`,
      currentTitle: 'Engineering Manager',
      currentCompany: company,
      location: query.locations?.[0] ?? null,
      headline: `Werkt bij ${company}`,
      summary: `Mock Hunter-profiel; query bevatte company "${company}".`,
      skills: [],
      languages: [],
      rawScore: 55 - i * 2,
      metadata: { source_kind: 'mock', email: `mock${i + 1}@${inferDomain(company)}` },
    });
  }
  return out;
}

export const hunterSource: SourcingSource = {
  id: 'hunter',
  name: 'Hunter.io',
  isEnabled: () => true,
  async search(
    query: BooleanQuery,
    ctx: SourcingSourceContext
  ): Promise<RawCandidate[]> {
    const limit = Math.max(3, Math.min(20, ctx.limit ?? 10));
    const apiKey = process.env.HUNTER_API_KEY;
    const companies = extractCompanyTokens(query.query);
    if (!apiKey || companies.length === 0) {
      return mockCandidates(query, Math.min(limit, 5));
    }
    const company = companies[0];
    const domain = inferDomain(company);
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(apiKey)}&limit=${Math.min(limit, 25)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        logger.warn('[sourcingAgent/hunter] non-2xx — fallback mock', { status: res.status });
        return mockCandidates(query, Math.min(limit, 4));
      }
      const data = await res.json() as HunterDomainSearch;
      const emails = data.data?.emails ?? [];
      return emails.slice(0, limit).map((e, i) => ({
        externalId: `hunter:${e.value}`,
        externalUrl: e.linkedin ?? null,
        fullName: [e.first_name, e.last_name].filter(Boolean).join(' ') || e.value,
        currentTitle: e.position ?? null,
        currentCompany: data.data?.organization ?? company,
        location: query.locations?.[0] ?? null,
        headline: [e.position, e.department].filter(Boolean).join(' · ') || null,
        summary: null,
        skills: [],
        languages: [],
        rawScore: typeof e.confidence === 'number' ? Math.min(100, e.confidence) : 60 - i,
        metadata: { hunter_email: e.value, seniority: e.seniority },
      }));
    } catch (err) {
      logger.warn('[sourcingAgent/hunter] fetch threw — fallback mock', {
        error: (err as Error).message,
      });
      return mockCandidates(query, Math.min(limit, 3));
    }
  },
};

export { extractCompanyTokens };

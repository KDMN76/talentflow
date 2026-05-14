/**
 * LinkedIn sourcing connector — Sprint Q4.5 (Agent WWW).
 *
 * **LEGAL NOTE.** Public-feed-scraping van LinkedIn is juridisch grijs en
 * commercieel risicovol — LinkedIn heeft Microsoft-juristen die graag
 * cease-and-desists schrijven. We laten deze source DEFAULT in mock-mode
 * draaien: deterministische dummy-kandidaten zodat tests + UI lokaal werken
 * zonder LinkedIn ooit te raken.
 *
 * Live-mode wordt expliciet ingeschakeld via env `LINKEDIN_SOURCING_LIVE=true`.
 * In dat geval verwacht de connector een externe LinkedIn-aggregator (Phantombuster,
 * Lix, RecruitEm) achter `LINKEDIN_SOURCING_API_URL` + `LINKEDIN_SOURCING_API_KEY`.
 * We bouwen die HTTP-call hier voor — de exacte payload-shape wordt in de
 * vendor-config geparseerd door een adapter-functie. Tot dat moment: mock.
 */

import type {
  SourcingSource,
  RawCandidate,
  BooleanQuery,
  SourcingSourceContext,
} from './types';
import { logger } from '../../../middleware/errorHandler';

function buildMockCandidates(query: BooleanQuery, count: number): RawCandidate[] {
  const baseSkills = (query.query.match(/[a-zA-ZÀ-ÿ]{3,}/g) ?? []).slice(0, 5);
  const out: RawCandidate[] = [];
  for (let i = 0; i < count; i++) {
    const name = `LinkedIn Mock Candidate ${i + 1}`;
    out.push({
      externalId: `linkedin-mock-${i + 1}`,
      externalUrl: `https://www.linkedin.com/in/mock-candidate-${i + 1}`,
      fullName: name,
      currentTitle: baseSkills.length > 0 ? `Senior ${baseSkills[0]} Engineer` : 'Senior Engineer',
      currentCompany: i % 2 === 0 ? 'Mock Tech BV' : 'Demo Software NV',
      location: query.locations?.[0] ?? 'Amsterdam, Netherlands',
      headline: `${baseSkills.slice(0, 3).join(' / ')} specialist`.trim() || 'Software professional',
      summary: `Mock profiel voor query "${query.query.slice(0, 80)}".`,
      skills: baseSkills,
      languages: ['Nederlands', 'Engels'],
      rawScore: 70 - i * 2,
      metadata: { source_kind: 'mock' },
    });
  }
  return out;
}

export const linkedinScraperSource: SourcingSource = {
  id: 'linkedin',
  name: 'LinkedIn',
  isEnabled: () => true, // mock altijd beschikbaar
  async search(
    query: BooleanQuery,
    ctx: SourcingSourceContext
  ): Promise<RawCandidate[]> {
    const live = process.env.LINKEDIN_SOURCING_LIVE === 'true';
    const limit = Math.max(3, Math.min(50, ctx.limit ?? 15));

    if (!live) {
      return buildMockCandidates(query, Math.min(limit, 8));
    }

    // Live mode — minimaal frame, gemarkeerd als WIP. We loggen een warning
    // zodat ops ziet dat dit pad effectief in productie hangt.
    const apiUrl = process.env.LINKEDIN_SOURCING_API_URL;
    const apiKey = process.env.LINKEDIN_SOURCING_API_KEY;
    if (!apiUrl || !apiKey) {
      logger.warn('[sourcingAgent/linkedin] LIVE mode aan zonder API_URL/API_KEY — fallback mock');
      return buildMockCandidates(query, Math.min(limit, 8));
    }
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: query.query,
          locations: query.locations ?? ctx.brief.search_locations,
          exclusions: query.exclusions ?? ctx.brief.exclusions,
          limit,
        }),
      });
      if (!res.ok) {
        logger.warn('[sourcingAgent/linkedin] live API non-2xx, fallback mock', {
          status: res.status,
        });
        return buildMockCandidates(query, Math.min(limit, 5));
      }
      const data = await res.json() as { candidates?: Array<Partial<RawCandidate>> };
      const list = Array.isArray(data.candidates) ? data.candidates : [];
      return list.slice(0, limit).map((c) => ({
        externalId: c.externalId ?? null,
        externalUrl: c.externalUrl ?? null,
        fullName: c.fullName ?? 'Onbekend',
        currentTitle: c.currentTitle ?? null,
        currentCompany: c.currentCompany ?? null,
        location: c.location ?? null,
        headline: c.headline ?? null,
        summary: c.summary ?? null,
        skills: Array.isArray(c.skills) ? c.skills : [],
        languages: Array.isArray(c.languages) ? c.languages : [],
        rawScore: typeof c.rawScore === 'number' ? c.rawScore : undefined,
        metadata: c.metadata ?? {},
      }));
    } catch (err) {
      logger.warn('[sourcingAgent/linkedin] live fetch threw, fallback mock', {
        error: (err as Error).message,
      });
      return buildMockCandidates(query, Math.min(limit, 5));
    }
  },
};

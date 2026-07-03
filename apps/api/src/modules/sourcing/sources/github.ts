/**
 * GitHub sourcing connector — Sprint Q4.5 (Agent WWW).
 *
 * Echte GitHub Search API voor user-search. Vereist `GITHUB_TOKEN` env voor
 * 5000 req/u rate-limit; zonder token vallen we naar mock-mode.
 *
 * Endpoint: GET https://api.github.com/search/users?q=...
 * Doc: https://docs.github.com/en/rest/search/search#search-users
 *
 * Rate-limit: 30 req/min (zonder auth) / 30+ (met token). De search-agent
 * gebruikt deze source max 1× per iteratie, dus we komen er ruim onder.
 */

import type {
  SourcingSource,
  RawCandidate,
  BooleanQuery,
  SourcingSourceContext,
} from './types';
import { mockCandidatesAllowed } from './types';
import { logger } from '../../../middleware/errorHandler';

interface GitHubSearchUserItem {
  login: string;
  id: number;
  html_url: string;
  url: string;
}

interface GitHubUserDetails {
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  bio: string | null;
  blog: string | null;
  public_repos: number | null;
  html_url: string;
}

function buildGitHubQ(query: BooleanQuery): string {
  const parts: string[] = [];
  // Pak technisch-klinkende keywords uit de boolean — GitHub zoekt over bio + repos.
  const tokens = (query.query.match(/[a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ0-9.+#-]{1,40}/g) ?? [])
    .filter((t) => !/^(or|and|not)$/i.test(t))
    .slice(0, 4);
  if (tokens.length === 0) parts.push('developer');
  else parts.push(tokens.join(' '));
  if (query.locations && query.locations.length > 0) {
    parts.push(`location:"${query.locations[0]}"`);
  }
  parts.push('type:user');
  return parts.join(' ');
}

function mockCandidates(query: BooleanQuery, count: number): RawCandidate[] {
  const tokens = (query.query.match(/[a-zA-ZÀ-ÿ]{3,}/g) ?? []).slice(0, 3);
  const out: RawCandidate[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      externalId: `github-mock-${i + 1}`,
      externalUrl: `https://github.com/mock-dev-${i + 1}`,
      fullName: `GitHub Mock Dev ${i + 1}`,
      currentTitle: tokens.length > 0 ? `${tokens[0]} engineer` : 'Software engineer',
      currentCompany: '@open-source',
      location: query.locations?.[0] ?? 'Remote',
      headline: tokens.join(' ') || 'Open source contributor',
      summary: `Mock GitHub profiel — query "${query.query.slice(0, 60)}".`,
      skills: tokens,
      languages: [],
      rawScore: 60 - i * 3,
      metadata: { source_kind: 'mock' },
    });
  }
  return out;
}

export const githubSource: SourcingSource = {
  id: 'github',
  name: 'GitHub',
  // Zonder token alleen enabled buiten productie (mock voor dev/tests).
  isEnabled: () => !!process.env.GITHUB_TOKEN || mockCandidatesAllowed(),
  async search(
    query: BooleanQuery,
    ctx: SourcingSourceContext
  ): Promise<RawCandidate[]> {
    const limit = Math.max(3, Math.min(30, ctx.limit ?? 15));
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      if (!mockCandidatesAllowed()) return [];
      return mockCandidates(query, Math.min(limit, 6));
    }

    const q = buildGitHubQ(query);
    const url = `https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=${Math.min(limit, 20)}`;
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
        },
      });
      if (!res.ok) {
        if (!mockCandidatesAllowed()) {
          logger.warn('[sourcingAgent/github] non-2xx — geen resultaten', { status: res.status });
          return [];
        }
        logger.warn('[sourcingAgent/github] non-2xx — fallback mock', { status: res.status });
        return mockCandidates(query, Math.min(limit, 4));
      }
      const data = await res.json() as { items?: GitHubSearchUserItem[] };
      const items = Array.isArray(data.items) ? data.items.slice(0, limit) : [];
      // Per-user details ophalen is duur (1 extra req per user). Voor MVP
      // bouwen we een lichte RawCandidate uit de search-response zonder
      // detail-fetch — dat houdt rate-limit + latency overzichtelijk.
      const out: RawCandidate[] = [];
      for (const item of items) {
        out.push({
          externalId: `github:${item.login}`,
          externalUrl: item.html_url,
          fullName: item.login,
          currentTitle: 'GitHub user',
          currentCompany: null,
          location: query.locations?.[0] ?? null,
          headline: item.login,
          summary: null,
          skills: [],
          languages: [],
          rawScore: 50,
          metadata: { github_id: item.id, login: item.login },
        });
      }
      return out;
    } catch (err) {
      if (!mockCandidatesAllowed()) {
        logger.warn('[sourcingAgent/github] fetch threw — geen resultaten', {
          error: (err as Error).message,
        });
        return [];
      }
      logger.warn('[sourcingAgent/github] fetch threw — fallback mock', {
        error: (err as Error).message,
      });
      return mockCandidates(query, Math.min(limit, 4));
    }
  },
};

export { buildGitHubQ };

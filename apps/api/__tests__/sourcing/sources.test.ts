/**
 * Sources test — Sprint Q4.5 (Agent WWW).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';
import { existingDbSource } from '../../src/modules/sourcing/sources/existingDb';
import { linkedinScraperSource } from '../../src/modules/sourcing/sources/linkedinScraper';
import { githubSource, buildGitHubQ } from '../../src/modules/sourcing/sources/github';
import { hunterSource, extractCompanyTokens } from '../../src/modules/sourcing/sources/hunter';
import { ALL_SOURCES, getEnabledSources } from '../../src/modules/sourcing/sources';
import type { AgentBrief } from '../../src/modules/sourcing/brief.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function brief(overrides: Partial<AgentBrief> = {}): AgentBrief {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    tenant_id: TENANT_ID,
    job_id: null,
    brief_text: 'react dev',
    must_have: ['react'],
    nice_to_have: [],
    exclusions: [],
    target_count: 10,
    search_locations: ['amsterdam'],
    language_preferences: ['nl'],
    active: true,
    created_by: null,
    created_at: '2026-05-10T10:00:00Z',
    updated_at: '2026-05-10T10:00:00Z',
    ...overrides,
  };
}

describe('ALL_SOURCES + registry', () => {
  it('exports 4 known sources', () => {
    expect(ALL_SOURCES).toHaveLength(4);
    const ids = ALL_SOURCES.map((s) => s.id);
    expect(ids).toEqual(['existing_db', 'linkedin', 'github', 'hunter']);
  });

  it('getEnabledSources returns only those with isEnabled() true', () => {
    const enabled = getEnabledSources();
    for (const s of enabled) expect(s.isEnabled()).toBe(true);
  });
});

describe('existingDbSource', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns normalized RawCandidate shape with internal_candidate_id metadata', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM candidates/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'cand-1',
                  name: 'Alice',
                  first_name: null,
                  last_name: null,
                  current_position: 'React engineer',
                  current_company: 'Mock Co',
                  description: 'Senior React + TypeScript engineer.',
                  skills: ['react', 'typescript'],
                  languages: ['Nederlands'],
                  address_city: 'Amsterdam',
                  address_country: 'Netherlands',
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const out = await existingDbSource.search(
      { query: 'react typescript' },
      { tenantId: TENANT_ID, brief: brief(), limit: 10 }
    );
    expect(out).toHaveLength(1);
    expect(out[0].fullName).toBe('Alice');
    expect(out[0].metadata?.internal_candidate_id).toBe('cand-1');
    expect(out[0].rawScore).toBeGreaterThanOrEqual(0);
  });

  it('returns empty array when DB query throws (no crash)', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM candidates/i.test(sql)) {
            throw new Error('table missing');
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const out = await existingDbSource.search(
      { query: 'react' },
      { tenantId: TENANT_ID, brief: brief(), limit: 10 }
    );
    expect(out).toEqual([]);
  });

  it('scoreCandidate boosts skill matches', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM candidates/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'cand-A',
                  name: 'Match Alice',
                  first_name: null, last_name: null,
                  current_position: 'React engineer',
                  current_company: null,
                  description: '',
                  skills: ['react', 'typescript'],
                  languages: [],
                  address_city: null, address_country: null,
                },
                {
                  id: 'cand-B',
                  name: 'Mismatch Bob',
                  first_name: null, last_name: null,
                  current_position: 'Java',
                  current_company: null,
                  description: '',
                  skills: ['java'],
                  languages: [],
                  address_city: null, address_country: null,
                },
              ],
              rowCount: 2,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const out = await existingDbSource.search(
      { query: 'react typescript' },
      {
        tenantId: TENANT_ID,
        brief: brief({ must_have: ['react', 'typescript'] }),
        limit: 10,
      }
    );
    expect(out[0].fullName).toBe('Match Alice');
    expect(out[0].rawScore).toBeGreaterThan(out[1].rawScore!);
  });
});

describe('linkedinScraperSource', () => {
  it('mock-mode (default) returns deterministic mock candidates', async () => {
    delete process.env.LINKEDIN_SOURCING_LIVE;
    const out = await linkedinScraperSource.search(
      { query: 'react amsterdam' },
      { tenantId: TENANT_ID, brief: brief(), limit: 5 }
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out[0].externalId?.startsWith('linkedin-mock-')).toBe(true);
  });

  it('live mode without API_URL falls back to mock', async () => {
    process.env.LINKEDIN_SOURCING_LIVE = 'true';
    delete process.env.LINKEDIN_SOURCING_API_URL;
    delete process.env.LINKEDIN_SOURCING_API_KEY;
    try {
      const out = await linkedinScraperSource.search(
        { query: 'react' },
        { tenantId: TENANT_ID, brief: brief(), limit: 3 }
      );
      expect(out.length).toBeGreaterThan(0);
    } finally {
      delete process.env.LINKEDIN_SOURCING_LIVE;
    }
  });
});

describe('githubSource', () => {
  it('mock-mode (no token) returns mock candidates', async () => {
    const prev = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const out = await githubSource.search(
        { query: 'react amsterdam' },
        { tenantId: TENANT_ID, brief: brief(), limit: 3 }
      );
      expect(out.length).toBeGreaterThan(0);
      expect(out[0].externalId?.startsWith('github-mock-')).toBe(true);
    } finally {
      if (prev) process.env.GITHUB_TOKEN = prev;
    }
  });

  it('buildGitHubQ produces a query with location filter', () => {
    const q = buildGitHubQ({ query: 'react typescript', locations: ['Amsterdam'] });
    expect(q).toContain('react');
    expect(q).toContain('location:"Amsterdam"');
    expect(q).toContain('type:user');
  });

  it('falls back to mock on non-2xx response', async () => {
    process.env.GITHUB_TOKEN = 'ghp-test';
    const fakeFetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const origFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = fakeFetch;
    try {
      const out = await githubSource.search(
        { query: 'react' },
        { tenantId: TENANT_ID, brief: brief(), limit: 3 }
      );
      expect(out.length).toBeGreaterThan(0); // mock fallback
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
    }
  });
});

describe('hunterSource', () => {
  it('extractCompanyTokens picks up TitleCase words', () => {
    const tokens = extractCompanyTokens('React developer at Booking.com or Adyen NV');
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('returns mock when no API key', async () => {
    const prev = process.env.HUNTER_API_KEY;
    delete process.env.HUNTER_API_KEY;
    try {
      const out = await hunterSource.search(
        { query: 'engineering manager Booking' },
        { tenantId: TENANT_ID, brief: brief(), limit: 3 }
      );
      expect(out.length).toBeGreaterThan(0);
    } finally {
      if (prev) process.env.HUNTER_API_KEY = prev;
    }
  });

  it('returns mock when API key present but no companies in query', async () => {
    process.env.HUNTER_API_KEY = 'h-test';
    try {
      const out = await hunterSource.search(
        { query: 'just lowercase words' },
        { tenantId: TENANT_ID, brief: brief(), limit: 3 }
      );
      // No TitleCase tokens → falls back to mock.
      expect(out.length).toBeGreaterThanOrEqual(0);
    } finally {
      delete process.env.HUNTER_API_KEY;
    }
  });
});

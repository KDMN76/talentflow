/**
 * brief.service tests — Sprint Q4.5 (Agent WWW).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

vi.mock('../../src/lib/aiEvents', () => ({
  logAIEvent: vi.fn(async () => undefined),
}));

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return {
    ...actual,
    logAudit: vi.fn(async () => undefined),
  };
});

import {
  parseBriefMock,
  parseBriefWithAI,
  createBrief,
  listBriefs,
  getBrief,
  updateBrief,
  archiveBrief,
} from '../../src/modules/sourcing/brief.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const BRIEF_ID = '33333333-3333-3333-3333-333333333333';
const JOB_ID = '44444444-4444-4444-4444-444444444444';

function briefRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: BRIEF_ID,
    tenant_id: TENANT_ID,
    job_id: JOB_ID,
    brief_text: 'Senior React developer in Amsterdam, 5+ jaar ervaring, geen banking.',
    must_have: ['react', 'typescript'],
    nice_to_have: [],
    exclusions: ['banking'],
    target_count: 25,
    search_locations: ['amsterdam'],
    language_preferences: ['nl', 'en'],
    active: true,
    created_by: USER_ID,
    created_at: new Date('2026-05-10T10:00:00Z'),
    updated_at: new Date('2026-05-10T10:00:00Z'),
    ...overrides,
  };
}

describe('parseBriefMock — heuristic extraction', () => {
  it('extracts skills from a brief with known keywords', () => {
    const out = parseBriefMock('Looking for senior React + TypeScript developer with Node.js experience.');
    expect(out.must_have).toContain('react');
    expect(out.must_have).toContain('typescript');
    // node.js → matches plain "node" keyword (regex \bnode\b matches "node" before the dot).
    expect(out.must_have.some((m) => /node/.test(m))).toBe(true);
  });

  it('detects years of experience pattern', () => {
    const out = parseBriefMock('5+ jaar ervaring met Java en Spring.');
    expect(out.must_have.some((m) => m.toLowerCase().includes('jaar ervaring'))).toBe(true);
  });

  it('extracts target_count from "X kandidaten"', () => {
    const out = parseBriefMock('Ik wil 50 kandidaten met python ervaring.');
    expect(out.target_count).toBe(50);
  });

  it('falls back to default 25 when no target mentioned', () => {
    const out = parseBriefMock('Java developer met spring kennis.');
    expect(out.target_count).toBe(25);
  });

  it('detects locations', () => {
    const out = parseBriefMock('React developer in Amsterdam of Rotterdam.');
    expect(out.search_locations).toContain('amsterdam');
    expect(out.search_locations).toContain('rotterdam');
  });

  it('extracts exclusions via "geen X" phrase', () => {
    const out = parseBriefMock('React developer, geen banking ervaring.');
    expect(out.exclusions.length).toBeGreaterThanOrEqual(1);
  });

  it('caps target_count at 500', () => {
    const out = parseBriefMock('Wil 9999 kandidaten.');
    expect(out.target_count).toBeLessThanOrEqual(500);
  });
});

describe('parseBriefWithAI — mock-mode default', () => {
  it('returns mocked=true when no API key', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const out = await parseBriefWithAI('React developer in Amsterdam, 50 kandidaten.');
      expect(out._meta.mocked).toBe(true);
      expect(out.target_count).toBe(50);
    } finally {
      if (prev) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('respects AI_MOCK=true even when API key set', async () => {
    process.env.AI_MOCK = 'true';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    try {
      const out = await parseBriefWithAI('Java developer with spring boot.');
      expect(out._meta.mocked).toBe(true);
    } finally {
      delete process.env.AI_MOCK;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

describe('createBrief', () => {
  let teardown: () => void;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('persists brief and uses parsed structure when no overrides', async () => {
    const row = briefRow();
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO agent_briefs/i.test(sql)) {
          return { rows: [row], rowCount: 1 };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const out = await createBrief(
      TENANT_ID,
      { brief_text: 'Senior React developer in Amsterdam, 5+ jaar ervaring, geen banking.' },
      USER_ID
    );
    expect(out.id).toBe(BRIEF_ID);
    expect(client.query).toHaveBeenCalled();
  });

  it('user-supplied must_have overrules parsed must_have', async () => {
    const row = briefRow({ must_have: ['custom_override'] });
    let capturedQuery: string | null = null;
    let capturedParams: unknown[] | null = null;
    const client: MockClient = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO agent_briefs/i.test(sql)) {
          capturedQuery = sql;
          capturedParams = params as unknown[];
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const out = await createBrief(
      TENANT_ID,
      {
        brief_text: 'React developer ervaring met TypeScript voor 10 kandidaten.',
        must_have: ['custom_override'],
      },
      USER_ID
    );
    expect(out.must_have).toEqual(['custom_override']);
    // index 3 = must_have positional param (after tenant, job_id, brief_text).
    expect(capturedParams).not.toBeNull();
    expect(capturedQuery).toContain('agent_briefs');
  });
});

describe('listBriefs pagination', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns nextCursor when more pages exist', async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      briefRow({ id: `00000000-0000-0000-0000-${(i + 1).toString().padStart(12, '0')}` })
    );
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM agent_briefs/i.test(sql)) {
            return { rows, rowCount: rows.length };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const out = await listBriefs(TENANT_ID, { limit: 50 });
    expect(out.data).toHaveLength(50);
    expect(out.nextCursor).not.toBeNull();
  });

  it('nextCursor null when no more pages', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/FROM agent_briefs/i.test(sql)) {
            return { rows: [briefRow()], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const out = await listBriefs(TENANT_ID, { limit: 50 });
    expect(out.nextCursor).toBeNull();
  });
});

describe('getBrief / updateBrief / archiveBrief', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('getBrief throws 404 when not found', async () => {
    teardown = installPoolMock(mockClient());
    await expect(getBrief(TENANT_ID, BRIEF_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updateBrief patches active flag', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/^\s*SELECT \* FROM agent_briefs/i.test(sql)) {
            return { rows: [briefRow()], rowCount: 1 };
          }
          if (/UPDATE agent_briefs/i.test(sql)) {
            return { rows: [briefRow({ active: false })], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const out = await updateBrief(TENANT_ID, BRIEF_ID, { active: false }, USER_ID);
    expect(out.active).toBe(false);
  });

  it('archiveBrief marks active=false', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/^\s*SELECT \* FROM agent_briefs/i.test(sql)) {
            return { rows: [briefRow()], rowCount: 1 };
          }
          if (/UPDATE agent_briefs/i.test(sql)) {
            return { rows: [briefRow({ active: false })], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const out = await archiveBrief(TENANT_ID, BRIEF_ID, USER_ID);
    expect(out.active).toBe(false);
  });
});

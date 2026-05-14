import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import {
  mapTextToEscoSkill,
  mapManySkillsToEsco,
  clearMapperCache,
} from '../../src/lib/skills/mapper';

describe('skills mapper', () => {
  let teardown: () => void;
  let client: MockClient;

  beforeEach(() => {
    clearMapperCache();
  });

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  // ─── Exact matching ─────────────────────────────────────────────────────

  it('returns exact match with confidence 1.0', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/lower\(preferred_label\) = \$1/i.test(sql)) {
          return {
            rows: [
              {
                id: 'KS001',
                preferred_label: 'JavaScript',
                category: 'IT',
                alt_labels: ['JS'],
                has_embedding: true,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await mapTextToEscoSkill('JavaScript');
    expect(r).not.toBeNull();
    expect(r?.esco_skill_id).toBe('KS001');
    expect(r?.matched_via).toBe('exact');
    expect(r?.confidence).toBe(1.0);
    expect(r?.preferred_label).toBe('JavaScript');
  });

  it('exact match is case-insensitive', async () => {
    let receivedParam = '';
    client = mockClient({
      __matcher: (sql, params) => {
        if (/lower\(preferred_label\) = \$1/i.test(sql)) {
          receivedParam = String((params as unknown[])[0]);
          return {
            rows: [
              {
                id: 'KS001',
                preferred_label: 'JavaScript',
                category: 'IT',
                alt_labels: [],
                has_embedding: true,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await mapTextToEscoSkill('JAVASCRIPT');
    expect(r?.esco_skill_id).toBe('KS001');
    expect(receivedParam).toBe('javascript');
  });

  // ─── Alt-label matching ─────────────────────────────────────────────────

  it('falls back to alt_label match with confidence 0.9', async () => {
    let queryCount = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/lower\(preferred_label\) = \$1/i.test(sql)) {
          queryCount++;
          return { rows: [], rowCount: 0 };
        }
        if (/unnest\(alt_labels\)/i.test(sql)) {
          return {
            rows: [
              {
                id: 'KS001',
                preferred_label: 'JavaScript',
                category: 'IT',
                alt_labels: ['JS', 'EcmaScript'],
                has_embedding: true,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await mapTextToEscoSkill('JS');
    expect(r?.matched_via).toBe('alt_label');
    expect(r?.confidence).toBeCloseTo(0.9);
    expect(r?.esco_skill_id).toBe('KS001');
    expect(queryCount).toBe(1);
  });

  // ─── Embedding fallback ─────────────────────────────────────────────────

  it('falls back to embedding when exact + alt fail', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/lower\(preferred_label\) = \$1/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/unnest\(alt_labels\)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/FROM esco_skills\s+WHERE embedding IS NULL/i.test(sql)) {
          // No skills missing embeddings.
          return { rows: [], rowCount: 0 };
        }
        if (/embedding <=>/i.test(sql)) {
          return {
            rows: [
              {
                id: 'KS001',
                preferred_label: 'JavaScript',
                category: 'IT',
                similarity: 0.92,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await mapTextToEscoSkill('frontend scripting language');
    expect(r?.matched_via).toBe('embedding');
    expect(r?.confidence).toBeCloseTo(0.92, 2);
    expect(r?.esco_skill_id).toBe('KS001');
  });

  it('embedding fallback returns null when below minConfidence', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/lower\(preferred_label\) = \$1/i.test(sql))
          return { rows: [], rowCount: 0 };
        if (/unnest\(alt_labels\)/i.test(sql))
          return { rows: [], rowCount: 0 };
        if (/FROM esco_skills\s+WHERE embedding IS NULL/i.test(sql))
          return { rows: [], rowCount: 0 };
        if (/embedding <=>/i.test(sql)) {
          return {
            rows: [
              {
                id: 'KS999',
                preferred_label: 'Unrelated',
                category: 'Other',
                similarity: 0.4,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await mapTextToEscoSkill('something completely random', {
      minConfidence: 0.85,
    });
    expect(r).toBeNull();
  });

  it('skipEmbedding bypasses the fuzzy fallback', async () => {
    let embeddingQuerySeen = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/embedding <=>/i.test(sql)) embeddingQuerySeen = true;
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await mapTextToEscoSkill('mystery', { skipEmbedding: true });
    expect(r).toBeNull();
    expect(embeddingQuerySeen).toBe(false);
  });

  // ─── Edge cases ─────────────────────────────────────────────────────────

  it('returns null on empty input', async () => {
    expect(await mapTextToEscoSkill('')).toBeNull();
    expect(await mapTextToEscoSkill('   ')).toBeNull();
  });

  it('caches successive identical lookups', async () => {
    let exactCount = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/lower\(preferred_label\) = \$1/i.test(sql)) {
          exactCount++;
          return {
            rows: [
              {
                id: 'KS002',
                preferred_label: 'TypeScript',
                category: 'IT',
                alt_labels: [],
                has_embedding: true,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const a = await mapTextToEscoSkill('TypeScript');
    const b = await mapTextToEscoSkill('TypeScript');
    const c = await mapTextToEscoSkill('TYPESCRIPT'); // different case → same cache key
    expect(a?.esco_skill_id).toBe('KS002');
    expect(b?.esco_skill_id).toBe('KS002');
    expect(c?.esco_skill_id).toBe('KS002');
    expect(exactCount).toBe(1); // Only the first call hit the DB.
  });

  // ─── Batch ──────────────────────────────────────────────────────────────

  it('mapManySkillsToEsco preserves input order', async () => {
    client = mockClient({
      __matcher: (sql, params) => {
        if (/lower\(preferred_label\) = \$1/i.test(sql)) {
          const v = String((params as unknown[])[0]);
          if (v === 'javascript') {
            return {
              rows: [
                {
                  id: 'KS001',
                  preferred_label: 'JavaScript',
                  category: 'IT',
                  alt_labels: [],
                  has_embedding: true,
                },
              ],
              rowCount: 1,
            };
          }
          if (v === 'python') {
            return {
              rows: [
                {
                  id: 'KS003',
                  preferred_label: 'Python',
                  category: 'IT',
                  alt_labels: [],
                  has_embedding: true,
                },
              ],
              rowCount: 1,
            };
          }
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const out = await mapManySkillsToEsco(['JavaScript', 'Unknown', 'Python']);
    expect(out).toHaveLength(3);
    expect(out[0].result?.esco_skill_id).toBe('KS001');
    expect(out[1].result).toBeNull();
    expect(out[2].result?.esco_skill_id).toBe('KS003');
  });

  it('mapManySkillsToEsco dedupes equivalent inputs', async () => {
    let exactCount = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/lower\(preferred_label\) = \$1/i.test(sql)) {
          exactCount++;
          return {
            rows: [
              {
                id: 'KS001',
                preferred_label: 'JavaScript',
                category: 'IT',
                alt_labels: [],
                has_embedding: true,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await mapManySkillsToEsco([
      'JavaScript',
      'JAVASCRIPT',
      ' javascript ',
      'JavaScript',
    ]);
    expect(exactCount).toBe(1);
  });
});

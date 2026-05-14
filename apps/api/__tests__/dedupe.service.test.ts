import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';
import {
  findDuplicatesForCandidate,
  mergeCandidates,
} from '../src/modules/candidates/dedupe.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PRIMARY_ID = '33333333-3333-3333-3333-333333333333';
const DUP_ID = '44444444-4444-4444-4444-444444444444';

describe('findDuplicatesForCandidate', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('throws 404 when source candidate is missing', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(
      findDuplicatesForCandidate(TENANT_ID, PRIMARY_ID)
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
  });

  it('returns email-match with confidence 1.0', async () => {
    let lookupCount = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/AND id = \$1 AND tenant_id = \$2/i.test(sql)) {
          // We hit the source-candidate fetch
        }
        if (/SELECT id, name, email, phone, current_company/i.test(sql)) {
          return {
            rows: [
              {
                id: PRIMARY_ID,
                name: 'Sofia',
                email: 'sofia@example.com',
                phone: '+31 6 1234 5678',
                current_company: 'Acme',
              },
            ],
            rowCount: 1,
          };
        }
        if (/lower\(email\) = lower\(\$3\)/i.test(sql)) {
          lookupCount++;
          return {
            rows: [{ id: DUP_ID, name: 'Sofia V' }],
            rowCount: 1,
          };
        }
        if (/regexp_replace.*phone/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/lower\(trim\(name\)\) = lower\(trim\(\$3\)\)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const matches = await findDuplicatesForCandidate(TENANT_ID, PRIMARY_ID);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe(1.0);
    expect(matches[0].match_reason).toBe('email');
    expect(lookupCount).toBe(1);
  });

  it('deduplicates same-id-multiple-reasons keeping highest confidence', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id, name, email, phone, current_company/i.test(sql)) {
          return {
            rows: [
              {
                id: PRIMARY_ID,
                name: 'Sofia',
                email: 'sofia@example.com',
                phone: '+31612345678',
                current_company: 'Acme',
              },
            ],
            rowCount: 1,
          };
        }
        if (/lower\(email\)/i.test(sql)) {
          return { rows: [{ id: DUP_ID, name: 'Sofia V' }], rowCount: 1 };
        }
        if (/regexp_replace/i.test(sql)) {
          return { rows: [{ id: DUP_ID, name: 'Sofia V' }], rowCount: 1 };
        }
        if (/lower\(trim\(name\)\)/i.test(sql)) {
          return { rows: [{ id: DUP_ID, name: 'Sofia' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const matches = await findDuplicatesForCandidate(TENANT_ID, PRIMARY_ID);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe(1.0); // email wins
  });
});

describe('mergeCandidates', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('rejects empty duplicate_ids', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      mergeCandidates(TENANT_ID, USER_ID, {
        primary_id: PRIMARY_ID,
        duplicate_ids: [],
        field_choices: {},
      })
    ).rejects.toMatchObject({ code: 'MISSING_DUPLICATES' });
  });

  it('rejects when primary_id appears in duplicate_ids', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      mergeCandidates(TENANT_ID, USER_ID, {
        primary_id: PRIMARY_ID,
        duplicate_ids: [PRIMARY_ID],
        field_choices: {},
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('throws 404 when primary not found', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM candidates\s+WHERE id = ANY/i.test(sql)) {
          return { rows: [{ id: DUP_ID, name: 'X' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      mergeCandidates(TENANT_ID, USER_ID, {
        primary_id: PRIMARY_ID,
        duplicate_ids: [DUP_ID],
        field_choices: {},
      })
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
  });

  it('soft-deletes duplicates and returns merge count', async () => {
    let softDeleted = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM candidates\s+WHERE id = ANY/i.test(sql)) {
          return {
            rows: [
              { id: PRIMARY_ID, name: 'Primary', email: 'p@x.nl' },
              { id: DUP_ID, name: 'Dup', email: 'd@x.nl' },
            ],
            rowCount: 2,
          };
        }
        if (/FROM information_schema\.tables/i.test(sql)) {
          return { rows: [{ '?column?': 1 }], rowCount: 1 };
        }
        if (/UPDATE\s+\w+\s+SET\s+\w+\s*=\s*\$1\s+WHERE/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/UPDATE candidates SET deleted_at = now\(\)/i.test(sql)) {
          softDeleted++;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const result = await mergeCandidates(TENANT_ID, USER_ID, {
      primary_id: PRIMARY_ID,
      duplicate_ids: [DUP_ID],
      field_choices: {},
    });
    expect(result.merged_count).toBe(1);
    expect(result.merged_into).toBe(PRIMARY_ID);
    expect(softDeleted).toBe(1);
  });

  it('handles UNIQUE-violation on application re-point by deleting duplicate row', async () => {
    let deletedFallback = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM candidates\s+WHERE id = ANY/i.test(sql)) {
          return {
            rows: [
              { id: PRIMARY_ID, name: 'Primary' },
              { id: DUP_ID, name: 'Dup' },
            ],
            rowCount: 2,
          };
        }
        if (/FROM information_schema\.tables/i.test(sql)) {
          return { rows: [{ '?column?': 1 }], rowCount: 1 };
        }
        if (/UPDATE applications/i.test(sql)) {
          const e = new Error('dup') as Error & { code: string };
          e.code = '23505';
          throw e;
        }
        if (/DELETE FROM applications/i.test(sql)) {
          deletedFallback++;
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE candidates SET deleted_at/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await mergeCandidates(TENANT_ID, USER_ID, {
      primary_id: PRIMARY_ID,
      duplicate_ids: [DUP_ID],
      field_choices: {},
    });
    expect(deletedFallback).toBe(1);
  });
});

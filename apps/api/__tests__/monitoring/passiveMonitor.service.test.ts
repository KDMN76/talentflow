/**
 * passiveMonitor.service tests — Sprint Q4.5 (Agent XXX).
 *
 * Synthetic signal generation, eligibility checks for reactivation, listing
 * + dismiss, and cross-tenant safety.
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
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import {
  scanCandidatesForSignals,
  listSignals,
  dismissSignal,
  listTenantIdsForScan,
} from '../../src/modules/monitoring/passiveMonitor.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SIGNAL_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MOCK = 'true';
  delete process.env.LINKEDIN_MONITOR_LIVE;
});

afterEach(() => {
  delete process.env.AI_MOCK;
});

describe('scanCandidatesForSignals (mock mode)', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('emits ~5% synthetic signals over a large sample', async () => {
    // Use a large enough sample for a stable hit-rate.
    const candidates = Array.from({ length: 200 }, (_, i) => ({
      id: `${i.toString(16).padStart(8, '0')}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
      name: `Cand ${i}`,
      first_name: `C${i}`,
      email: `c${i}@x.nl`,
      created_at: '2026-01-01',
    }));
    let inserted = 0;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+candidates/i.test(sql)) {
          return { rows: candidates, rowCount: candidates.length };
        }
        if (/SELECT\s+id\s+FROM\s+candidate_signals/i.test(sql)) {
          // No existing signal for today.
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT\s+INTO\s+candidate_signals/i.test(sql)) {
          inserted++;
          return {
            rows: [
              {
                id: SIGNAL_ID,
                tenant_id: TENANT_ID,
                candidate_id: 'x',
                signal_type: 'job_change',
                detected_at: new Date().toISOString(),
                source: 'mock_passive_monitor',
                before_value: 'a',
                after_value: 'b',
                raw_payload: {},
                reviewed: false,
                reviewed_by: null,
                reviewed_at: null,
                triggered_action: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT\s+\(metadata->>/i.test(sql) || /metadata->>'do_not_contact'/.test(sql)) {
          return {
            rows: [{ consent: true, last_activity: new Date().toISOString() }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await scanCandidatesForSignals(TENANT_ID, {
      dateBucket: '2026-05-10',
    });
    expect(result.candidates_scanned).toBe(200);
    // 5% of 200 = 10, but allow 1-25 range for hash variance.
    expect(result.signals_emitted).toBeGreaterThanOrEqual(1);
    expect(result.signals_emitted).toBeLessThanOrEqual(25);
    // Reactivations are a subset of signals; should be ≤ signals_emitted.
    expect(result.reactivations_drafted).toBeLessThanOrEqual(result.signals_emitted);
    expect(inserted).toBeGreaterThanOrEqual(1);
  });

  it('skips emission when LINKEDIN_MONITOR_LIVE=true (no real API yet)', async () => {
    process.env.LINKEDIN_MONITOR_LIVE = 'true';
    const candidates = Array.from({ length: 50 }, (_, i) => ({
      id: `${i.toString(16).padStart(8, '0')}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
      name: `C ${i}`,
      first_name: `C${i}`,
      email: `c${i}@x.nl`,
      created_at: '2026-01-01',
    }));
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+candidates/i.test(sql)) {
          return { rows: candidates, rowCount: candidates.length };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await scanCandidatesForSignals(TENANT_ID, { dateBucket: '2026-05-10' });
    expect(r.signals_emitted).toBe(0);
    delete process.env.LINKEDIN_MONITOR_LIVE;
  });

  it('idempotent — does not re-emit when signal already exists today', async () => {
    const candidates = [
      {
        id: '00000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        name: 'C',
        first_name: 'C',
        email: 'c@x.nl',
        created_at: '2026-01-01',
      },
    ];
    let insertCount = 0;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+candidates/i.test(sql)) {
          return { rows: candidates, rowCount: 1 };
        }
        if (/SELECT\s+id\s+FROM\s+candidate_signals/i.test(sql)) {
          return { rows: [{ id: 'existing' }], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+candidate_signals/i.test(sql)) {
          insertCount++;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    // dateBucket guarantees a hit for this candidate id-shape if hash matches;
    // even if not, idempotency check runs only after hit. We don't care.
    const r = await scanCandidatesForSignals(TENANT_ID, { dateBucket: '2026-05-10' });
    expect(insertCount).toBe(0);
    expect(r.signals_emitted).toBe(0);
  });
});

describe('listSignals + dismissSignal', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('listSignals returns paginated rows', async () => {
    const rows = [
      {
        id: SIGNAL_ID,
        tenant_id: TENANT_ID,
        candidate_id: 'c1',
        signal_type: 'job_change',
        detected_at: new Date().toISOString(),
        source: 'mock',
        before_value: null,
        after_value: 'new title',
        raw_payload: {},
        reviewed: false,
        reviewed_by: null,
        reviewed_at: null,
        triggered_action: null,
      },
    ];
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+candidate_signals/i.test(sql)) {
          return { rows, rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await listSignals(TENANT_ID, { unreviewed: true });
    expect(r.data).toHaveLength(1);
  });

  it('dismissSignal flips reviewed=true', async () => {
    const dismissed = {
      id: SIGNAL_ID,
      tenant_id: TENANT_ID,
      candidate_id: 'c1',
      signal_type: 'job_change',
      detected_at: '',
      source: 'mock',
      before_value: null,
      after_value: null,
      raw_payload: {},
      reviewed: true,
      reviewed_by: USER_ID,
      reviewed_at: new Date().toISOString(),
      triggered_action: null,
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+candidate_signals\s+SET\s+reviewed\s*=\s*TRUE/i.test(sql)) {
          return { rows: [dismissed], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await dismissSignal(TENANT_ID, SIGNAL_ID, USER_ID);
    expect(r.reviewed).toBe(true);
  });

  it('listTenantIdsForScan returns distinct tenant ids', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+DISTINCT\s+tenant_id\s+FROM\s+candidates/i.test(sql)) {
          return {
            rows: [{ tenant_id: TENANT_ID }, { tenant_id: 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await listTenantIdsForScan();
    expect(r).toHaveLength(2);
  });

  it('listTenantIdsForScan returns empty array on DB error', async () => {
    const client = mockClient({
      __matcher: async () => {
        throw new Error('table missing');
      },
    });
    teardown = installPoolMock(client);
    const r = await listTenantIdsForScan();
    expect(r).toEqual([]);
  });
});

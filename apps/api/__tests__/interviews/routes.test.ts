/**
 * Authenticated interview routes — happy-path smoke tests through the REAL
 * HTTP stack (systeem-audit bugklasse 3: "het laatste draadje").
 *
 * Mounts `interviewsRouter` exactly zoals src/index.ts dat doet
 * (`app.use('/api/interviews', interviewsRouter)`) zodat requireAuth,
 * tenantMiddleware én requirePermission('interviews','write') meedraaien.
 *
 * Dekking:
 *   - recruiter: POST /api/interviews → 201 (queues gemockt)
 *   - viewer:    POST /api/interviews → 403 INSUFFICIENT_PERMISSION
 *   - geen JWT:  POST /api/interviews → 401
 *
 * Patroon gekopieerd van __tests__/whatsapp/routes.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

// Queues expliciet gemockt: scheduleInterview enqueuet post-commit 24h/1h
// reminder-jobs via interviewRemindersQueue (getJob + add). De globale
// bullmq-mock in setup.ts heeft geen getJob, dus zonder deze module-mock
// zou de enqueue stilletjes in de .catch() belanden — hier maken we hem
// echt observeerbaar.
vi.mock('../../src/queue/queues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/queue/queues')>();
  return {
    ...actual,
    interviewRemindersQueue: {
      getJob: vi.fn(async () => null),
      add: vi.fn(async () => ({ id: 'mock-reminder-job' })),
    },
  };
});

import { interviewsRouter } from '../../src/modules/interviews/interviews.router';
import { errorHandler } from '../../src/middleware/errorHandler';
import { interviewRemindersQueue } from '../../src/queue/queues';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const APP_ID = '33333333-3333-3333-3333-333333333333';
const CAND_ID = '44444444-4444-4444-4444-444444444444';
const INTERVIEWER_ID = '55555555-5555-5555-5555-555555555555';
const INTERVIEW_ID = '66666666-6666-6666-6666-666666666666';

function jwtTokenForRole(role: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'u@x.nl', role },
    process.env.JWT_SECRET!
  );
}

/** requirePermission('interviews', 'write') looks up the user's role
 * (+ any custom-role assignments) before the route handler runs.
 * NB: dezelfde users-tabel wordt óók door fetchUserEmail geraakt
 * (`SELECT email FROM users …`), dus de row bevat role + email. */
function withRoleMatcher(
  role: string,
  extra?: (sql: string) => { rows: unknown[]; rowCount: number } | undefined
) {
  return async (sql: string) => {
    if (/FROM\s+users\b/i.test(sql)) {
      return { rows: [{ role, email: 'interviewer@x.nl' }], rowCount: 1 };
    }
    if (/FROM\s+user_role_assignments\b/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    const extraResult = extra?.(sql);
    if (extraResult) return extraResult;
    return { rows: [], rowCount: 0 };
  };
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/interviews', interviewsRouter);
  app.use(errorHandler);
  return app;
}

// Ruim in de toekomst zodat zowel de 24h- als de 1h-reminderjob een positieve
// delay heeft en dus daadwerkelijk wordt geënqueued.
const START = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const END = new Date(START.getTime() + 60 * 60 * 1000);

const VALID_BODY = {
  application_id: APP_ID,
  scheduled_start: START.toISOString(),
  scheduled_end: END.toISOString(),
  interviewer_user_ids: [INTERVIEWER_ID],
};

/** DB-antwoorden voor de volledige scheduleInterview happy path. Volgorde
 * van checks is belangrijk: INSERT INTO interviews vóór FROM interviews
 * (conflict-check), anders slikt de FROM-regex ook de INSERT op. */
function happyPathMatcher() {
  return withRoleMatcher('recruiter', (sql) => {
    if (/INSERT\s+INTO\s+interviews\b/i.test(sql)) {
      return {
        rows: [
          {
            id: INTERVIEW_ID,
            tenant_id: TENANT_ID,
            application_id: APP_ID,
            stage_id: null,
            scheduled_start: START.toISOString(),
            scheduled_end: END.toISOString(),
            meeting_provider: 'google_meet',
            meeting_url: null,
            location: null,
            interview_kit_id: null,
            notes: null,
            status: 'scheduled',
            created_by: USER_ID,
            cancelled_at: null,
            cancellation_reason: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        rowCount: 1,
      };
    }
    if (/INSERT\s+INTO\s+interview_participants\b/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    if (/FROM\s+applications\b/i.test(sql)) {
      return {
        rows: [
          {
            id: APP_ID,
            candidate_id: CAND_ID,
            candidate_email: 'kandidaat@x.nl',
            first_name: 'Test',
            last_name: 'Kandidaat',
          },
        ],
        rowCount: 1,
      };
    }
    // Conflict-check: geen overlappende interviews voor deze interviewer.
    if (/FROM\s+interviews\b/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    return undefined;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JWT gating', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /api/interviews zonder JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp()).post('/api/interviews').send(VALID_BODY);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/interviews zonder JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp()).get('/api/interviews');
    expect(r.status).toBe(401);
  });
});

describe('permission gating — POST vereist interviews:write', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /api/interviews als viewer → 403 INSUFFICIENT_PERMISSION', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('viewer') });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/interviews')
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`)
      .send(VALID_BODY);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    expect(r.body.error.details.required).toEqual({
      resource: 'interviews',
      action: 'write',
    });
  });

  it('GET /api/interviews als viewer → 200 (read-routes blijven open)', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('viewer') });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .get('/api/interviews')
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });
});

describe('happy path — recruiter plant interview', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /api/interviews als recruiter → 201 met interview-body', async () => {
    const client = mockClient({ __matcher: happyPathMatcher() });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/interviews')
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`)
      .send(VALID_BODY);
    expect(r.status).toBe(201);
    expect(r.body.id).toBe(INTERVIEW_ID);
    expect(r.body.status).toBe('scheduled');
    expect(r.body.application_id).toBe(APP_ID);

    // Post-commit side-effect: 24h- én 1h-reminderjob op de gemockte queue.
    expect(interviewRemindersQueue.add).toHaveBeenCalledTimes(2);
    const kinds = (interviewRemindersQueue.add as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[1] as { kind: string }).kind
    );
    expect(kinds.sort()).toEqual(['1h', '24h']);

    // Participants: kandidaat + 1 interviewer geïnsert.
    const participantInserts = client.query.mock.calls.filter(([sql]) =>
      /INSERT\s+INTO\s+interview_participants\b/i.test(sql as string)
    );
    expect(participantInserts).toHaveLength(2);
  });

  it('POST /api/interviews met invalid body → 400 VALIDATION_ERROR (Zod draait ná de guard)', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('recruiter') });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/interviews')
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`)
      .send({ application_id: 'geen-uuid', interviewer_user_ids: [] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });
});

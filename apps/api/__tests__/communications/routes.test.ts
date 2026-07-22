/**
 * Authenticated communications routes smoke tests — systeem-audit bugklasse 3
 * ("het laatste draadje").
 *
 * Draait de ÉCHTE HTTP-routes van de communications-module inclusief de
 * requireAuth-, tenant- en requirePermission-middleware, met alleen de
 * DB-pool en de BullMQ-queue gemockt (queue-mock zit globaal in
 * __tests__/setup.ts). Patroon gekopieerd van __tests__/whatsapp/routes.test.ts.
 *
 * Dekking:
 *   - recruiter stuurt e-mailbericht → 2xx (201 per-candidate, 202 /send)
 *   - viewer op dezelfde write-routes → 403 INSUFFICIENT_PERMISSION
 *   - zonder JWT → 401
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Mock } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

import communicationsRouter from '../../src/modules/communications/communications.router';
import { errorHandler } from '../../src/middleware/errorHandler';
import { emailSenderQueue } from '../../src/queue/queues';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const COMM_ID = '44444444-4444-4444-4444-444444444444';

function jwtTokenForRole(role: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'u@x.nl', role },
    process.env.JWT_SECRET!
  );
}

/** requirePermission('communications', 'write') looks up the user's role
 * (+ any custom-role assignments) before the route handler runs. Lokale
 * kopie van de helper uit __tests__/whatsapp/routes.test.ts. */
function withRoleMatcher(
  role: string,
  extra?: (sql: string) => { rows: unknown[]; rowCount: number } | undefined
) {
  return async (sql: string) => {
    if (/FROM\s+users\b/i.test(sql)) return { rows: [{ role }], rowCount: 1 };
    if (/FROM\s+user_role_assignments\b/i.test(sql)) return { rows: [], rowCount: 0 };
    const extraResult = extra?.(sql);
    if (extraResult) return extraResult;
    return { rows: [], rowCount: 0 };
  };
}

/** SQL-matcher voor het happy-path e-mailpad in communications.service:
 * candidate-lookup → INSERT communications RETURNING * → INSERT activities. */
function emailHappyPathMatcher(role: string) {
  return withRoleMatcher(role, (sql) => {
    if (/FROM\s+candidates\b/i.test(sql)) {
      return {
        rows: [{ id: CAND_ID, email: 'kandidaat@example.com', name: 'Test Kandidaat' }],
        rowCount: 1,
      };
    }
    if (/INSERT\s+INTO\s+communications\b/i.test(sql)) {
      return {
        rows: [
          {
            id: COMM_ID,
            tenant_id: TENANT_ID,
            candidate_id: CAND_ID,
            channel: 'email',
            direction: 'outbound',
            subject: 'Hallo',
            body: '<p>Testbericht</p>',
            status: 'queued',
            sent_at: '2026-07-22T10:00:00.000Z',
            created_at: '2026-07-22T10:00:00.000Z',
          },
        ],
        rowCount: 1,
      };
    }
    if (/INSERT\s+INTO\s+activities\b/i.test(sql)) return { rows: [], rowCount: 1 };
    return undefined;
  });
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Zelfde mount-pad als in src/index.ts (regel: app.use('/api/communications', ...))
  app.use('/api/communications', communicationsRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  // Gerichte reset van alleen de queue-spy: de tests assert'en per-test op
  // call-counts van emailSenderQueue.add (globale bullmq-mock uit setup.ts).
  (emailSenderQueue.add as Mock).mockClear();
});

describe('JWT gating — zonder token → 401', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /candidates/:id/email zonder JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post(`/api/communications/candidates/${CAND_ID}/email`)
      .send({ subject: 'Hallo', body: 'Testbericht' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /send zonder JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/communications/send')
      .send({ candidate_id: CAND_ID, subject: 'Hallo', body_html: '<p>Test</p>' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /inbox zonder JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp()).get('/api/communications/inbox');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('recruiter happy path — e-mail versturen (queue gemockt)', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /candidates/:id/email als recruiter → 201, rij queued + job op emailSenderQueue', async () => {
    const client = mockClient({ __matcher: emailHappyPathMatcher('recruiter') });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post(`/api/communications/candidates/${CAND_ID}/email`)
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`)
      .send({ subject: 'Hallo', body: '<p>Testbericht</p>' });

    expect(r.status).toBe(201);
    expect(r.body.id).toBe(COMM_ID);
    expect(r.body.channel).toBe('email');
    expect(r.body.status).toBe('queued');

    // Delivery loopt via de (globaal gemockte) BullMQ-queue — geen echte send.
    expect(emailSenderQueue.add).toHaveBeenCalledTimes(1);
    expect(emailSenderQueue.add).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({
        tenantId: TENANT_ID,
        candidateId: CAND_ID,
        to: 'kandidaat@example.com',
        communicationId: COMM_ID,
      })
    );
  });

  it('POST /send (ComposeEmailModal-pad) als recruiter → 202 + job op emailSenderQueue', async () => {
    const client = mockClient({ __matcher: emailHappyPathMatcher('recruiter') });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/communications/send')
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`)
      .send({ candidate_id: CAND_ID, subject: 'Hallo', body_html: '<p>Testbericht</p>' });

    expect(r.status).toBe(202);
    expect(r.body.data.id).toBe(COMM_ID);
    expect(r.body.data.status).toBe('queued');
    expect(emailSenderQueue.add).toHaveBeenCalledTimes(1);
  });
});

describe('permission gating — viewer → 403 op write-routes', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /candidates/:id/email als viewer → 403 INSUFFICIENT_PERMISSION', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('viewer') });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post(`/api/communications/candidates/${CAND_ID}/email`)
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`)
      .send({ subject: 'Hallo', body: 'Testbericht' });

    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    // De service mag nooit bereikt zijn — geen queue-job.
    expect(emailSenderQueue.add).not.toHaveBeenCalled();
  });

  it('POST /send als viewer → 403 INSUFFICIENT_PERMISSION', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('viewer') });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/communications/send')
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`)
      .send({ candidate_id: CAND_ID, subject: 'Hallo', body_html: '<p>Test</p>' });

    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    expect(emailSenderQueue.add).not.toHaveBeenCalled();
  });

  it('GET /inbox als viewer → 200 (read-routes blijven open voor viewer)', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('viewer') });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .get('/api/communications/inbox')
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
  });
});

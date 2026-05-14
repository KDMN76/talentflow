import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

vi.mock('passport-saml', () => ({
  default: {
    Strategy: class {},
    SAML: class {},
  },
}));

import scimRouter from '../../src/modules/auth/scim.controller';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SCIM_TOKEN = 'tflw_scim_test123';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/scim/v2', scimRouter);
  app.use(errorHandler);
  return app;
}

function mockScimAuthOk(extra: (sql: string, params: unknown[]) => unknown = () => ({ rows: [], rowCount: 0 })): MockClient {
  return mockClient({
    __matcher: (sql, params) => {
      // SCIM auth: scan over tenants, bcrypt-compare hash
      if (/FROM tenant_sso_config\s+WHERE scim_enabled/i.test(sql)) {
        return {
          rows: [{ tenant_id: TENANT_ID, scim_token_hash: `bcrypt$${SCIM_TOKEN}` }],
          rowCount: 1,
        };
      }
      const r = extra(sql, params);
      if (r) return r as { rows: unknown[]; rowCount: number };
      return { rows: [], rowCount: 0 };
    },
  });
}

describe('SCIM /Users — list/get/create', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /Users zonder bearer → 401', async () => {
    const client = mockScimAuthOk();
    teardown = installPoolMock(client);
    const app = buildApp();
    const res = await request(app).get('/scim/v2/Users');
    expect(res.status).toBe(401);
  });

  it('GET /Users → ListResponse', async () => {
    const client = mockScimAuthOk((sql) => {
      if (/SELECT COUNT/i.test(sql)) {
        return { rows: [{ c: '1' }], rowCount: 1 };
      }
      if (/SELECT id, email, name, role/i.test(sql)) {
        return {
          rows: [
            {
              id: USER_ID,
              email: 'jane@acme.nl',
              name: 'Jane Doe',
              role: 'recruiter',
              is_active: true,
              deleted_at: null,
              scim_external_id: 'okta-123',
              created_at: new Date('2026-01-01'),
            },
          ],
          rowCount: 1,
        };
      }
      return null;
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const res = await request(app)
      .get('/scim/v2/Users')
      .set('Authorization', `Bearer ${SCIM_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0].userName).toBe('jane@acme.nl');
    expect(res.body.Resources[0].name.givenName).toBe('Jane');
    expect(res.body.Resources[0].name.familyName).toBe('Doe');
  });

  it('POST /Users → 201 + audit + scim-log', async () => {
    let scimLogged = false;
    const client = mockScimAuthOk((sql) => {
      if (/SELECT tenant_id, provider, enabled/i.test(sql)) {
        return {
          rows: [
            {
              tenant_id: TENANT_ID,
              provider: 'okta',
              enabled: true,
              entry_point: 'https://x',
              issuer: 'tflw',
              idp_cert: 'cert',
              scim_enabled: true,
              scim_token_hash: 'h',
              auto_create_users: true,
              default_role: 'recruiter',
              attribute_mapping: {},
            },
          ],
          rowCount: 1,
        };
      }
      if (/INSERT INTO users/i.test(sql)) {
        return {
          rows: [
            {
              id: USER_ID,
              email: 'new@acme.nl',
              name: 'New User',
              role: 'recruiter',
              is_active: true,
              deleted_at: null,
              scim_external_id: 'okta-99',
              created_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
      if (/INSERT INTO scim_provisioning_log/i.test(sql)) {
        scimLogged = true;
        return { rows: [], rowCount: 1 };
      }
      return null;
    });
    teardown = installPoolMock(client);
    const app = buildApp();

    const res = await request(app)
      .post('/scim/v2/Users')
      .set('Authorization', `Bearer ${SCIM_TOKEN}`)
      .send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'new@acme.nl',
        externalId: 'okta-99',
        name: { givenName: 'New', familyName: 'User' },
        emails: [{ value: 'new@acme.nl', primary: true, type: 'work' }],
        active: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.userName).toBe('new@acme.nl');
    expect(scimLogged).toBe(true);
  });

  it('PATCH /Users/:id active=false → deactivate', async () => {
    let updateSql: string | undefined;
    const client = mockScimAuthOk((sql, params) => {
      if (/SELECT id, email, name, role, is_active, deleted_at, scim_external_id, created_at\s+FROM users/i.test(sql)) {
        return {
          rows: [
            {
              id: USER_ID,
              email: 'jane@acme.nl',
              name: 'Jane Doe',
              role: 'recruiter',
              is_active: true,
              deleted_at: null,
              scim_external_id: 'okta-1',
              created_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
      if (/UPDATE users\s+SET email = \$1/i.test(sql)) {
        updateSql = sql;
        return {
          rows: [
            {
              id: USER_ID,
              email: 'jane@acme.nl',
              name: 'Jane Doe',
              role: 'recruiter',
              is_active: params[3] as boolean,
              deleted_at: params[3] === false ? new Date() : null,
              scim_external_id: 'okta-1',
              created_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
      return null;
    });
    teardown = installPoolMock(client);
    const app = buildApp();

    const res = await request(app)
      .patch(`/scim/v2/Users/${USER_ID}`)
      .set('Authorization', `Bearer ${SCIM_TOKEN}`)
      .send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'Replace', path: 'active', value: false }],
      });

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    expect(updateSql).toBeTruthy();
  });

  it('DELETE /Users/:id → 204 + soft-delete', async () => {
    const client = mockScimAuthOk((sql) => {
      if (/UPDATE users\s+SET deleted_at = now/i.test(sql)) {
        return {
          rows: [{ id: USER_ID, scim_external_id: 'okta-1' }],
          rowCount: 1,
        };
      }
      return null;
    });
    teardown = installPoolMock(client);
    const app = buildApp();

    const res = await request(app)
      .delete(`/scim/v2/Users/${USER_ID}`)
      .set('Authorization', `Bearer ${SCIM_TOKEN}`);
    expect(res.status).toBe(204);
  });

  it('GET /ServiceProviderConfig → public + correcte schemas', async () => {
    const client = mockClient({ __matcher: () => ({ rows: [], rowCount: 0 }) });
    teardown = installPoolMock(client);
    const app = buildApp();
    const res = await request(app).get('/scim/v2/ServiceProviderConfig');
    expect(res.status).toBe(200);
    expect(res.body.schemas[0]).toContain('ServiceProviderConfig');
    expect(res.body.patch.supported).toBe(true);
    expect(res.body.bulk.supported).toBe(false);
  });
});

describe('SCIM /Groups — read-only role groups', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /Groups → list met canonieke roles', async () => {
    const client = mockScimAuthOk((sql) => {
      if (/SELECT role,/i.test(sql)) {
        return {
          rows: [
            { role: 'admin', member_id: USER_ID, member_name: 'Jane' },
          ],
          rowCount: 1,
        };
      }
      return null;
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const res = await request(app)
      .get('/scim/v2/Groups')
      .set('Authorization', `Bearer ${SCIM_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.Resources.find((g: { id: string }) => g.id === 'admin').members).toHaveLength(1);
  });

  it('POST /Groups → 409 (read-only)', async () => {
    const client = mockScimAuthOk();
    teardown = installPoolMock(client);
    const app = buildApp();
    const res = await request(app)
      .post('/scim/v2/Groups')
      .set('Authorization', `Bearer ${SCIM_TOKEN}`)
      .send({ displayName: 'CustomRole' });
    expect(res.status).toBe(409);
  });

  it('PATCH /Groups/admin → assigns role', async () => {
    let assigned = false;
    const client = mockScimAuthOk((sql) => {
      if (/UPDATE users SET role = \$1/i.test(sql)) {
        assigned = true;
        return { rows: [], rowCount: 1 };
      }
      return null;
    });
    teardown = installPoolMock(client);
    const app = buildApp();
    const res = await request(app)
      .patch('/scim/v2/Groups/admin')
      .set('Authorization', `Bearer ${SCIM_TOKEN}`)
      .send({
        Operations: [
          { op: 'add', path: 'members', value: [{ value: USER_ID }] },
        ],
      });
    expect(res.status).toBe(204);
    expect(assigned).toBe(true);
  });
});

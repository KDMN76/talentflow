/**
 * Custom roles service tests — Sprint Q4.2.
 *
 * Tests:
 *   - listRoles geeft system + custom samen
 *   - createCustomRole valideert key (snake_case + niet-gereserveerd)
 *   - createCustomRole 409 bij duplicate key
 *   - updateCustomRole respecteert is_default-uniqueness
 *   - deleteCustomRole geblokkeerd als active assignments bestaan
 *   - deleteCustomRole succesvol bij 0 assignments
 *   - assignRoleToUser werkt voor system + custom rollen
 *   - assignRoleToUser 404 bij onbekende user
 *   - getSecuritySettings lazy-init bij missende rij
 *   - updateSecuritySettings audit-event geschreven
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mockClient,
  installPoolMock,
  type MockClient,
} from '../helpers/dbMock';
import * as service from '../../src/modules/roles/customRoles.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TARGET_USER_ID = '33333333-3333-3333-3333-333333333333';
const ROLE_ID = '44444444-4444-4444-4444-444444444444';
const ASSIGNMENT_ID = '55555555-5555-5555-5555-555555555555';

describe('listRoles', () => {
  let teardown: () => void;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('combineert system + custom rollen met user_count', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM tenant_custom_roles/i.test(sql)) {
          return {
            rows: [
              {
                id: ROLE_ID,
                tenant_id: TENANT_ID,
                key: 'senior_recruiter',
                label: 'Senior Recruiter',
                description: 'Senior',
                permissions: { candidates: { read: true, write: true } },
                inherits_from: 'recruiter',
                is_system: false,
                is_default: false,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM user_role_assignments/i.test(sql)) {
          return {
            rows: [
              { role_id: null, role_key: 'admin', cnt: '2' },
              { role_id: ROLE_ID, role_key: 'senior_recruiter', cnt: '5' },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const data = await service.listRoles(TENANT_ID);
    const keys = data.map((r) => r.key);
    expect(keys).toContain('admin');
    expect(keys).toContain('recruiter');
    expect(keys).toContain('senior_recruiter');

    const adminRole = data.find((r) => r.key === 'admin')!;
    expect(adminRole.is_system).toBe(true);
    expect(adminRole.user_count).toBe(2);

    const custom = data.find((r) => r.key === 'senior_recruiter')!;
    expect(custom.is_system).toBe(false);
    expect(custom.user_count).toBe(5);
  });
});

describe('createCustomRole — validation', () => {
  let teardown: () => void;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('weigert non-snake_case key', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      service.createCustomRole(TENANT_ID, USER_ID, {
        key: 'CamelCase',
        label: 'X',
        permissions: {},
      })
    ).rejects.toMatchObject({ code: 'INVALID_ROLE_KEY' });
  });

  it('weigert gereserveerde system-key', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      service.createCustomRole(TENANT_ID, USER_ID, {
        key: 'admin',
        label: 'X',
        permissions: {},
      })
    ).rejects.toMatchObject({ code: 'ROLE_KEY_RESERVED' });
  });

  it('weigert onbekende inherits_from', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      service.createCustomRole(TENANT_ID, USER_ID, {
        key: 'foo',
        label: 'X',
        permissions: {},
        inherits_from: 'galactic_overlord',
      })
    ).rejects.toMatchObject({ code: 'INVALID_INHERITS_FROM' });
  });

  it('returnt 409 bij duplicate key', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (
          /SELECT id FROM tenant_custom_roles/i.test(sql) ||
          /FROM tenant_custom_roles/i.test(sql)
        ) {
          return { rows: [{ id: 'existing-id' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      service.createCustomRole(TENANT_ID, USER_ID, {
        key: 'senior_recruiter',
        label: 'X',
        permissions: {},
      })
    ).rejects.toMatchObject({ code: 'ROLE_KEY_EXISTS' });
  });

  it('schrijft een rij + audit-event bij succes', async () => {
    let inserted = false;
    let auditWritten = false;
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM tenant_custom_roles/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO tenant_custom_roles/i.test(sql)) {
          inserted = true;
          return {
            rows: [
              {
                id: ROLE_ID,
                tenant_id: TENANT_ID,
                key: 'senior_recruiter',
                label: 'Senior Recruiter',
                description: null,
                permissions: { candidates: { read: true } },
                inherits_from: null,
                is_system: false,
                is_default: false,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          auditWritten = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const role = await service.createCustomRole(TENANT_ID, USER_ID, {
      key: 'senior_recruiter',
      label: 'Senior Recruiter',
      permissions: { candidates: { read: true } },
    });
    expect(inserted).toBe(true);
    expect(auditWritten).toBe(true);
    expect(role.key).toBe('senior_recruiter');
    expect(role.is_system).toBe(false);
  });
});

describe('deleteCustomRole', () => {
  let teardown: () => void;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('geblokkeerd 409 als active assignments bestaan', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/user_role_assignments/i.test(sql)) {
          return { rows: [{ cnt: '3' }], rowCount: 1 };
        }
        if (/FROM tenant_custom_roles/i.test(sql)) {
          return {
            rows: [
              {
                id: ROLE_ID,
                tenant_id: TENANT_ID,
                key: 'x',
                label: 'X',
                description: null,
                permissions: {},
                inherits_from: null,
                is_system: false,
                is_default: false,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      service.deleteCustomRole(TENANT_ID, ROLE_ID, USER_ID)
    ).rejects.toMatchObject({ code: 'ROLE_IN_USE' });
  });

  it('verwijdert succesvol als geen assignments', async () => {
    let deleted = false;
    const client = mockClient({
      __matcher: (sql) => {
        if (/user_role_assignments/i.test(sql)) {
          return { rows: [{ cnt: '0' }], rowCount: 1 };
        }
        if (/DELETE FROM tenant_custom_roles/i.test(sql)) {
          deleted = true;
          return { rows: [], rowCount: 1 };
        }
        if (/FROM tenant_custom_roles\b/i.test(sql)) {
          return {
            rows: [
              {
                id: ROLE_ID,
                tenant_id: TENANT_ID,
                key: 'x',
                label: 'X',
                description: null,
                permissions: {},
                inherits_from: null,
                is_system: false,
                is_default: false,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await service.deleteCustomRole(TENANT_ID, ROLE_ID, USER_ID);
    expect(deleted).toBe(true);
  });

  it('404 als rol niet bestaat', async () => {
    const client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      service.deleteCustomRole(TENANT_ID, ROLE_ID, USER_ID)
    ).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
  });
});

describe('assignRoleToUser', () => {
  let teardown: () => void;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('werkt met system-rol (admin)', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM users/i.test(sql)) {
          return { rows: [{ id: TARGET_USER_ID }], rowCount: 1 };
        }
        if (/INSERT INTO user_role_assignments/i.test(sql)) {
          return {
            rows: [
              {
                id: ASSIGNMENT_ID,
                tenant_id: TENANT_ID,
                user_id: TARGET_USER_ID,
                role_id: null,
                role_key: 'admin',
                assigned_at: '2024-01-01T00:00:00Z',
                assigned_by: USER_ID,
                expires_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await service.assignRoleToUser(
      TENANT_ID,
      USER_ID,
      TARGET_USER_ID,
      'admin'
    );
    expect(result.role_key).toBe('admin');
    expect(result.is_system).toBe(true);
    expect(result.role_label).toBe('Admin');
  });

  it('werkt met custom-rol (key resolved naar role_id)', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM users/i.test(sql)) {
          return { rows: [{ id: TARGET_USER_ID }], rowCount: 1 };
        }
        if (/FROM tenant_custom_roles/i.test(sql)) {
          return {
            rows: [
              {
                id: ROLE_ID,
                tenant_id: TENANT_ID,
                key: 'senior_recruiter',
                label: 'Senior Recruiter',
                description: null,
                permissions: {},
                inherits_from: 'recruiter',
                is_system: false,
                is_default: false,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO user_role_assignments/i.test(sql)) {
          return {
            rows: [
              {
                id: ASSIGNMENT_ID,
                tenant_id: TENANT_ID,
                user_id: TARGET_USER_ID,
                role_id: ROLE_ID,
                role_key: 'senior_recruiter',
                assigned_at: '2024-01-01T00:00:00Z',
                assigned_by: USER_ID,
                expires_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await service.assignRoleToUser(
      TENANT_ID,
      USER_ID,
      TARGET_USER_ID,
      'senior_recruiter'
    );
    expect(result.role_id).toBe(ROLE_ID);
    expect(result.is_system).toBe(false);
    expect(result.role_label).toBe('Senior Recruiter');
  });

  it('404 als user niet bestaat', async () => {
    const client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      service.assignRoleToUser(TENANT_ID, USER_ID, TARGET_USER_ID, 'admin')
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('409 bij dubbele assignment (unique-violation)', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM users/i.test(sql)) {
          return { rows: [{ id: TARGET_USER_ID }], rowCount: 1 };
        }
        if (/INSERT INTO user_role_assignments/i.test(sql)) {
          const err = new Error('duplicate key') as Error & { code: string };
          err.code = '23505';
          throw err;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      service.assignRoleToUser(TENANT_ID, USER_ID, TARGET_USER_ID, 'admin')
    ).rejects.toMatchObject({ code: 'ROLE_ALREADY_ASSIGNED' });
  });
});

describe('SecuritySettings', () => {
  let teardown: () => void;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('lazy-init creëert defaults bij missende rij', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM tenant_security_settings/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO tenant_security_settings/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                ip_allowlist: [],
                ip_allowlist_enforced: false,
                session_timeout_minutes: 1440,
                password_min_length: 12,
                password_require_special: true,
                password_max_age_days: null,
                failed_login_lockout_threshold: 5,
                failed_login_lockout_minutes: 30,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const data = await service.getSecuritySettings(TENANT_ID);
    expect(data.tenant_id).toBe(TENANT_ID);
    expect(data.ip_allowlist_enforced).toBe(false);
    expect(data.password_min_length).toBe(12);
  });

  it('updateSecuritySettings schrijft audit-event', async () => {
    let auditWritten = false;
    let updateExecuted = false;
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM tenant_security_settings/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                ip_allowlist: [],
                ip_allowlist_enforced: false,
                session_timeout_minutes: 1440,
                password_min_length: 12,
                password_require_special: true,
                password_max_age_days: null,
                failed_login_lockout_threshold: 5,
                failed_login_lockout_minutes: 30,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE tenant_security_settings/i.test(sql)) {
          updateExecuted = true;
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                ip_allowlist: ['10.0.0.0/8'],
                ip_allowlist_enforced: true,
                session_timeout_minutes: 1440,
                password_min_length: 12,
                password_require_special: true,
                password_max_age_days: null,
                failed_login_lockout_threshold: 5,
                failed_login_lockout_minutes: 30,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:01Z',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          auditWritten = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const data = await service.updateSecuritySettings(TENANT_ID, USER_ID, {
      ip_allowlist: ['10.0.0.0/8'],
      ip_allowlist_enforced: true,
    });
    expect(updateExecuted).toBe(true);
    expect(auditWritten).toBe(true);
    expect(data.ip_allowlist_enforced).toBe(true);
  });
});

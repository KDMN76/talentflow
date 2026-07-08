/**
 * Tests voor de module-flags service (migration 050).
 *
 * Dekt de default-semantiek (nieuwe tenants: alles aan behalve bevroren
 * features), grandfathering (expliciete alles-aan-rij uit de migratie),
 * merge-gedrag bij gedeeltelijke/corrupte rijen en de update-flow
 * (volledige map terugschrijven + audit-event).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';
import {
  MODULE_KEYS,
  FROZEN_MODULE_KEYS,
  defaultModuleFlags,
  resolveModuleFlags,
  getModuleFlags,
  updateModuleFlags,
  isModuleKey,
} from '../../src/modules/tenants/moduleFlags.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

describe('moduleFlags service — defaults', () => {
  it('defaultModuleFlags: alles aan behalve bevroren features (voice/whatsapp)', () => {
    const flags = defaultModuleFlags();
    for (const key of MODULE_KEYS) {
      if (FROZEN_MODULE_KEYS.includes(key)) {
        expect(flags[key], `${key} hoort default UIT`).toBe(false);
      } else {
        expect(flags[key], `${key} hoort default AAN`).toBe(true);
      }
    }
  });

  it('resolveModuleFlags: geen rij (undefined) → defaults', () => {
    expect(resolveModuleFlags(undefined)).toEqual(defaultModuleFlags());
    expect(resolveModuleFlags(null)).toEqual(defaultModuleFlags());
  });

  it('resolveModuleFlags: grandfather-rij (alles expliciet true) → alles aan, ook voice/whatsapp', () => {
    const stored = Object.fromEntries(MODULE_KEYS.map((k) => [k, true]));
    const flags = resolveModuleFlags(stored);
    for (const key of MODULE_KEYS) {
      expect(flags[key], `${key} hoort AAN (grandfathered)`).toBe(true);
    }
  });

  it('resolveModuleFlags: gedeeltelijke rij → ontbrekende keys vallen terug op per-key default', () => {
    const flags = resolveModuleFlags({ outreach: false });
    expect(flags.outreach).toBe(false); // expliciet uit
    expect(flags.recruit_to_cash).toBe(true); // ontbreekt → default aan
    expect(flags.voice).toBe(false); // ontbreekt → bevroren default uit
    expect(flags.whatsapp).toBe(false);
  });

  it('resolveModuleFlags: onbekende keys en niet-boolean waarden worden genegeerd', () => {
    const flags = resolveModuleFlags({
      not_a_module: true,
      outreach: 'yes', // garbage → default
      job_boards: false,
    } as unknown);
    expect('not_a_module' in flags).toBe(false);
    expect(flags.outreach).toBe(true); // garbage genegeerd → default aan
    expect(flags.job_boards).toBe(false);
  });

  it('resolveModuleFlags: arrays/strings → defaults (corrupte rij is nooit fataal)', () => {
    expect(resolveModuleFlags([])).toEqual(defaultModuleFlags());
    expect(resolveModuleFlags('kapot')).toEqual(defaultModuleFlags());
  });

  it('isModuleKey: kent alle module-keys, weigert de rest', () => {
    for (const key of MODULE_KEYS) expect(isModuleKey(key)).toBe(true);
    expect(isModuleKey('dashboard')).toBe(false); // kern is geen module
    expect(isModuleKey('')).toBe(false);
  });
});

describe('moduleFlags service — getModuleFlags (DB)', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('geen rij in tenant_module_settings → defaults (nieuwe tenant)', async () => {
    const client = mockClient({ tenant_module_settings: [] });
    teardown = installPoolMock(client);

    const flags = await getModuleFlags(TENANT_ID);
    expect(flags).toEqual(defaultModuleFlags());
  });

  it('grandfather-rij → alles aan inclusief voice/whatsapp', async () => {
    const stored = Object.fromEntries(MODULE_KEYS.map((k) => [k, true]));
    const client = mockClient({
      tenant_module_settings: [{ modules: stored }],
    });
    teardown = installPoolMock(client);

    const flags = await getModuleFlags(TENANT_ID);
    expect(flags.voice).toBe(true);
    expect(flags.whatsapp).toBe(true);
    expect(flags.recruit_to_cash).toBe(true);
  });
});

describe('moduleFlags service — updateModuleFlags', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('schrijft de volledige effectieve map terug en logt een audit-event', async () => {
    const client = mockClient({
      __matcher: (sql: string) => {
        if (/SELECT modules FROM tenant_module_settings/i.test(sql)) {
          return { rows: [], rowCount: 0 }; // nieuwe tenant, geen rij
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const flags = await updateModuleFlags(
      TENANT_ID,
      { outreach: false },
      USER_ID,
      {}
    );

    expect(flags.outreach).toBe(false);
    expect(flags.recruit_to_cash).toBe(true);

    const calls = client.query.mock.calls.map((c) => String(c[0]));
    const upsert = calls.find((sql) =>
      /INSERT INTO tenant_module_settings/i.test(sql)
    );
    expect(upsert, 'verwacht upsert op tenant_module_settings').toBeTruthy();
    expect(upsert).toMatch(/ON CONFLICT \(tenant_id\) DO UPDATE/i);

    const audit = calls.find((sql) => /INSERT INTO audit_events/i.test(sql));
    expect(audit, 'verwacht audit-event bij module-wijziging').toBeTruthy();

    // De weggeschreven map bevat ALLE keys (self-contained rij).
    const upsertCall = client.query.mock.calls.find((c) =>
      /INSERT INTO tenant_module_settings/i.test(String(c[0]))
    );
    const written = JSON.parse((upsertCall![1] as unknown[])[1] as string);
    expect(Object.keys(written).sort()).toEqual([...MODULE_KEYS].sort());
  });

  it('weigert een patch zonder geldige module-keys', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);

    await expect(
      updateModuleFlags(
        TENANT_ID,
        { onzin: true } as never,
        USER_ID,
        {}
      )
    ).rejects.toMatchObject({ code: 'NO_FIELDS' });
  });
});

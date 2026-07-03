/**
 * encryption.ts — AES-256-GCM round-trip + key-resolutie.
 *
 * Dekt:
 *   - encrypt/decrypt round-trip (incl. unicode en lange strings)
 *   - tamper-detectie via de GCM auth-tag
 *   - production-fallback: key afgeleid uit JWT_SECRET via scrypt
 *     (deterministisch over "processen" heen — cache-reset simuleert dat)
 *   - fail-fast wanneer production geen ENCRYPTION_KEY én geen bruikbaar
 *     JWT_SECRET heeft
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  _resetEncryptionKeyCacheForTests,
} from '../../src/lib/encryption';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
};

function restoreEnv(): void {
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  if (ORIGINAL_ENV.ENCRYPTION_KEY === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = ORIGINAL_ENV.ENCRYPTION_KEY;
  }
  if (ORIGINAL_ENV.JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_ENV.JWT_SECRET;
  }
  _resetEncryptionKeyCacheForTests();
}

afterEach(restoreEnv);

describe('encryption round-trip (dev/test key)', () => {
  it('decrypt(encrypt(x)) geeft x terug', () => {
    const plain = 'sm4p-Wachtw00rd!';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('werkt met unicode en lange strings', () => {
    const plain = `pässwörd-€✓-${'x'.repeat(5000)}`;
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('twee encrypties van dezelfde plaintext geven verschillende blobs (random IV)', () => {
    const a = encrypt('zelfde');
    const b = encrypt('zelfde');
    expect(a.equals(b)).toBe(false);
    expect(decrypt(a)).toBe('zelfde');
    expect(decrypt(b)).toBe('zelfde');
  });

  it('gooit bij tampering (auth-tag mismatch)', () => {
    const blob = encrypt('geheim');
    blob[blob.length - 1] ^= 0xff; // flip een ciphertext-byte
    expect(() => decrypt(blob)).toThrow();
  });

  it('gooit op een te kort/ongeldig blob', () => {
    expect(() => decrypt(Buffer.from('kort'))).toThrow(/te kort/);
  });

  it('encryptJson/decryptJson round-trippen objecten', () => {
    const value = { host: 'smtp.example.com', port: 587, nested: { ok: true } };
    expect(decryptJson(encryptJson(value))).toEqual(value);
  });
});

describe('production key-afleiding uit JWT_SECRET (scrypt)', () => {
  it('zonder ENCRYPTION_KEY maar mét JWT_SECRET: round-trip werkt', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENCRYPTION_KEY;
    process.env.JWT_SECRET = 's'.repeat(48);
    _resetEncryptionKeyCacheForTests();

    const blob = encrypt('smtp-wachtwoord');
    expect(decrypt(blob)).toBe('smtp-wachtwoord');
  });

  it('afgeleide key is deterministisch over proces-herstarts heen', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENCRYPTION_KEY;
    process.env.JWT_SECRET = 's'.repeat(48);
    _resetEncryptionKeyCacheForTests();

    const blob = encrypt('persistent-geheim');

    // Simuleer een nieuw proces: cache weg, zelfde env → zelfde key.
    _resetEncryptionKeyCacheForTests();
    expect(decrypt(blob)).toBe('persistent-geheim');
  });

  it('een ANDER JWT_SECRET kan een eerder blob niet lezen', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'a'.repeat(48);
    _resetEncryptionKeyCacheForTests();
    const blob = encrypt('geheim');

    process.env.JWT_SECRET = 'b'.repeat(48);
    _resetEncryptionKeyCacheForTests();
    expect(() => decrypt(blob)).toThrow();
  });

  it('fail-fast zonder ENCRYPTION_KEY en zonder bruikbaar JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'te-kort'; // < 32 tekens
    _resetEncryptionKeyCacheForTests();

    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/);
  });

  it('expliciete ENCRYPTION_KEY heeft voorrang op JWT_SECRET-afleiding', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENCRYPTION_KEY = 'ab'.repeat(32); // 64 hex chars
    process.env.JWT_SECRET = 's'.repeat(48);
    _resetEncryptionKeyCacheForTests();
    const blobWithKey = encrypt('geheim');

    // Zelfde JWT_SECRET maar zonder ENCRYPTION_KEY → andere key → decrypt faalt.
    delete process.env.ENCRYPTION_KEY;
    _resetEncryptionKeyCacheForTests();
    expect(() => decrypt(blobWithKey)).toThrow();
  });
});

/**
 * AES-256-GCM symmetric encryption helper — Sprint Q4.3.
 *
 * Wordt gebruikt voor het versleutelen van OAuth-tokens en API-keys van
 * job-board integraties (`job_board_integrations.credentials_encrypted`).
 * Format van het ciphertext-blob:
 *
 *     [12 bytes IV][16 bytes auth tag][N bytes ciphertext]
 *
 * Key resolutie:
 *   - production: `process.env.ENCRYPTION_KEY` MOET een 32-byte (64-hex)
 *     key zijn. Anders gooien we direct fail-fast.
 *   - dev/test  : fallback naar een fixed test-key (`talentflow-dev-key-…`)
 *     gehashed naar 32 bytes. Dit voorkomt dat lokale tests breken zonder
 *     env-var, terwijl production-deploys altijd een echte key vereisen.
 *
 * Boil the ocean: gebruik dit overal waar we langlopende secrets in de DB
 * persisteren — niet alleen job-boards.
 */

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit IV is GCM-aanbevolen
const TAG_LEN = 16;
const DEV_KEY_SEED = 'talentflow-dev-encryption-key-NOT-FOR-PROD';

let cachedKey: Buffer | null = null;

function resolveKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ENCRYPTION_KEY;

  if (raw && raw.length > 0) {
    // Hex (64 chars) of base64 (44 chars met padding) accepteren we.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      cachedKey = Buffer.from(raw, 'hex');
    } else {
      try {
        const buf = Buffer.from(raw, 'base64');
        if (buf.length === 32) {
          cachedKey = buf;
        }
      } catch {
        /* val door naar de fallback hieronder */
      }
    }
    if (cachedKey) return cachedKey;

    // Te kort/te lang/onleesbaar → in production HARD FAIL.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[encryption] ENCRYPTION_KEY moet exact 32 bytes (hex of base64) zijn'
      );
    }
    // In dev: hash de raw-string naar 32 bytes zodat het werkt zonder strict format.
    cachedKey = crypto.createHash('sha256').update(raw).digest();
    return cachedKey;
  }

  // Geen env-var → in production fail, anders dev-fallback.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[encryption] ENCRYPTION_KEY is required in production');
  }
  cachedKey = crypto.createHash('sha256').update(DEV_KEY_SEED).digest();
  return cachedKey;
}

/**
 * Versleutel UTF-8 plaintext naar één gecombineerde Buffer.
 */
export function encrypt(plaintext: string): Buffer {
  const key = resolveKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

/**
 * Decrypt een eerder ge-encrypte Buffer terug naar UTF-8 string.
 * Gooit als de auth-tag niet matcht (tampering detected).
 */
export function decrypt(blob: Buffer): string {
  if (!Buffer.isBuffer(blob) || blob.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('[encryption] ciphertext blob is te kort of geen Buffer');
  }
  const key = resolveKey();
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * Convenience: encrypt een willekeurig JSON-serialiseerbaar object.
 */
export function encryptJson(value: unknown): Buffer {
  return encrypt(JSON.stringify(value));
}

/**
 * Convenience: decrypt + JSON.parse.
 */
export function decryptJson<T = unknown>(blob: Buffer): T {
  return JSON.parse(decrypt(blob)) as T;
}

/**
 * Test-helper — reset de cached key zodat env-mutaties effect hebben.
 * Niet voor production-gebruik.
 */
export function _resetEncryptionKeyCacheForTests(): void {
  cachedKey = null;
}

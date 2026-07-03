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
 *   - production: `process.env.ENCRYPTION_KEY` (32-byte hex/base64) heeft
 *     voorrang. Ontbreekt die, dan leiden we een key af via
 *     `scrypt(JWT_SECRET, vaste salt)` — zie `deriveKeyFromJwtSecret()`
 *     voor de afweging. Alleen als óók JWT_SECRET ontbreekt: fail-fast.
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

// Vaste, publieke salt voor de scrypt-afleiding uit JWT_SECRET. De salt hoeft
// niet geheim te zijn (de entropie komt uit JWT_SECRET); hij moet alleen VAST
// zijn zodat encrypt/decrypt over processen heen dezelfde key opleveren.
const JWT_DERIVE_SALT = 'talentflow-encryption-v1';

let cachedKey: Buffer | null = null;

/**
 * Production-fallback zonder nieuwe env-var: leid de AES-key af uit het al
 * aanwezige JWT_SECRET via scrypt met een vaste salt.
 *
 * Afweging (bewust gedocumenteerd):
 *   + Geen nieuwe prod-secret nodig — JWT_SECRET staat al in de compose-env
 *     van zowel `api` als `api-worker` (ENCRYPTION_KEY staat daar NIET).
 *   + scrypt is memory-hard; zelfs bij een matig JWT_SECRET is brute-force
 *     op de afgeleide key duurder dan op een kale SHA-256.
 *   − Key-rotatie van JWT_SECRET maakt bestaande blobs onleesbaar. Dat is
 *     acceptabel voor SMTP-wachtwoorden (opnieuw invoeren in Settings) maar
 *     zet je géén onvervangbare data mee vast.
 *   − Wordt later alsnog ENCRYPTION_KEY gezet, dan wint die en zijn eerder
 *     met de afgeleide key versleutelde blobs onleesbaar → herinvoeren.
 */
function deriveKeyFromJwtSecret(jwtSecret: string): Buffer {
  return crypto.scryptSync(jwtSecret, JWT_DERIVE_SALT, 32);
}

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

  // Geen ENCRYPTION_KEY → production: afleiden uit JWT_SECRET (zie
  // deriveKeyFromJwtSecret voor de trade-off), anders dev-fallback.
  if (process.env.NODE_ENV === 'production') {
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret && jwtSecret.length >= 32) {
      cachedKey = deriveKeyFromJwtSecret(jwtSecret);
      return cachedKey;
    }
    throw new Error(
      '[encryption] ENCRYPTION_KEY (of een JWT_SECRET van ≥32 tekens) is vereist in production'
    );
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

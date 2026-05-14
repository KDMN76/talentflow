/**
 * TOTP helpers — wrapt `otplib` met TalentFlow-specifieke configuratie:
 *   - Issuer = "TalentFlow"
 *   - Window = 1 (sta klok-drift van ±30s toe)
 *   - Algoritme + digits = standaard RFC 6238 (SHA1 / 6 digits / 30s)
 *
 * Apart bestand zodat de service-laag puur business-logica blijft en de
 * 2FA-tests gemakkelijk een fixed secret + token-generation kunnen mocken.
 */

import { authenticator } from 'otplib';
import crypto from 'crypto';

// Default-config overschrijven naar wat we willen — `authenticator` houdt
// state tussen calls, dus dit is process-globaal. Eénmalig instellen.
authenticator.options = {
  // Sta één tijdstap aan elke kant toe voor klok-drift (totaal 90s window).
  window: 1,
  // 30s standaard step — RFC 6238 default.
  step: 30,
  digits: 6,
};

const ISSUER = 'TalentFlow';

export function generateSecret(): string {
  return authenticator.generateSecret();
}

/**
 * Build de otpauth-URI die in een QR-code geëncodeerd wordt zodat
 * Authenticator-apps (Authy, 1Password, Google Authenticator, …) de
 * factor kunnen opslaan.
 *
 * Format (RFC voor `otpauth://totp/...`):
 *   otpauth://totp/{issuer}:{label}?secret=...&issuer=...
 */
export function buildOtpauthUri(secret: string, accountLabel: string): string {
  return authenticator.keyuri(accountLabel, ISSUER, secret);
}

/**
 * Verifieer een 6-cijferige TOTP-code tegen een secret.
 * Tolerant voor whitespace en separators (sommige authenticator-apps
 * tonen "123 456" of "123-456").
 */
export function verifyTotp(secret: string, token: string): boolean {
  const cleaned = (token ?? '').replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    return authenticator.verify({ token: cleaned, secret });
  } catch {
    return false;
  }
}

/**
 * Genereer N alphanumerieke backup-codes (uppercase, 8 chars).
 * Format: `XXXX-XXXX` voor leesbaarheid; bij verify wordt het streepje
 * gestript en case-insensitive vergeleken.
 *
 * Crypto-randomness via `crypto.randomBytes` — geen Math.random.
 */
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  // Charset zonder ambiguïteit (geen 0/O/1/I) — UX-vriendelijker.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(8);
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += alphabet[bytes[j]! % alphabet.length];
    }
    // 4-4 split voor leesbaarheid
    codes.push(`${code.slice(0, 4)}-${code.slice(4, 8)}`);
  }
  return codes;
}

/**
 * Normaliseer een backup-code voor opslag/vergelijking: strip non-alpha-
 * num en uppercase. Houd hash deterministisch los van display-formatting.
 */
export function normalizeBackupCode(code: string): string {
  return (code ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * 2FA TOTP service — Sprint Q4.2 (Agent NNN).
 *
 * Beheert TOTP-secrets, QR-code generation, backup-codes en de tenant 2FA
 * policy. Alle DB-mutaties lopen via withTenant() zodat RLS de
 * cross-tenant-leak tegenhoudt — een 2FA-secret van tenant A mag NOOIT
 * benaderbaar zijn via een sessie van tenant B.
 *
 * Backup-codes worden bcrypt-gehashed in de DB (zelfde kostprofiel als
 * passwords). Bij verify scannen we de `backup_codes`-array, vinden de
 * matchende hash en strippen 'm uit de array — single-use semantiek.
 */

import bcrypt from 'bcrypt';
import { PoolClient } from 'pg';
import qrcode from 'qrcode';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import {
  generateSecret,
  buildOtpauthUri,
  verifyTotp,
  generateBackupCodes,
  normalizeBackupCode,
} from '../../lib/totp';

const BACKUP_CODE_BCRYPT_ROUNDS = 10;

export interface TwoFactorSetupResult {
  secret: string;
  qr_code_data_url: string;
  backup_codes: string[];
}

interface User2faRow {
  user_id: string;
  tenant_id: string;
  secret: string;
  enabled: boolean;
  backup_codes: string[];
  enabled_at: Date | null;
  last_used_at: Date | null;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
}

async function fetchUser(userId: string): Promise<UserRow | null> {
  return withoutTenant(async (client: PoolClient) => {
    const { rows } = await client.query<UserRow>(
      'SELECT id, tenant_id, email, role FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    return rows[0] ?? null;
  });
}

async function fetch2faRow(
  client: PoolClient,
  userId: string
): Promise<User2faRow | null> {
  const { rows } = await client.query<User2faRow>(
    'SELECT user_id, tenant_id, secret, enabled, backup_codes, enabled_at, last_used_at FROM user_2fa_secrets WHERE user_id = $1',
    [userId]
  );
  return rows[0] ?? null;
}

/**
 * Stap 1 van enrolment: genereer secret + QR + backup-codes en sla 'm op
 * met `enabled=false`. De gebruiker moet daarna een TOTP-code uit z'n
 * authenticator naar `verifyTotpAndEnable` sturen voor activatie.
 *
 * Idempotent: als er al een (al dan niet enabled) row bestaat, wordt 'ie
 * overschreven. Voor disable+re-enable workflow handig.
 */
export async function generateTotpSecret(
  userId: string,
  tenantId: string,
  ctx: AuditContext = {}
): Promise<TwoFactorSetupResult> {
  const user = await fetchUser(userId);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Gebruiker niet gevonden');
  }
  if (user.tenant_id !== tenantId) {
    throw new AppError(403, 'FORBIDDEN', 'Gebruiker hoort niet bij deze tenant');
  }

  const secret = generateSecret();
  const otpauth = buildOtpauthUri(secret, user.email);
  const qrDataUrl = await qrcode.toDataURL(otpauth);

  const backupCodesPlain = generateBackupCodes(10);
  const backupCodesHashed = await Promise.all(
    backupCodesPlain.map((code) =>
      bcrypt.hash(normalizeBackupCode(code), BACKUP_CODE_BCRYPT_ROUNDS)
    )
  );

  await withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO user_2fa_secrets (user_id, tenant_id, secret, enabled, backup_codes)
       VALUES ($1, $2, $3, FALSE, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET secret = EXCLUDED.secret,
             enabled = FALSE,
             backup_codes = EXCLUDED.backup_codes,
             enabled_at = NULL,
             last_used_at = NULL`,
      [userId, tenantId, secret, backupCodesHashed]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.USER_2FA_SETUP_INITIATED,
        entityType: 'user',
        entityId: userId,
        userId,
        after: { backup_code_count: backupCodesPlain.length },
      },
      ctx
    );
  });

  return {
    secret,
    qr_code_data_url: qrDataUrl,
    backup_codes: backupCodesPlain,
  };
}

/**
 * Stap 2 — gebruiker bewijst dat 'ie het secret correct heeft gescand
 * door een geldige TOTP-code te tonen. Schakel 2FA dan permanent in.
 */
export async function verifyTotpAndEnable(
  userId: string,
  code: string,
  ctx: AuditContext = {}
): Promise<boolean> {
  const user = await fetchUser(userId);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Gebruiker niet gevonden');
  }

  return withTenant(user.tenant_id, async (client) => {
    const row = await fetch2faRow(client, userId);
    if (!row) {
      throw new AppError(400, 'NO_2FA_SETUP', '2FA setup niet geïnitieerd');
    }
    if (row.enabled) {
      throw new AppError(409, '2FA_ALREADY_ENABLED', '2FA staat al aan');
    }
    if (!verifyTotp(row.secret, code)) {
      throw new AppError(401, 'INVALID_2FA_CODE', 'Ongeldige verificatiecode');
    }

    await client.query(
      `UPDATE user_2fa_secrets
          SET enabled = TRUE,
              enabled_at = now(),
              last_used_at = now()
        WHERE user_id = $1`,
      [userId]
    );

    await logAudit(
      client,
      user.tenant_id,
      {
        action: AuditActions.USER_2FA_ENABLED,
        entityType: 'user',
        entityId: userId,
        userId,
      },
      ctx
    );

    return true;
  });
}

/**
 * Voor login-flow — verifieer een TOTP-code voor een al ingeschakelde
 * 2FA-config. Update last_used_at.
 */
export async function verifyTotpCode(
  userId: string,
  code: string
): Promise<boolean> {
  const user = await fetchUser(userId);
  if (!user) return false;

  return withTenant(user.tenant_id, async (client) => {
    const row = await fetch2faRow(client, userId);
    if (!row || !row.enabled) return false;
    if (!verifyTotp(row.secret, code)) return false;

    await client.query(
      'UPDATE user_2fa_secrets SET last_used_at = now() WHERE user_id = $1',
      [userId]
    );
    return true;
  });
}

/**
 * Backup-code login. Single-use — bij een match wordt de hash uit de
 * array gestript zodat dezelfde code geen tweede keer werkt.
 */
export async function verifyBackupCode(
  userId: string,
  code: string,
  ctx: AuditContext = {}
): Promise<boolean> {
  const user = await fetchUser(userId);
  if (!user) return false;

  const normalized = normalizeBackupCode(code);
  if (!normalized) return false;

  return withTenant(user.tenant_id, async (client) => {
    const row = await fetch2faRow(client, userId);
    if (!row || !row.enabled) return false;

    let matchedHash: string | null = null;
    for (const hash of row.backup_codes) {
      // bcrypt.compare is constant-time enough — sequential scan is OK
      // voor 10 codes.
      if (await bcrypt.compare(normalized, hash)) {
        matchedHash = hash;
        break;
      }
    }
    if (!matchedHash) return false;

    const remaining = row.backup_codes.filter((h) => h !== matchedHash);
    await client.query(
      'UPDATE user_2fa_secrets SET backup_codes = $1, last_used_at = now() WHERE user_id = $2',
      [remaining, userId]
    );

    await logAudit(
      client,
      user.tenant_id,
      {
        action: AuditActions.USER_2FA_BACKUP_CODE_USED,
        entityType: 'user',
        entityId: userId,
        userId,
        after: { remaining_codes: remaining.length },
      },
      ctx
    );

    return true;
  });
}

/**
 * Schakel 2FA uit — vereist verificatie via TOTP-code, anders kan een
 * gestolen sessie iemands 2FA bypassen.
 */
export async function disable2fa(
  userId: string,
  code: string,
  ctx: AuditContext = {}
): Promise<void> {
  const user = await fetchUser(userId);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Gebruiker niet gevonden');
  }

  await withTenant(user.tenant_id, async (client) => {
    const row = await fetch2faRow(client, userId);
    if (!row || !row.enabled) {
      throw new AppError(400, '2FA_NOT_ENABLED', '2FA staat niet aan');
    }
    if (!verifyTotp(row.secret, code)) {
      throw new AppError(401, 'INVALID_2FA_CODE', 'Ongeldige verificatiecode');
    }

    await client.query(
      'DELETE FROM user_2fa_secrets WHERE user_id = $1',
      [userId]
    );

    await logAudit(
      client,
      user.tenant_id,
      {
        action: AuditActions.USER_2FA_DISABLED,
        entityType: 'user',
        entityId: userId,
        userId,
      },
      ctx
    );
  });
}

/**
 * Hergenereer 10 nieuwe backup-codes (oude worden ongeldig). Vereist
 * TOTP-code zodat een gestolen sessie de oude codes niet kan
 * overschrijven en zo de account permanent kan claimen.
 */
export async function regenerateBackupCodes(
  userId: string,
  code: string,
  ctx: AuditContext = {}
): Promise<string[]> {
  const user = await fetchUser(userId);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Gebruiker niet gevonden');
  }

  return withTenant(user.tenant_id, async (client) => {
    const row = await fetch2faRow(client, userId);
    if (!row || !row.enabled) {
      throw new AppError(400, '2FA_NOT_ENABLED', '2FA staat niet aan');
    }
    if (!verifyTotp(row.secret, code)) {
      throw new AppError(401, 'INVALID_2FA_CODE', 'Ongeldige verificatiecode');
    }

    const codesPlain = generateBackupCodes(10);
    const codesHashed = await Promise.all(
      codesPlain.map((c) =>
        bcrypt.hash(normalizeBackupCode(c), BACKUP_CODE_BCRYPT_ROUNDS)
      )
    );

    await client.query(
      'UPDATE user_2fa_secrets SET backup_codes = $1 WHERE user_id = $2',
      [codesHashed, userId]
    );

    await logAudit(
      client,
      user.tenant_id,
      {
        action: AuditActions.USER_2FA_BACKUP_CODES_REGENERATED,
        entityType: 'user',
        entityId: userId,
        userId,
      },
      ctx
    );

    return codesPlain;
  });
}

/**
 * Read of 2FA aanstaat voor een user (gebruikt door login-flow).
 */
export async function is2faEnabled(userId: string): Promise<boolean> {
  return withoutTenant(async (client) => {
    const { rows } = await client.query<{ enabled: boolean }>(
      'SELECT enabled FROM user_2fa_secrets WHERE user_id = $1',
      [userId]
    );
    return !!rows[0]?.enabled;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Tenant 2FA policy
// ────────────────────────────────────────────────────────────────────────────

export interface Tenant2faPolicy {
  tenant_id: string;
  required_for_roles: string[];
  required_for_all: boolean;
  grace_period_days: number;
  created_at: Date;
  updated_at: Date;
}

export async function getTenant2faPolicy(
  tenantId: string
): Promise<Tenant2faPolicy | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Tenant2faPolicy>(
      'SELECT tenant_id, required_for_roles, required_for_all, grace_period_days, created_at, updated_at FROM tenant_2fa_policy WHERE tenant_id = $1',
      [tenantId]
    );
    return rows[0] ?? null;
  });
}

export async function setTenant2faPolicy(
  tenantId: string,
  userId: string,
  policy: {
    required_for_roles?: string[];
    required_for_all?: boolean;
    grace_period_days?: number;
  },
  ctx: AuditContext = {}
): Promise<Tenant2faPolicy> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Tenant2faPolicy>(
      `INSERT INTO tenant_2fa_policy (tenant_id, required_for_roles, required_for_all, grace_period_days)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id) DO UPDATE
         SET required_for_roles = EXCLUDED.required_for_roles,
             required_for_all   = EXCLUDED.required_for_all,
             grace_period_days  = EXCLUDED.grace_period_days
       RETURNING tenant_id, required_for_roles, required_for_all, grace_period_days, created_at, updated_at`,
      [
        tenantId,
        policy.required_for_roles ?? [],
        policy.required_for_all ?? false,
        policy.grace_period_days ?? 7,
      ]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.TENANT_2FA_POLICY_UPDATED,
        entityType: 'tenant',
        entityId: tenantId,
        userId,
        after: rows[0],
      },
      ctx
    );

    return rows[0]!;
  });
}

/**
 * Bepaal of een specifieke user 2FA verplicht heeft volgens de tenant
 * policy. Houdt rekening met grace_period — pas na X dagen sinds tenant
 * policy actief was wordt het echt geblokkeerd.
 */
export async function require2faForUser(
  tenantId: string,
  userId: string,
  role: string
): Promise<{ required: boolean; in_grace: boolean; grace_ends_at?: Date }> {
  const policy = await getTenant2faPolicy(tenantId);
  if (!policy) return { required: false, in_grace: false };

  const isRequired =
    policy.required_for_all || policy.required_for_roles.includes(role);
  if (!isRequired) return { required: false, in_grace: false };

  const enabled = await is2faEnabled(userId);
  if (enabled) return { required: false, in_grace: false };

  const graceEnds = new Date(
    new Date(policy.created_at).getTime() +
      policy.grace_period_days * 24 * 60 * 60 * 1000
  );
  if (Date.now() < graceEnds.getTime()) {
    return { required: false, in_grace: true, grace_ends_at: graceEnds };
  }

  return { required: true, in_grace: false, grace_ends_at: graceEnds };
}

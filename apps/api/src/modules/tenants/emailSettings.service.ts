/**
 * Tenant e-mailinstellingen — per-tenant afzendernaam, Reply-To en optionele
 * eigen SMTP-server.
 *
 * Tabel: `tenant_email_settings` (PK = tenant_id, één rij per tenant,
 * migration 042). Het SMTP-wachtwoord staat AES-256-GCM-versleuteld in
 * `smtp_pass_encrypted` (zie src/lib/encryption.ts) en verlaat deze module
 * uitsluitend via `getTenantSendSettings()` — het pad dat de mailer gebruikt.
 * API-responses krijgen ALLEEN het afgeleide `smtp_pass_set` boolean.
 */

import type { Request } from 'express';
import { withTenant } from '../../db/pool';
import { encrypt, decrypt } from '../../lib/encryption';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit, auditCtxFromReq } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { getDefaultFrom } from '../../lib/emailService';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Veilige shape voor API-responses — nooit het wachtwoord zelf. */
export interface TenantEmailSettings {
  tenant_id: string;
  from_name: string | null;
  reply_to: string | null;
  smtp_enabled: boolean;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean;
  smtp_user: string | null;
  smtp_from: string | null;
  /** Afgeleid: staat er een versleuteld wachtwoord opgeslagen? */
  smtp_pass_set: boolean;
  updated_at: string | null;
}

export interface TenantEmailSettingsInput {
  from_name?: string | null;
  reply_to?: string | null;
  smtp_enabled?: boolean;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_secure?: boolean;
  smtp_user?: string | null;
  /**
   * Write-only: `undefined` = ongewijzigd laten, string = nieuw wachtwoord,
   * `null` = opgeslagen wachtwoord wissen.
   */
  smtp_pass?: string | null;
  smtp_from?: string | null;
}

/** Shape voor het verzendpad (tenantMailer) — bevat het gedecrypte wachtwoord. */
export interface TenantSendSettings {
  fromName: string | null;
  replyTo: string | null;
  smtp: {
    host: string;
    port: number | null;
    secure: boolean;
    user: string | null;
    pass: string | null;
    from: string | null;
  } | null;
}

interface SettingsRow {
  tenant_id: string;
  from_name: string | null;
  reply_to: string | null;
  smtp_enabled: boolean;
  smtp_port: number | null;
  smtp_secure: boolean;
  smtp_host: string | null;
  smtp_user: string | null;
  smtp_from: string | null;
  smtp_pass_encrypted: Buffer | null;
  updated_at: string | null;
}

const SELECT_COLS = `tenant_id, from_name, reply_to, smtp_enabled, smtp_host,
       smtp_port, smtp_secure, smtp_user, smtp_from, smtp_pass_encrypted, updated_at`;

function toSafeShape(row: SettingsRow | undefined, tenantId: string): TenantEmailSettings {
  if (!row) {
    return {
      tenant_id: tenantId,
      from_name: null,
      reply_to: null,
      smtp_enabled: false,
      smtp_host: null,
      smtp_port: null,
      smtp_secure: true,
      smtp_user: null,
      smtp_from: null,
      smtp_pass_set: false,
      updated_at: null,
    };
  }
  return {
    tenant_id: row.tenant_id,
    from_name: row.from_name,
    reply_to: row.reply_to,
    smtp_enabled: row.smtp_enabled,
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    smtp_secure: row.smtp_secure,
    smtp_user: row.smtp_user,
    smtp_from: row.smtp_from,
    smtp_pass_set: row.smtp_pass_encrypted !== null,
    updated_at: row.updated_at,
  };
}

/**
 * Extraheert het kale adres uit `"Naam <adres>"` of geeft de string terug
 * als die al een kaal adres is. Gebruikt voor de UI-preview van de afzender.
 */
export function extractAddress(from: string): string {
  const m = /<([^<>]+)>/.exec(from);
  return (m ? m[1] : from).trim();
}

/** Globale geverifieerde afzender-adres (voor GET-response / UI-preview). */
export function getGlobalFromAddress(): string {
  return extractAddress(getDefaultFrom());
}

// ─── Read ───────────────────────────────────────────────────────────────────

export async function getTenantEmailSettings(
  tenantId: string
): Promise<TenantEmailSettings> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<SettingsRow>(
      `SELECT ${SELECT_COLS} FROM tenant_email_settings WHERE tenant_id = $1`,
      [tenantId]
    );
    return toSafeShape(row, tenantId);
  });
}

/**
 * Instellingen voor het verzendpad — inclusief gedecrypt SMTP-wachtwoord.
 * NOOIT (delen van) het resultaat loggen of in een response zetten.
 *
 * Fail-open: bij een DB- of decrypt-fout loggen we een warning en geeft de
 * functie `null` terug zodat de mailer terugvalt op het globale Resend-pad —
 * een kapotte settings-rij mag geen systeemmails (invites, resets) blokkeren.
 */
export async function getTenantSendSettings(
  tenantId: string
): Promise<TenantSendSettings | null> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [row] } = await client.query<SettingsRow>(
        `SELECT ${SELECT_COLS} FROM tenant_email_settings WHERE tenant_id = $1`,
        [tenantId]
      );
      if (!row) return null;

      let pass: string | null = null;
      if (row.smtp_enabled && row.smtp_pass_encrypted) {
        // Decrypt kan gooien (key-rotatie, tampering) — dan draaien we
        // zonder wachtwoord door; de SMTP-poging faalt dan met een nette
        // auth-fout i.p.v. hier het hele verzendpad te breken.
        try {
          pass = decrypt(row.smtp_pass_encrypted);
        } catch (err) {
          logger.warn('[emailSettings] SMTP-wachtwoord decrypt mislukt', {
            tenantId,
            error: (err as Error).message,
          });
        }
      }

      return {
        fromName: row.from_name,
        replyTo: row.reply_to,
        smtp:
          row.smtp_enabled && row.smtp_host
            ? {
                host: row.smtp_host,
                port: row.smtp_port,
                secure: row.smtp_secure,
                user: row.smtp_user,
                pass,
                from: row.smtp_from,
              }
            : null,
      };
    });
  } catch (err) {
    logger.warn('[emailSettings] getTenantSendSettings failed — fallback naar globaal pad', {
      tenantId,
      error: (err as Error).message,
    });
    return null;
  }
}

// ─── Write ──────────────────────────────────────────────────────────────────

export async function upsertTenantEmailSettings(
  tenantId: string,
  input: TenantEmailSettingsInput,
  req?: Request
): Promise<TenantEmailSettings> {
  return withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query<SettingsRow>(
      `SELECT ${SELECT_COLS} FROM tenant_email_settings WHERE tenant_id = $1`,
      [tenantId]
    );

    // Merge-semantiek: expliciet meegegeven velden overschrijven (ook naar
    // NULL — velden moeten wisbaar zijn); weggelaten velden blijven staan.
    const next = {
      from_name:
        input.from_name !== undefined ? input.from_name : existing?.from_name ?? null,
      reply_to:
        input.reply_to !== undefined ? input.reply_to : existing?.reply_to ?? null,
      smtp_enabled:
        input.smtp_enabled !== undefined
          ? input.smtp_enabled
          : existing?.smtp_enabled ?? false,
      smtp_host:
        input.smtp_host !== undefined ? input.smtp_host : existing?.smtp_host ?? null,
      smtp_port:
        input.smtp_port !== undefined ? input.smtp_port : existing?.smtp_port ?? null,
      smtp_secure:
        input.smtp_secure !== undefined
          ? input.smtp_secure
          : existing?.smtp_secure ?? true,
      smtp_user:
        input.smtp_user !== undefined ? input.smtp_user : existing?.smtp_user ?? null,
      smtp_from:
        input.smtp_from !== undefined ? input.smtp_from : existing?.smtp_from ?? null,
      // Wachtwoord: undefined = behouden, string = nieuw (encrypten), null = wissen.
      smtp_pass_encrypted:
        input.smtp_pass === undefined
          ? existing?.smtp_pass_encrypted ?? null
          : input.smtp_pass === null || input.smtp_pass === ''
            ? null
            : encrypt(input.smtp_pass),
    };

    if (next.smtp_enabled && !next.smtp_host) {
      throw new AppError(
        400,
        'SMTP_HOST_REQUIRED',
        'SMTP kan niet worden ingeschakeld zonder host.'
      );
    }

    const { rows: [row] } = await client.query<SettingsRow>(
      `INSERT INTO tenant_email_settings
         (tenant_id, from_name, reply_to, smtp_enabled, smtp_host, smtp_port,
          smtp_secure, smtp_user, smtp_from, smtp_pass_encrypted, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         from_name           = EXCLUDED.from_name,
         reply_to            = EXCLUDED.reply_to,
         smtp_enabled        = EXCLUDED.smtp_enabled,
         smtp_host           = EXCLUDED.smtp_host,
         smtp_port           = EXCLUDED.smtp_port,
         smtp_secure         = EXCLUDED.smtp_secure,
         smtp_user           = EXCLUDED.smtp_user,
         smtp_from           = EXCLUDED.smtp_from,
         smtp_pass_encrypted = EXCLUDED.smtp_pass_encrypted,
         updated_at          = now()
       RETURNING ${SELECT_COLS}`,
      [
        tenantId,
        next.from_name,
        next.reply_to,
        next.smtp_enabled,
        next.smtp_host,
        next.smtp_port,
        next.smtp_secure,
        next.smtp_user,
        next.smtp_from,
        next.smtp_pass_encrypted,
      ]
    );

    // Audit — before/after ALTIJD zonder wachtwoord (alleen het set-flag).
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.TENANT_EMAIL_SETTINGS_UPDATED,
        entityType: 'tenant_email_settings',
        entityId: tenantId,
        userId: req?.user?.userId ?? null,
        before: existing ? toSafeShape(existing, tenantId) : null,
        after: toSafeShape(row, tenantId),
      },
      req ? auditCtxFromReq(req) : {}
    );

    return toSafeShape(row, tenantId);
  });
}

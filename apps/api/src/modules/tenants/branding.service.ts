/**
 * Tenant branding service — Sprint Q2.1.
 *
 * Houdt per tenant white-label config bij die door:
 *   - het klantportaal wordt gebruikt (logo, kleuren, brand_name override)
 *   - outbound email wordt gebruikt (brand_name in subject, email_footer in body)
 *
 * Tabel: `tenant_branding` (PK = tenant_id, één rij per tenant).
 * RLS via `app.tenant_id` setting → caller moet binnen `withTenant` zitten,
 * óf via `getBrandingForTenant` die een raw-pool-query doet (gebruikt voor
 * de portal-view die geen tenant-context heeft).
 */

import { pool, withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';

export interface TenantBranding {
  tenant_id: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  brand_name: string | null;
  email_footer: string | null;
  updated_at: string;
}

export interface TenantBrandingInput {
  logo_url?: string | null;
  favicon_url?: string | null;
  primary_color?: string | null;
  accent_color?: string | null;
  brand_name?: string | null;
  email_footer?: string | null;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function validateInput(input: TenantBrandingInput): void {
  if (input.primary_color && !HEX_RE.test(input.primary_color)) {
    throw new AppError(
      400,
      'INVALID_COLOR',
      'primary_color moet een hex-kleur zijn (bv #6366f1)'
    );
  }
  if (input.accent_color && !HEX_RE.test(input.accent_color)) {
    throw new AppError(
      400,
      'INVALID_COLOR',
      'accent_color moet een hex-kleur zijn (bv #6366f1)'
    );
  }
  if (input.brand_name !== undefined && input.brand_name !== null) {
    if (input.brand_name.length === 0 || input.brand_name.length > 100) {
      throw new AppError(
        400,
        'INVALID_BRAND_NAME',
        'brand_name moet 1-100 tekens lang zijn'
      );
    }
  }
}

export async function getTenantBranding(tenantId: string): Promise<TenantBranding | null> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: [row] } = await client.query<TenantBranding>(
        `SELECT tenant_id, logo_url, favicon_url, primary_color, accent_color,
                brand_name, email_footer, updated_at
         FROM tenant_branding
         WHERE tenant_id = $1`,
        [tenantId]
      );
      return row ?? null;
    });
  } catch (err) {
    logger.warn('[branding] getTenantBranding failed', {
      tenantId,
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * Lookup branding zonder tenant-context (voor publieke portal-view die
 * tenant_id afleidt uit de portal_links token). Gebruikt raw `pool.query`
 * — RLS-policies hebben `USING` zonder FORCE, dus deze query slaagt voor
 * service-rol; in production moet de DB-user de RLS-bypass-rol hebben.
 */
export async function getBrandingForTenant(tenantId: string): Promise<TenantBranding | null> {
  try {
    const { rows: [row] } = await pool.query<TenantBranding>(
      `SELECT tenant_id, logo_url, favicon_url, primary_color, accent_color,
              brand_name, email_footer, updated_at
       FROM tenant_branding
       WHERE tenant_id = $1`,
      [tenantId]
    );
    return row ?? null;
  } catch {
    return null;
  }
}

export async function upsertTenantBranding(
  tenantId: string,
  input: TenantBrandingInput
): Promise<TenantBranding> {
  validateInput(input);

  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<TenantBranding>(
      `INSERT INTO tenant_branding
         (tenant_id, logo_url, favicon_url, primary_color, accent_color, brand_name, email_footer, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         logo_url       = COALESCE(EXCLUDED.logo_url,       tenant_branding.logo_url),
         favicon_url    = COALESCE(EXCLUDED.favicon_url,    tenant_branding.favicon_url),
         primary_color  = COALESCE(EXCLUDED.primary_color,  tenant_branding.primary_color),
         accent_color   = COALESCE(EXCLUDED.accent_color,   tenant_branding.accent_color),
         brand_name     = COALESCE(EXCLUDED.brand_name,     tenant_branding.brand_name),
         email_footer   = COALESCE(EXCLUDED.email_footer,   tenant_branding.email_footer),
         updated_at     = now()
       RETURNING tenant_id, logo_url, favicon_url, primary_color, accent_color,
                 brand_name, email_footer, updated_at`,
      [
        tenantId,
        input.logo_url ?? null,
        input.favicon_url ?? null,
        input.primary_color ?? null,
        input.accent_color ?? null,
        input.brand_name ?? null,
        input.email_footer ?? null,
      ]
    );
    return row;
  });
}

export async function clearBrandingField(
  tenantId: string,
  field: keyof TenantBrandingInput
): Promise<TenantBranding | null> {
  const allowed: (keyof TenantBrandingInput)[] = [
    'logo_url',
    'favicon_url',
    'primary_color',
    'accent_color',
    'brand_name',
    'email_footer',
  ];
  if (!allowed.includes(field)) {
    throw new AppError(400, 'INVALID_FIELD', `Veld '${field}' kan niet worden gewist`);
  }

  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<TenantBranding>(
      `UPDATE tenant_branding SET ${field} = NULL, updated_at = now()
       WHERE tenant_id = $1
       RETURNING tenant_id, logo_url, favicon_url, primary_color, accent_color,
                 brand_name, email_footer, updated_at`,
      [tenantId]
    );
    return row ?? null;
  });
}

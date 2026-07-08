/**
 * Tenant-logo upload & serving — white-label branding (migration 045).
 *
 * Flow:
 *   1. Admin upload (POST /api/tenants/branding/logo, multipart) → multer
 *      memoryStorage → `validateLogoFile` (magic bytes + SVG-scrub) →
 *      `uploadTenantLogo` schrijft naar de bestaande FileStorage-abstractie
 *      (MinIO/S3 of local disk, zelfde infra als CV-uploads) en zet
 *      `logo_storage_key` + `logo_mime` + een stabiele publieke `logo_url`.
 *   2. Serven gebeurt via GET /api/public/branding/:tenantId/logo
 *      (brandingPublic.router.ts) — géén presigned URL, want die verloopt en
 *      e-mails/portalen embedden de URL langdurig.
 *
 * ── SVG-beleid (gekozen: accepteren + defense-in-depth, niet weigeren) ──────
 * SVG is het meest gevraagde logo-formaat (scherp op elke DPI), dus we
 * accepteren het, met drie lagen verdediging:
 *   a. Upload-scrub (`assertSafeSvgContent`): weigert <script>, event-handler-
 *      attributen (onload=...), javascript:-URI's, <foreignObject>, embedded
 *      HTML (<iframe>/<object>/<embed>/<link>/<meta>), @import in <style> en
 *      externe href/xlink:href-verwijzingen (alleen #fragment-refs toegestaan).
 *   b. Serve-headers (zie brandingPublic.router.ts): CSP `default-src 'none';
 *      style-src 'unsafe-inline'; sandbox` + `X-Content-Type-Options: nosniff`,
 *      zodat een eventueel gemiste vector nooit in een document-context met
 *      cookies/JS kan draaien.
 *   c. De web-app embedt het logo uitsluitend via <img> — SVG-in-<img> voert
 *      per browserspecificatie nooit scripts uit en laadt geen externe resources.
 */

import { randomUUID } from 'crypto';
import { pool, withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { getStorage } from '../../lib/storage';
import type { TenantBranding } from './branding.service';

// ─── Validatie-constanten ────────────────────────────────────────────────────

export const MAX_LOGO_BYTES = 1 * 1024 * 1024; // 1 MB

/** Toegestane mimes → extensie voor de storage key. */
export const ALLOWED_LOGO_MIME: Record<string, 'png' | 'jpg' | 'svg'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  // Sommige browsers/OS'en sturen image/jpg (non-standaard alias).
  'image/jpg': 'jpg',
  'image/svg+xml': 'svg',
};

/** Canonieke mime per gedetecteerd type (wat we opslaan + serveren). */
const CANONICAL_MIME: Record<'png' | 'jpg' | 'svg', string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
};

// ─── Content-sniffing (magic bytes) ──────────────────────────────────────────

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Detecteert het echte bestandstype op inhoud (niet op de meegegeven mime,
 * die is client-controlled). SVG = tekst die — na BOM/whitespace/XML-decl/
 * comments/doctype — met `<svg` begint.
 */
export function sniffLogoType(buffer: Buffer): 'png' | 'jpg' | 'svg' | null {
  if (buffer.length >= PNG_MAGIC.length && buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return 'png';
  }
  if (buffer.length >= JPEG_MAGIC.length && buffer.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
    return 'jpg';
  }
  // SVG: decodeer als UTF-8, strip BOM en leidende XML-prolog/comments.
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const withoutProlog = text
    .replace(/^\s*<\?xml[^>]*\?>/i, '')
    .replace(/^\s*(<!--[\s\S]*?-->\s*)*/, '')
    .replace(/^\s*<!DOCTYPE[^>]*>/i, '')
    .replace(/^\s*(<!--[\s\S]*?-->\s*)*/, '')
    .trimStart();
  if (/^<svg[\s>]/i.test(withoutProlog)) {
    return 'svg';
  }
  return null;
}

/**
 * Upload-scrub voor SVG's — zie het SVG-beleid in de file-header.
 * Gooit AppError(400, 'UNSAFE_SVG') bij elk gevaarlijk patroon. Bewust
 * fail-closed: liever een vals-positief (logo opnieuw exporteren zonder
 * scripts/styles-imports) dan een stored-XSS in een multi-tenant SaaS.
 */
export function assertSafeSvgContent(svgText: string): void {
  const reject = (reason: string): never => {
    throw new AppError(
      400,
      'UNSAFE_SVG',
      `SVG geweigerd: ${reason}. Exporteer het logo zonder scripts/interactie en probeer opnieuw.`
    );
  };

  // Neutraliseer entity-obfuscatie eerst grofweg (&#x6A;avascript: e.d.):
  // we checken zowel de raw tekst als een gedecodeerde variant.
  const decoded = svgText
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => {
      const cp = parseInt(h, 16);
      return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);?/g, (_, d: string) => {
      const cp = parseInt(d, 10);
      return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
    });

  for (const text of [svgText, decoded]) {
    if (/<\s*script/i.test(text)) reject('bevat <script>');
    if (/\son[a-z]+\s*=/i.test(text)) reject('bevat event-handler-attributen (on*=)');
    if (/javascript\s*:/i.test(text)) reject('bevat javascript:-URI');
    if (/<\s*foreignobject/i.test(text)) reject('bevat <foreignObject>');
    if (/<\s*(iframe|object|embed|link|meta|base|form|input|video|audio)\b/i.test(text)) {
      reject('bevat embedded HTML-elementen');
    }
    if (/@import/i.test(text)) reject('bevat @import in styles');
    // href/xlink:href mag alleen naar interne #fragmenten wijzen (gradients,
    // clipPaths). Externe of data:-verwijzingen weigeren we.
    const hrefRe = /(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi;
    let m: RegExpExecArray | null;
    while ((m = hrefRe.exec(text)) !== null) {
      const target = m[2].trim();
      if (target !== '' && !target.startsWith('#')) {
        reject('bevat externe href-verwijzing');
      }
    }
  }
}

export interface ValidatedLogo {
  /** Canonieke mime die we opslaan en serveren. */
  mime: string;
  /** Extensie voor de storage key. */
  ext: 'png' | 'jpg' | 'svg';
}

/**
 * Volledige upload-validatie: grootte, mime-allowlist, magic-byte-sniff,
 * mime↔inhoud-consistentie en (voor SVG) de content-scrub.
 */
export function validateLogoFile(buffer: Buffer, declaredMime: string): ValidatedLogo {
  if (buffer.length === 0) {
    throw new AppError(400, 'EMPTY_FILE', 'Het geuploade bestand is leeg.');
  }
  if (buffer.length > MAX_LOGO_BYTES) {
    throw new AppError(
      400,
      'LOGO_TOO_LARGE',
      `Logo is te groot (max ${Math.floor(MAX_LOGO_BYTES / 1024)} kB).`
    );
  }

  const declared = ALLOWED_LOGO_MIME[declaredMime.toLowerCase()];
  if (!declared) {
    throw new AppError(
      400,
      'INVALID_LOGO_TYPE',
      'Alleen PNG, JPG of SVG is toegestaan als logo.'
    );
  }

  const sniffed = sniffLogoType(buffer);
  if (!sniffed) {
    throw new AppError(
      400,
      'INVALID_LOGO_CONTENT',
      'Bestandsinhoud is geen geldige PNG, JPG of SVG.'
    );
  }
  if (sniffed !== declared) {
    throw new AppError(
      400,
      'LOGO_TYPE_MISMATCH',
      'Bestandsinhoud komt niet overeen met het opgegeven bestandstype.'
    );
  }

  if (sniffed === 'svg') {
    assertSafeSvgContent(buffer.toString('utf8'));
  }

  return { mime: CANONICAL_MIME[sniffed], ext: sniffed };
}

// ─── Storage + DB ────────────────────────────────────────────────────────────

function publicApiBase(): string {
  return (process.env.PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
}

/** Stabiele publieke URL — `v=` cache-bust per upload. */
export function buildPublicLogoUrl(tenantId: string): string {
  return `${publicApiBase()}/api/public/branding/${tenantId}/logo?v=${Date.now()}`;
}

const RETURNING_COLS = `tenant_id, logo_url, favicon_url, primary_color, accent_color,
                 brand_name, email_footer, updated_at`;

/**
 * Slaat een gevalideerd logo op in storage en werkt tenant_branding bij.
 * Verwijdert het oude storage-object best-effort (dangling object is
 * acceptabel; een kapotte upsert niet).
 */
export async function uploadTenantLogo(
  tenantId: string,
  file: { buffer: Buffer; mimetype: string }
): Promise<TenantBranding> {
  const { mime, ext } = validateLogoFile(file.buffer, file.mimetype);

  const storage = getStorage();
  const key = `tenants/${tenantId}/branding/logo_${randomUUID()}.${ext}`;
  await storage.put(key, file.buffer, mime);

  const logoUrl = buildPublicLogoUrl(tenantId);

  try {
    return await withTenant(tenantId, async (client) => {
      // Oude key ophalen om het object na de upsert op te ruimen.
      const { rows: [prev] } = await client.query<{ logo_storage_key: string | null }>(
        `SELECT logo_storage_key FROM tenant_branding WHERE tenant_id = $1`,
        [tenantId]
      );

      const { rows: [row] } = await client.query<TenantBranding>(
        `INSERT INTO tenant_branding (tenant_id, logo_url, logo_storage_key, logo_mime, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           logo_url         = EXCLUDED.logo_url,
           logo_storage_key = EXCLUDED.logo_storage_key,
           logo_mime        = EXCLUDED.logo_mime,
           updated_at       = now()
         RETURNING ${RETURNING_COLS}`,
        [tenantId, logoUrl, key, mime]
      );

      if (prev?.logo_storage_key && prev.logo_storage_key !== key) {
        try {
          await storage.delete(prev.logo_storage_key);
        } catch (err) {
          logger.warn('[branding] oude logo-object niet verwijderd', {
            tenantId,
            key: prev.logo_storage_key,
            error: (err as Error).message,
          });
        }
      }

      return row;
    });
  } catch (err) {
    // DB-upsert mislukt → net geuploade object opruimen (best-effort).
    try {
      await storage.delete(key);
    } catch {
      /* dangling object, acceptabel */
    }
    throw err;
  }
}

/**
 * Verwijdert het geuploade logo: eerst de oude key lezen, dan de DB-velden
 * clearen, daarna het storage-object opruimen (best-effort).
 */
export async function deleteTenantLogo(tenantId: string): Promise<TenantBranding | null> {
  const storage = getStorage();

  const result = await withTenant(tenantId, async (client) => {
    const { rows: [prev] } = await client.query<{ logo_storage_key: string | null }>(
      `SELECT logo_storage_key FROM tenant_branding WHERE tenant_id = $1`,
      [tenantId]
    );

    const { rows: [row] } = await client.query<TenantBranding>(
      `UPDATE tenant_branding
       SET logo_url = NULL, logo_storage_key = NULL, logo_mime = NULL, updated_at = now()
       WHERE tenant_id = $1
       RETURNING ${RETURNING_COLS}`,
      [tenantId]
    );

    return { row: row ?? null, oldKey: prev?.logo_storage_key ?? null };
  });

  if (result.oldKey) {
    try {
      await storage.delete(result.oldKey);
    } catch (err) {
      logger.warn('[branding] logo-object niet verwijderd', {
        tenantId,
        key: result.oldKey,
        error: (err as Error).message,
      });
    }
  }

  return result.row;
}

// ─── Publiek serve-pad ───────────────────────────────────────────────────────

export interface StoredLogo {
  storageKey: string;
  mime: string;
}

/**
 * Lookup voor het publieke serve-endpoint — zonder tenant-context (zelfde
 * raw-pool-patroon als getBrandingForTenant; het logo is per definitie
 * publiek zichtbaar in e-mails en portalen).
 */
export async function getTenantLogoForServing(tenantId: string): Promise<StoredLogo | null> {
  try {
    const { rows: [row] } = await pool.query<{
      logo_storage_key: string | null;
      logo_mime: string | null;
    }>(
      `SELECT logo_storage_key, logo_mime FROM tenant_branding WHERE tenant_id = $1`,
      [tenantId]
    );
    if (!row?.logo_storage_key || !row.logo_mime) return null;
    return { storageKey: row.logo_storage_key, mime: row.logo_mime };
  } catch {
    return null;
  }
}

/**
 * Tenant-branding e-mail-footer — strikte allowlist-sanitatie + appenden.
 *
 * De footer-HTML komt uit `tenant_branding.email_footer` en is door een
 * tenant-admin ingevoerd. Een tenant-admin is in een multi-tenant SaaS een
 * externe partij, en de footer belandt in e-mails naar kandidaten en klanten
 * — dus we behandelen de inhoud als untrusted input.
 *
 * Sanitatie-beleid (fail-closed, strikte allowlist):
 *   - Tags:        alleen p, br, hr, div, span, a, b, strong, i, em, u, s,
 *                  small, ul, ol, li. Al het andere wordt verwijderd
 *                  (script/style/iframe e.d. inclusief hun inhoud).
 *   - Attributen:  alleen `href` (op <a>) en `style`. Alle andere attributen
 *                  — inclusief event-handlers (on*) — worden gedropt.
 *   - href:        alleen http:, https:, mailto: en tel:. Links krijgen
 *                  automatisch `target="_blank" rel="noopener noreferrer"`.
 *   - style:       property-allowlist (kleur/typografie/spacing) met een
 *                  strikte waarde-regex; `url(`, `expression(` en alles met
 *                  haakjes wordt geweigerd.
 *   - Losse `<`/`>` die geen geldige tag vormen worden ge-escaped.
 *   - Lengte-cap:  5000 tekens (zelfde limiet als de PUT-validatie).
 *
 * Appenden gebeurt in `sendTenantEmail` (lib/tenantMailer.ts) voor elke mail
 * met tenant-context. Dubbel appenden wordt voorkomen via een marker-attribuut
 * en een inhouds-check (bv. portal-notificaties die de footer al zelf
 * meerenderen).
 */

import { getBrandingForTenant } from '../modules/tenants/branding.service';

// ─── Constanten ──────────────────────────────────────────────────────────────

/** Zelfde limiet als de PUT /tenants/branding zod-validatie (max 5000). */
export const MAX_FOOTER_HTML_LENGTH = 5000;

/** Marker op de wrapper-div; voorkomt dubbel appenden. */
export const BRANDING_FOOTER_MARKER = 'data-tf-branding-footer';

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'div',
  'span',
  'a',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'small',
  'ul',
  'ol',
  'li',
]);

/** Tags zonder sluit-tag (void elements) — voor nette her-serialisatie. */
const VOID_TAGS = new Set(['br', 'hr']);

/** Raw-text containers: bij verwijderen gaat ook de INHOUD eruit. */
const RAW_TEXT_TAGS =
  /<(script|style|iframe|object|embed|svg|math|template|title|textarea|noscript)\b[\s\S]*?<\/\1\s*>/gi;
const RAW_TEXT_OPEN_TAGS =
  /<\/?(script|style|iframe|object|embed|svg|math|template|title|textarea|noscript)\b[^>]*>/gi;

const STYLE_PROP_ALLOW = new Set([
  'color',
  'background-color',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration',
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'border-top',
]);

/** Geen haakjes toegestaan → blokkeert url(), expression(), attr() etc. */
const STYLE_VALUE_RE = /^[a-zA-Z0-9#%.,'"\s-]+$/;

const SAFE_HREF_RE = /^(https?:|mailto:|tel:)/i;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeText(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeStyle(raw: string): string | null {
  const kept: string[] = [];
  for (const decl of raw.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!STYLE_PROP_ALLOW.has(prop)) continue;
    if (!STYLE_VALUE_RE.test(value)) continue;
    if (/url|expression|javascript|import/i.test(value)) continue;
    kept.push(`${prop}:${value}`);
  }
  return kept.length > 0 ? kept.join(';') : null;
}

function sanitizeHref(raw: string): string | null {
  // Strip whitespace + control chars die scheme-checks omzeilen (tab in "javascript:").
  let cleaned = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) cleaned += ch;
  }
  if (!cleaned) return null;
  if (!SAFE_HREF_RE.test(cleaned)) return null;
  return cleaned;
}

const TAG_SHAPE_RE = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b([\s\S]*?)\/?\s*>$/;
const ATTR_RE = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function sanitizeTag(rawTag: string): string {
  const m = TAG_SHAPE_RE.exec(rawTag);
  if (!m) return escapeText(rawTag); // geen geldige tag → escapen (fail-closed)

  const closing = m[1] === '/';
  const tag = m[2].toLowerCase();
  const attrText = m[3] ?? '';

  if (!ALLOWED_TAGS.has(tag)) return ''; // tag droppen, tekst-inhoud blijft

  if (closing) {
    return VOID_TAGS.has(tag) ? '' : `</${tag}>`;
  }

  const attrs: string[] = [];
  let match: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(attrText)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    if (name === 'href' && tag === 'a') {
      const safe = sanitizeHref(value);
      if (safe) attrs.push(`href="${escapeAttr(safe)}"`);
    } else if (name === 'style') {
      const safe = sanitizeStyle(value);
      if (safe) attrs.push(`style="${escapeAttr(safe)}"`);
    }
    // Alle andere attributen (class, id, on*, src, data-*, …) → droppen.
  }

  if (tag === 'a' && attrs.some((a) => a.startsWith('href='))) {
    attrs.push('target="_blank"', 'rel="noopener noreferrer"');
  }

  const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  return VOID_TAGS.has(tag) ? `<${tag}${attrStr}/>` : `<${tag}${attrStr}>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sanitizeert footer-HTML volgens de strikte allowlist (zie file-header).
 * Retourneert een lege string wanneer er na sanitatie niets bruikbaars
 * overblijft.
 */
export function sanitizeEmailFooterHtml(input: string | null | undefined): string {
  if (!input) return '';

  let html = input.slice(0, MAX_FOOTER_HTML_LENGTH);

  // Comments + raw-text blokken (inclusief inhoud) er eerst uit.
  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(RAW_TEXT_TAGS, '')
    .replace(RAW_TEXT_OPEN_TAGS, '');

  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += escapeText(html.slice(i));
      break;
    }
    out += escapeText(html.slice(i, lt));
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) {
      // Onafgesloten tag aan het einde → escapen.
      out += escapeText(html.slice(lt));
      break;
    }
    out += sanitizeTag(html.slice(lt, gt + 1));
    i = gt + 1;
  }

  const trimmed = out.trim();
  // Alleen lege tags/whitespace over? Dan is er geen zichtbare footer.
  const visible = trimmed
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;|&gt;|&amp;|&quot;|&nbsp;/g, ' ')
    .trim();
  return visible.length > 0 ? trimmed : '';
}

/** Wrapper-markup rond de gesaneerde footer (zelfde stijl als portal-mails). */
export function renderBrandingFooter(safeFooterHtml: string): string {
  return (
    `<div ${BRANDING_FOOTER_MARKER}="1" ` +
    `style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;` +
    `color:#6b7280;font-size:12px;">${safeFooterHtml}</div>`
  );
}

/** Platte-tekst-variant van de footer voor het text-part van de mail. */
export function footerHtmlToText(safeFooterHtml: string): string {
  return safeFooterHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface EmailBodyParts {
  html: string;
  text?: string;
}

/**
 * Haalt de tenant-branding-footer op, sanitizeert 'm en append 'm aan de
 * html- (en text-)body. Fail-open op infrastructuurfouten: een kapotte
 * branding-lookup mag nooit een mail blokkeren — dan gaat de mail zonder
 * footer uit.
 *
 * Dubbel appenden wordt voorkomen wanneer:
 *   - de body al een eerder ge-appende footer bevat (marker-attribuut), of
 *   - de body de footer-inhoud al bevat (bv. portal-notificaties die de
 *     branding-footer zelf al meerenderen).
 */
export async function appendTenantEmailFooter(
  tenantId: string,
  body: EmailBodyParts
): Promise<EmailBodyParts> {
  try {
    const branding = await getBrandingForTenant(tenantId);
    const raw = branding?.email_footer;
    if (!raw) return body;

    const safe = sanitizeEmailFooterHtml(raw);
    if (!safe) return body;

    if (
      body.html.includes(BRANDING_FOOTER_MARKER) ||
      body.html.includes(safe) ||
      body.html.includes(raw)
    ) {
      return body;
    }

    const textFooter = footerHtmlToText(safe);
    return {
      html: `${body.html}${renderBrandingFooter(safe)}`,
      text:
        body.text !== undefined && textFooter
          ? `${body.text}\n\n--\n${textFooter}`
          : body.text,
    };
  } catch {
    return body;
  }
}

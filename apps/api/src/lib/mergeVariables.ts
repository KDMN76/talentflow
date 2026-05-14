import { logger } from '../middleware/errorHandler';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MergeContext {
  candidate?: {
    first_name?: string | null;
    last_name?: string | null;
    name?: string;
    email?: string | null;
    [k: string]: unknown;
  };
  job?: {
    title?: string;
    [k: string]: unknown;
  };
  recruiter?: {
    name?: string;
    email?: string;
    [k: string]: unknown;
  };
  tenant?: {
    name?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// ─── Internals ──────────────────────────────────────────────────────────────

// Mustache-stijl: {{path.to.value}} — accepteert letters, cijfers, _ en .
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g;

function resolvePath(ctx: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Vervang Mustache-stijl placeholders {{path.to.value}} in `template`
 * met waarden uit `ctx`. Onbekende paden vallen terug op een lege string
 * (met een waarschuwing in de log) zodat e-mails er niet "rommelig" uitzien
 * met onvervangde placeholders.
 */
export function applyMergeVars(template: string, ctx: MergeContext): string {
  if (!template) return template;
  return template.replace(PLACEHOLDER_RE, (_match, path: string) => {
    const value = resolvePath(ctx, path);
    if (value === undefined || value === null) {
      logger.warn('[mergeVariables] missing merge variable — replaced with empty string', {
        variable: path,
      });
      return '';
    }
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    // Voor objecten/arrays: JSON-encoden zodat het zichtbaar wordt.
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  });
}

/**
 * Extraheer alle Mustache-stijl placeholders uit een template-string.
 * Geretourneerde lijst is geünifieerd en behoudt eerste-volgorde van voorkomen.
 *
 * Gebruikt voor preview (welke variabelen heb ik nodig?) en validatie.
 */
export function extractMergeVars(template: string): string[] {
  if (!template) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const path = match[1];
    if (!seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}

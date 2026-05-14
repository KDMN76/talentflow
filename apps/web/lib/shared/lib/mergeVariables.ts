/**
 * Merge-variable resolution for email templates.
 *
 * Templates use double-curly placeholders with optional dot-notation, e.g.
 *   "Hi {{candidate.first_name}}, you applied for {{job.title}}."
 *
 * Both the API (when sending) and the web app (for live preview) use the
 * helpers in this file so the rendered output is identical in both places.
 */

export type MergeContext = Record<string, unknown>;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Resolve a dot-notated path on the merge context. Returns `undefined` if
 * any segment is missing or non-traversable; the caller decides how to render
 * that case.
 */
export function resolveMergePath(
  context: MergeContext,
  path: string
): unknown {
  const parts = path.split('.');
  let cursor: unknown = context;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/**
 * Apply merge variables to a string. Unresolved placeholders are kept verbatim
 * (i.e. `{{candidate.unknown}}` stays as-is) so authors can spot missing data.
 *
 * If you instead want unresolved placeholders rendered as the empty string,
 * pass `{ fallback: '' }` (or any other replacement value).
 */
export function applyMergeVariables(
  template: string,
  context: MergeContext,
  options: { fallback?: string } = {}
): string {
  return template.replace(PLACEHOLDER_RE, (match, path: string) => {
    const value = resolveMergePath(context, path);
    if (value === undefined || value === null) {
      return options.fallback ?? match;
    }
    return String(value);
  });
}

/**
 * Extract all unique merge-variable paths used inside a template. The order
 * of returned keys matches the order of first appearance, which keeps the UI
 * deterministic when templates are edited.
 */
export function extractMergeVariables(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(template)) !== null) {
    const key = m[1];
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

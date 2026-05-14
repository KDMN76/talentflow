/**
 * Parity-tolerance engine.
 *
 * Comparison helpers used by the parity-checker (apps/api/scripts/parity-check.ts)
 * to decide whether two values from Manatal vs. TalentFlow are "the same enough"
 * given a configured tolerance window. Tolerance defaults match the Q1.3 spec:
 *
 *   datetime  : ±60 seconds
 *   string    : whitespace=ignore, accents=fold, case=fold
 *   number    : exact (tolerance=0)
 *   array     : order=ignore, element-wise string compare
 *
 * All helpers are pure, deterministic, and side-effect-free so the diff-engine
 * can call them in tight loops.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StringCompareOpts {
  whitespace?: 'ignore' | 'strict';
  accents?: 'fold' | 'strict';
  case?: 'fold' | 'strict';
  empty?: 'equal' | 'strict';
}

export interface ArrayCompareOpts {
  order?: 'matter' | 'ignore';
  string?: StringCompareOpts;
}

export interface ToleranceConfig {
  datetimeSeconds: number;
  whitespace: 'ignore' | 'strict';
  accents: 'fold' | 'strict';
  case: 'fold' | 'strict';
  number: number;
  arrayOrder: 'matter' | 'ignore';
}

export const DEFAULT_TOLERANCE: ToleranceConfig = {
  datetimeSeconds: 60,
  whitespace: 'ignore',
  accents: 'fold',
  case: 'fold',
  number: 0,
  arrayOrder: 'ignore',
};

// ─── Null/empty handling ─────────────────────────────────────────────────────

/**
 * Treat `null`, `undefined`, `''` and the literal strings `"null"`/`"None"`
 * (Manatal CSV emits these for blanks in Python-exported sheets) as equivalent
 * "no value" so blank cells don't show as diffs.
 */
export function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return true;
    const low = trimmed.toLowerCase();
    if (low === 'null' || low === 'none' || low === 'n/a' || low === '-') {
      return true;
    }
  }
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

// ─── String normalisation ────────────────────────────────────────────────────

/**
 * Fold accented characters to ASCII (`é` → `e`, `ç` → `c`, etc.) using
 * Unicode NFD decomposition + combining-mark stripping. Pure JS, no deps.
 */
export function foldAccents(s: string): string {
  // U+0300-U+036F = combining diacritical marks block.
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Apply the configured normalisations to a string for comparison purposes.
 * Returns the canonicalised string — does NOT compare yet.
 */
export function normaliseString(s: string, opts: StringCompareOpts = {}): string {
  let out = s;
  if ((opts.accents ?? 'fold') === 'fold') {
    out = foldAccents(out);
  }
  if ((opts.case ?? 'fold') === 'fold') {
    out = out.toLowerCase();
  }
  if ((opts.whitespace ?? 'ignore') === 'ignore') {
    // Collapse all runs of whitespace to a single space and trim.
    out = out.replace(/\s+/g, ' ').trim();
  }
  return out;
}

export function isStringEqual(
  a: unknown,
  b: unknown,
  opts: StringCompareOpts = {}
): boolean {
  if (isEmpty(a) && isEmpty(b)) return (opts.empty ?? 'equal') === 'equal';
  if (isEmpty(a) || isEmpty(b)) return false;
  const sa = typeof a === 'string' ? a : String(a);
  const sb = typeof b === 'string' ? b : String(b);
  return normaliseString(sa, opts) === normaliseString(sb, opts);
}

// ─── Date / datetime ─────────────────────────────────────────────────────────

/**
 * Parse a date-like value (ISO string, JS Date, epoch millis, "DD/MM/YYYY"
 * or "DD-MM-YYYY" — the formats Manatal CSV emits) into epoch millis.
 * Returns null on unparseable input.
 */
export function parseDateLike(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    return Number.isFinite(v.getTime()) ? v.getTime() : null;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;

  const s = v.trim();
  if (s === '') return null;

  // Native parse first — handles ISO and many locale formats.
  const native = Date.parse(s);
  if (Number.isFinite(native)) return native;

  // Fall back to DD/MM/YYYY or DD-MM-YYYY (NL/EU Manatal export style).
  const eu = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (eu) {
    let [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = eu;
    if (yyyy.length === 2) yyyy = (Number(yyyy) > 70 ? '19' : '20') + yyyy;
    const t = Date.UTC(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(mi),
      Number(ss)
    );
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function isDateTimeEqual(
  a: unknown,
  b: unknown,
  toleranceSeconds: number = DEFAULT_TOLERANCE.datetimeSeconds
): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (isEmpty(a) || isEmpty(b)) return false;
  const ta = parseDateLike(a);
  const tb = parseDateLike(b);
  if (ta === null || tb === null) return false;
  return Math.abs(ta - tb) <= toleranceSeconds * 1000;
}

// ─── Number ──────────────────────────────────────────────────────────────────

export function parseNumberLike(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  // Strip non-digits except `-` `.` `,` then collapse the EU comma decimal.
  const cleaned = v.replace(/[^\d,.\-]/g, '').replace(/\.(?=\d{3}\b)/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === ',') {
    return null;
  }
  const dotted = cleaned.replace(',', '.');
  const n = Number(dotted);
  return Number.isFinite(n) ? n : null;
}

export function isNumberEqual(
  a: unknown,
  b: unknown,
  tolerance: number = DEFAULT_TOLERANCE.number
): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (isEmpty(a) || isEmpty(b)) return false;
  const na = parseNumberLike(a);
  const nb = parseNumberLike(b);
  if (na === null || nb === null) return false;
  return Math.abs(na - nb) <= tolerance;
}

// ─── Array ───────────────────────────────────────────────────────────────────

/**
 * Coerce an array-or-stringified-array into a string[]. Manatal CSVs encode
 * tags/skills as comma- or semicolon-separated strings; TalentFlow uses
 * Postgres text[]. Both shapes flow through this helper.
 */
export function coerceToStringArray(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return [];
    // Try JSON-array-shaped inputs first ("[\"a\", \"b\"]")
    if (s.startsWith('[') && s.endsWith(']')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.map((x) => String(x));
      } catch {
        /* fallthrough to delimiter-split */
      }
    }
    // Postgres array literal: {a,b,c}
    if (s.startsWith('{') && s.endsWith('}')) {
      const inner = s.slice(1, -1);
      if (inner === '') return [];
      return inner.split(',').map((x) => x.replace(/^"(.*)"$/, '$1'));
    }
    // Comma- or semicolon-separated.
    return s
      .split(/[,;|]/)
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }
  return [String(v)];
}

export function isArrayEqual(
  a: unknown,
  b: unknown,
  opts: ArrayCompareOpts = {}
): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (isEmpty(a) || isEmpty(b)) return false;
  const aa = coerceToStringArray(a);
  const bb = coerceToStringArray(b);
  if (aa.length !== bb.length) return false;
  const order = opts.order ?? 'ignore';
  const stringOpts = opts.string ?? {};

  if (order === 'matter') {
    return aa.every((v, i) => isStringEqual(v, bb[i], stringOpts));
  }

  // Order-independent: bucket-match. We normalise then sort.
  const sa = aa.map((v) => normaliseString(v, stringOpts)).sort();
  const sb = bb.map((v) => normaliseString(v, stringOpts)).sort();
  return sa.every((v, i) => v === sb[i]);
}

// ─── Boolean ─────────────────────────────────────────────────────────────────

const TRUTHY_STRINGS = new Set(['true', 't', 'yes', 'y', '1', 'ja']);
const FALSY_STRINGS = new Set(['false', 'f', 'no', 'n', '0', 'nee']);

export function parseBooleanLike(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const low = v.trim().toLowerCase();
    if (TRUTHY_STRINGS.has(low)) return true;
    if (FALSY_STRINGS.has(low)) return false;
  }
  return null;
}

export function isBooleanEqual(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (isEmpty(a) || isEmpty(b)) return false;
  const ba = parseBooleanLike(a);
  const bb = parseBooleanLike(b);
  if (ba === null || bb === null) return false;
  return ba === bb;
}

// ─── Phone / email normalisation ─────────────────────────────────────────────

/** Strip everything except digits and a leading + so phone matching ignores
 *  spaces, dashes, parens and dots. */
export function normalisePhone(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (s === '') return '';
  // Keep leading +, drop all other non-digits.
  const hasPlus = s.startsWith('+');
  const digits = s.replace(/[^\d]/g, '');
  return hasPlus ? `+${digits}` : digits;
}

export function normaliseEmail(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim().toLowerCase();
}

// ─── CLI flag parsing ────────────────────────────────────────────────────────

/**
 * Parse a `--tolerance datetime=60s,whitespace=ignore,accents=fold,...` value
 * into a partial ToleranceConfig. Unknown keys are silently ignored.
 */
export function parseToleranceFlag(raw: string | undefined): Partial<ToleranceConfig> {
  if (!raw) return {};
  const out: Partial<ToleranceConfig> = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=').map((x) => x.trim());
    if (!k || v === undefined) continue;
    switch (k) {
      case 'datetime': {
        const m = /^(\d+)\s*(s|m|h)?$/.exec(v);
        if (!m) break;
        const n = Number(m[1]);
        const unit = m[2] ?? 's';
        out.datetimeSeconds =
          unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n;
        break;
      }
      case 'whitespace':
        if (v === 'ignore' || v === 'strict') out.whitespace = v;
        break;
      case 'accents':
        if (v === 'fold' || v === 'strict') out.accents = v;
        break;
      case 'case':
        if (v === 'fold' || v === 'strict') out.case = v;
        break;
      case 'number':
        if (!Number.isNaN(Number(v))) out.number = Number(v);
        break;
      case 'arrayOrder':
      case 'array_order':
        if (v === 'matter' || v === 'ignore') out.arrayOrder = v;
        break;
    }
  }
  return out;
}

// ─── Levenshtein (for fuzzy name match in smart-matching) ────────────────────

/**
 * Plain DP Levenshtein. O(n·m) — fine for the short strings we feed it
 * (candidate names rarely exceed 40 chars).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length;
  const n = b.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insert
        prev[j] + 1, // delete
        prev[j - 1] + cost // substitute
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

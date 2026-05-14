/**
 * Boolean search — recursive-descent parser + SQL compiler.
 *
 * Syntax:
 *   - Naked term:           react                    → ILIKE alle default-velden
 *   - Quoted phrase:        "senior developer"       → exact phrase (ILIKE %..%)
 *   - Fielded:              skills:react             → enkel veld
 *                           title:"senior dev"       → fielded phrase
 *   - Operators:            AND, OR, NOT (case-insensitive, must be uppercase)
 *   - Implicit AND:         twee terms naast elkaar = AND
 *   - Grouping:             (react OR vue) AND ts
 *   - NOT:                  AND NOT junior  ─OF─  -junior  ─OF─  NOT junior
 *
 * Defensief — produceert alleen parameterized SQL. Geen string-interpolatie
 * van user-input. Onbalans-haken / lege expressies → throw met duidelijke
 * boodschap.
 *
 * MVP-implementatie: voor candidates valt de "default search" terug op een
 * ILIKE-OR over name/email/current_position/current_company/description +
 * een ANY()-match tegen skills[] en tags[]. Voor jobs: title/description/
 * job_reference/location.
 */

// ────────────────────────────────────────────────────────────────────────────
// AST
// ────────────────────────────────────────────────────────────────────────────

export type BooleanQuery =
  | { type: 'term'; value: string; field?: string }
  | { type: 'phrase'; value: string; field?: string }
  | { type: 'and'; left: BooleanQuery; right: BooleanQuery }
  | { type: 'or'; left: BooleanQuery; right: BooleanQuery }
  | { type: 'not'; child: BooleanQuery };

// ────────────────────────────────────────────────────────────────────────────
// Tokenizer
// ────────────────────────────────────────────────────────────────────────────

type TokenType =
  | 'TERM'
  | 'PHRASE'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'LPAREN'
  | 'RPAREN'
  | 'COLON'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  /** Position in original input — used in error messages. */
  pos: number;
}

const KEYWORD_TYPES: Record<string, TokenType> = {
  AND: 'AND',
  OR: 'OR',
  NOT: 'NOT',
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Whitespace — skip
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(', pos: i });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')', pos: i });
      i++;
      continue;
    }

    // Hyphen as NOT-prefix — only when preceded by whitespace (or at start
    // of input / after a structural token) AND followed by a term-starter.
    // Examples that should become NOT:
    //   "-junior"             → NOT junior
    //   "react -junior"       → react AND NOT junior   (implicit AND)
    //   "(react) -junior"     → (react) AND NOT junior
    // Examples that should stay literal:
    //   "co-founder"          → single TERM
    //   "react--vue"          → not handled, treat as literal
    if (ch === '-') {
      // Hyphen-as-NOT requires that the previous character (in the raw input)
      // is whitespace, '(' , or this is the first non-space char.
      const prevCh = i > 0 ? input[i - 1] : ' ';
      const previousIsBoundary =
        prevCh === ' ' || prevCh === '\t' || prevCh === '\n' || prevCh === '\r' || prevCh === '(';
      const nextCh = input[i + 1];
      const looksLikeTermStart =
        nextCh !== undefined &&
        (/[a-zA-Z0-9_"]/.test(nextCh) || nextCh === '(');
      if (previousIsBoundary && looksLikeTermStart) {
        tokens.push({ type: 'NOT', value: '-', pos: i });
        i++;
        continue;
      }
      // Otherwise treat as part of a term (e.g. "co-founder").
    }

    // Quoted phrase
    if (ch === '"') {
      const start = i;
      i++; // skip opening quote
      let value = '';
      while (i < len && input[i] !== '"') {
        // Allow simple backslash-escape of quotes
        if (input[i] === '\\' && i + 1 < len && input[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        value += input[i];
        i++;
      }
      if (i >= len) {
        throw new BooleanSearchError(
          `Onafgesloten phrase — verwacht een sluitende '"' rond positie ${start}`
        );
      }
      i++; // skip closing quote
      tokens.push({ type: 'PHRASE', value, pos: start });
      continue;
    }

    // Bare term — letters, digits, underscores, dots, hyphens (in middle)
    if (/[a-zA-Z0-9_]/.test(ch)) {
      const start = i;
      let value = '';
      while (i < len && /[a-zA-Z0-9_.\-+#]/.test(input[i])) {
        value += input[i];
        i++;
      }

      // Field qualifier: an identifier directly followed by ':' becomes a
      // FIELD token (we emit TERM + COLON; the parser combines them).
      if (input[i] === ':') {
        tokens.push({ type: 'TERM', value, pos: start });
        tokens.push({ type: 'COLON', value: ':', pos: i });
        i++;
        continue;
      }

      // Promote keywords (case-insensitive). We require all-caps in input
      // for users so keyword detection isn't ambiguous: AND/OR/NOT.
      // Pragmatic: also accept lowercase as keywords because most users
      // type "react and typescript". This prioritises usability.
      const upper = value.toUpperCase();
      if (KEYWORD_TYPES[upper]) {
        tokens.push({ type: KEYWORD_TYPES[upper], value: upper, pos: start });
        continue;
      }

      tokens.push({ type: 'TERM', value, pos: start });
      continue;
    }

    // Unknown character — throw with context so the user knows where to look.
    throw new BooleanSearchError(
      `Onverwacht teken '${ch}' op positie ${i}`
    );
  }

  tokens.push({ type: 'EOF', value: '', pos: len });
  return tokens;
}

// ────────────────────────────────────────────────────────────────────────────
// Parser (recursive descent)
//
// Grammar (precedence: NOT > AND > OR):
//   expr      := orExpr
//   orExpr    := andExpr ('OR' andExpr)*
//   andExpr   := notExpr (('AND'? ) notExpr)*       — implicit AND when 2 terms touch
//   notExpr   := 'NOT' notExpr | atom
//   atom      := '(' expr ')' | term
//   term      := IDENT (':' (PHRASE | IDENT))? | PHRASE
// ────────────────────────────────────────────────────────────────────────────

export class BooleanSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BooleanSearchError';
  }
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private consume(): Token {
    return this.tokens[this.pos++];
  }
  private match(...types: TokenType[]): boolean {
    return types.includes(this.peek().type);
  }
  private expect(type: TokenType): Token {
    const t = this.peek();
    if (t.type !== type) {
      throw new BooleanSearchError(
        `Verwacht ${type} maar kreeg ${t.type} ('${t.value}') op positie ${t.pos}`
      );
    }
    return this.consume();
  }

  parse(): BooleanQuery {
    if (this.peek().type === 'EOF') {
      throw new BooleanSearchError('Lege zoekopdracht');
    }
    const expr = this.parseOr();
    if (this.peek().type !== 'EOF') {
      const t = this.peek();
      throw new BooleanSearchError(
        `Onverwachte token '${t.value}' (${t.type}) op positie ${t.pos}`
      );
    }
    return expr;
  }

  private parseOr(): BooleanQuery {
    let left = this.parseAnd();
    while (this.match('OR')) {
      this.consume();
      const right = this.parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): BooleanQuery {
    let left = this.parseNot();
    // AND can be explicit or implicit — keep parsing while next is something
    // that starts an atom (TERM/PHRASE/LPAREN/NOT/AND).
    while (
      this.match('AND') ||
      this.match('TERM', 'PHRASE', 'LPAREN', 'NOT')
    ) {
      if (this.match('AND')) this.consume();
      const right = this.parseNot();
      left = { type: 'and', left, right };
    }
    return left;
  }

  private parseNot(): BooleanQuery {
    if (this.match('NOT')) {
      this.consume();
      const child = this.parseNot();
      return { type: 'not', child };
    }
    return this.parseAtom();
  }

  private parseAtom(): BooleanQuery {
    const t = this.peek();
    if (t.type === 'LPAREN') {
      this.consume();
      const expr = this.parseOr();
      if (!this.match('RPAREN')) {
        throw new BooleanSearchError(
          `Verwacht ')' maar kreeg ${this.peek().type} op positie ${this.peek().pos}`
        );
      }
      this.consume();
      return expr;
    }
    if (t.type === 'PHRASE') {
      this.consume();
      return { type: 'phrase', value: t.value };
    }
    if (t.type === 'TERM') {
      this.consume();
      // Field qualifier — TERM followed by COLON
      if (this.match('COLON')) {
        this.consume();
        const valueTok = this.peek();
        if (valueTok.type === 'PHRASE') {
          this.consume();
          return { type: 'phrase', value: valueTok.value, field: t.value };
        }
        if (valueTok.type === 'TERM') {
          this.consume();
          return { type: 'term', value: valueTok.value, field: t.value };
        }
        throw new BooleanSearchError(
          `Verwacht waarde na '${t.value}:' maar kreeg ${valueTok.type} op positie ${valueTok.pos}`
        );
      }
      return { type: 'term', value: t.value };
    }
    throw new BooleanSearchError(
      `Onverwachte token '${t.value}' (${t.type}) op positie ${t.pos}`
    );
  }
}

export function parseBoolean(input: string): BooleanQuery {
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    throw new BooleanSearchError('Lege zoekopdracht');
  }
  const tokens = tokenize(trimmed);
  const parser = new Parser(tokens);
  return parser.parse();
}

// ────────────────────────────────────────────────────────────────────────────
// SQL compiler
// ────────────────────────────────────────────────────────────────────────────

export interface CompiledSQL {
  sql: string;
  values: unknown[];
  nextIndex: number;
}

export type Entity = 'candidate' | 'job';

/**
 * Per-entity field map. Each entry describes how to match against a column:
 *   - 'ilike'      → standard text LIKE %value%
 *   - 'array_text' → text[] column matched via EXISTS over unnest()
 *
 * Fields keyed here become valid `field:value` qualifiers. The list under
 * `__default__` is matched in OR-mode for naked terms.
 */
type FieldKind = 'ilike' | 'array_text';

interface FieldDef {
  column: string;
  kind: FieldKind;
}

const CANDIDATE_FIELDS: Record<string, FieldDef> = {
  name: { column: 'name', kind: 'ilike' },
  email: { column: 'email', kind: 'ilike' },
  candidate_reference: { column: 'candidate_reference', kind: 'ilike' },
  reference: { column: 'candidate_reference', kind: 'ilike' },
  current_position: { column: 'current_position', kind: 'ilike' },
  position: { column: 'current_position', kind: 'ilike' },
  current_company: { column: 'current_company', kind: 'ilike' },
  company: { column: 'current_company', kind: 'ilike' },
  title: { column: 'current_position', kind: 'ilike' }, // alias
  description: { column: 'description', kind: 'ilike' },
  industry: { column: 'industry', kind: 'ilike' },
  city: { column: 'address_city', kind: 'ilike' },
  country: { column: 'address_country', kind: 'ilike' },
  skills: { column: 'skills', kind: 'array_text' },
  skill: { column: 'skills', kind: 'array_text' },
  tags: { column: 'tags', kind: 'array_text' },
  tag: { column: 'tags', kind: 'array_text' },
};

const CANDIDATE_DEFAULT_FIELDS: FieldDef[] = [
  CANDIDATE_FIELDS.name,
  CANDIDATE_FIELDS.email,
  CANDIDATE_FIELDS.current_position,
  CANDIDATE_FIELDS.current_company,
  CANDIDATE_FIELDS.description,
  CANDIDATE_FIELDS.skills,
  CANDIDATE_FIELDS.tags,
];

const JOB_FIELDS: Record<string, FieldDef> = {
  title: { column: 'title', kind: 'ilike' },
  description: { column: 'description', kind: 'ilike' },
  job_reference: { column: 'job_reference', kind: 'ilike' },
  reference: { column: 'job_reference', kind: 'ilike' },
  location: { column: 'location', kind: 'ilike' },
  department: { column: 'department', kind: 'ilike' },
  industry: { column: 'industry', kind: 'ilike' },
};

const JOB_DEFAULT_FIELDS: FieldDef[] = [
  JOB_FIELDS.title,
  JOB_FIELDS.description,
  JOB_FIELDS.job_reference,
  JOB_FIELDS.location,
];

function getFieldMap(entity: Entity): {
  fields: Record<string, FieldDef>;
  defaults: FieldDef[];
} {
  if (entity === 'candidate') {
    return { fields: CANDIDATE_FIELDS, defaults: CANDIDATE_DEFAULT_FIELDS };
  }
  return { fields: JOB_FIELDS, defaults: JOB_DEFAULT_FIELDS };
}

/**
 * Build a single-field WHERE-fragment for a value.
 *
 * - `ilike`      → `column ILIKE $N` with `%value%` wrapping (caller adds %)
 * - `array_text` → `EXISTS (SELECT 1 FROM unnest(column) AS t WHERE t ILIKE $N)`
 */
function buildFieldClause(
  def: FieldDef,
  paramIndex: number,
  isPhrase: boolean
): { sql: string; bindValue: string } {
  // For phrases we keep spaces; for terms we still use ILIKE %x% so partial
  // matches work intuitively (e.g. "react" matches "reactjs"). If a user
  // wants exact, they can quote: "react".
  const wrapped = isPhrase ? `%${escapeLike(def, true)}%` : `%${escapeLike(def, false)}%`;
  if (def.kind === 'array_text') {
    return {
      sql: `EXISTS (SELECT 1 FROM unnest(${def.column}) AS _t WHERE _t ILIKE $${paramIndex})`,
      bindValue: wrapped,
    };
  }
  return {
    sql: `${def.column} ILIKE $${paramIndex}`,
    bindValue: wrapped,
  };
}

// Defensive: we don't actually escape LIKE-meta-chars per-field; we accept the
// semantic that "%" in user-search is treated as wildcard. This function
// exists to keep the API explicit; for now it just returns the placeholder.
function escapeLike(_def: FieldDef, _isPhrase: boolean): string {
  // Real value is supplied by the leaf compiler; this helper is intentionally
  // a no-op so future hardening can plug in here without touching call-sites.
  return '__VALUE__';
}

interface CompileCtx {
  values: unknown[];
  index: number;
  entity: Entity;
}

function compileNode(node: BooleanQuery, ctx: CompileCtx): string {
  switch (node.type) {
    case 'and': {
      const left = compileNode(node.left, ctx);
      const right = compileNode(node.right, ctx);
      return `(${left} AND ${right})`;
    }
    case 'or': {
      const left = compileNode(node.left, ctx);
      const right = compileNode(node.right, ctx);
      return `(${left} OR ${right})`;
    }
    case 'not': {
      const child = compileNode(node.child, ctx);
      return `(NOT ${child})`;
    }
    case 'term':
    case 'phrase': {
      return compileLeaf(node, ctx);
    }
  }
}

function compileLeaf(
  node: Extract<BooleanQuery, { type: 'term' | 'phrase' }>,
  ctx: CompileCtx
): string {
  const isPhrase = node.type === 'phrase';
  const value = node.value;
  const { fields, defaults } = getFieldMap(ctx.entity);

  if (node.field) {
    const def = fields[node.field.toLowerCase()];
    if (!def) {
      throw new BooleanSearchError(
        `Onbekend zoekveld '${node.field}' voor ${ctx.entity}. ` +
          `Beschikbaar: ${Object.keys(fields).join(', ')}`
      );
    }
    ctx.values.push(`%${value}%`);
    const { sql } = buildFieldClause(def, ctx.index, isPhrase);
    ctx.index++;
    return sql;
  }

  // Naked term: OR over all default fields. We push ONE param and reuse the
  // placeholder N times — keeps the SQL short and avoids N copies of the value.
  ctx.values.push(`%${value}%`);
  const placeholderIdx = ctx.index;
  ctx.index++;

  const fragments = defaults.map((def) => {
    if (def.kind === 'array_text') {
      return `EXISTS (SELECT 1 FROM unnest(${def.column}) AS _t WHERE _t ILIKE $${placeholderIdx})`;
    }
    return `${def.column} ILIKE $${placeholderIdx}`;
  });

  return `(${fragments.join(' OR ')})`;
}

/**
 * Compile a parsed BooleanQuery to a parameterised PostgreSQL WHERE-fragment.
 *
 * @param q          The parsed query AST
 * @param entity     'candidate' | 'job' — selects which columns are searchable
 * @param startIndex First $N placeholder to use (e.g. 3 if caller already
 *                   bound $1, $2). Returned `nextIndex` lets the caller chain
 *                   additional binds.
 */
export function compileToSQL(
  q: BooleanQuery,
  entity: Entity,
  startIndex: number
): CompiledSQL {
  const ctx: CompileCtx = { values: [], index: startIndex, entity };
  const sql = compileNode(q, ctx);
  return {
    sql,
    values: ctx.values,
    nextIndex: ctx.index,
  };
}

/**
 * Convenience: parse + compile in one call.
 */
export function compileBooleanSearch(
  input: string,
  entity: Entity,
  startIndex: number
): CompiledSQL {
  const ast = parseBoolean(input);
  return compileToSQL(ast, entity, startIndex);
}

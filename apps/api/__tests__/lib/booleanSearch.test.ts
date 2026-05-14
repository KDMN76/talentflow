import { describe, it, expect } from 'vitest';
import {
  parseBoolean,
  compileToSQL,
  compileBooleanSearch,
  BooleanSearchError,
  type BooleanQuery,
} from '../../src/lib/booleanSearch';

// ────────────────────────────────────────────────────────────────────────────
// PARSER — AST shape
// ────────────────────────────────────────────────────────────────────────────

describe('parseBoolean — AST', () => {
  it('parses a single naked term', () => {
    expect(parseBoolean('react')).toEqual({ type: 'term', value: 'react' });
  });

  it('parses a quoted phrase', () => {
    expect(parseBoolean('"senior developer"')).toEqual({
      type: 'phrase',
      value: 'senior developer',
    });
  });

  it('parses AND between two terms', () => {
    const ast = parseBoolean('react AND typescript');
    expect(ast).toEqual({
      type: 'and',
      left: { type: 'term', value: 'react' },
      right: { type: 'term', value: 'typescript' },
    });
  });

  it('parses implicit AND when terms are separated by whitespace', () => {
    const ast = parseBoolean('react typescript');
    expect(ast).toEqual({
      type: 'and',
      left: { type: 'term', value: 'react' },
      right: { type: 'term', value: 'typescript' },
    });
  });

  it('parses OR between three terms (left-assoc)', () => {
    const ast = parseBoolean('react OR vue OR angular');
    expect(ast).toEqual({
      type: 'or',
      left: {
        type: 'or',
        left: { type: 'term', value: 'react' },
        right: { type: 'term', value: 'vue' },
      },
      right: { type: 'term', value: 'angular' },
    });
  });

  it('OR has lower precedence than AND', () => {
    const ast = parseBoolean('a OR b AND c') as Extract<BooleanQuery, { type: 'or' }>;
    expect(ast.type).toBe('or');
    expect(ast.right.type).toBe('and');
  });

  it('parens override precedence', () => {
    const ast = parseBoolean('(react OR vue) AND typescript') as Extract<
      BooleanQuery,
      { type: 'and' }
    >;
    expect(ast.type).toBe('and');
    expect(ast.left.type).toBe('or');
    expect(ast.right).toEqual({ type: 'term', value: 'typescript' });
  });

  it('parses NOT prefix', () => {
    const ast = parseBoolean('NOT junior') as Extract<BooleanQuery, { type: 'not' }>;
    expect(ast.type).toBe('not');
    expect(ast.child).toEqual({ type: 'term', value: 'junior' });
  });

  it('parses AND NOT chain', () => {
    const ast = parseBoolean('react AND NOT junior') as Extract<
      BooleanQuery,
      { type: 'and' }
    >;
    expect(ast.type).toBe('and');
    expect(ast.right.type).toBe('not');
  });

  it('parses hyphen as NOT-prefix at start of token', () => {
    const ast = parseBoolean('react -junior') as Extract<BooleanQuery, { type: 'and' }>;
    expect(ast.type).toBe('and');
    expect(ast.right.type).toBe('not');
    expect((ast.right as Extract<BooleanQuery, { type: 'not' }>).child).toEqual({
      type: 'term',
      value: 'junior',
    });
  });

  it('parses fielded term', () => {
    expect(parseBoolean('skills:react')).toEqual({
      type: 'term',
      field: 'skills',
      value: 'react',
    });
  });

  it('parses fielded phrase', () => {
    expect(parseBoolean('title:"senior developer"')).toEqual({
      type: 'phrase',
      field: 'title',
      value: 'senior developer',
    });
  });

  it('combines fielded queries with AND', () => {
    const ast = parseBoolean('skills:react AND title:"senior"') as Extract<
      BooleanQuery,
      { type: 'and' }
    >;
    expect(ast.type).toBe('and');
    expect(ast.left).toEqual({ type: 'term', field: 'skills', value: 'react' });
    expect(ast.right).toEqual({ type: 'phrase', field: 'title', value: 'senior' });
  });

  it('accepts lowercase operators', () => {
    const ast = parseBoolean('react and typescript') as Extract<BooleanQuery, { type: 'and' }>;
    expect(ast.type).toBe('and');
  });

  it('preserves dots, plus, and hash inside identifiers', () => {
    const ast = parseBoolean('node.js c++ c#') as BooleanQuery;
    // Just verify it parses without throwing and yields three TERM leaves
    // joined by implicit AND.
    expect(JSON.stringify(ast)).toContain('node.js');
    expect(JSON.stringify(ast)).toContain('c++');
    expect(JSON.stringify(ast)).toContain('c#');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PARSER — error cases
// ────────────────────────────────────────────────────────────────────────────

describe('parseBoolean — errors', () => {
  it('throws on empty input', () => {
    expect(() => parseBoolean('')).toThrow(BooleanSearchError);
    expect(() => parseBoolean('   ')).toThrow(BooleanSearchError);
  });

  it('throws on unbalanced opening paren', () => {
    expect(() => parseBoolean('(react OR vue')).toThrow(/\)/);
  });

  it('throws on unbalanced closing paren', () => {
    expect(() => parseBoolean('react OR vue)')).toThrow(BooleanSearchError);
  });

  it('throws on unterminated phrase', () => {
    expect(() => parseBoolean('"senior developer')).toThrow(/phrase/i);
  });

  it('throws on missing value after colon', () => {
    expect(() => parseBoolean('skills:')).toThrow(/Verwacht waarde na/);
  });

  it('throws on dangling AND', () => {
    expect(() => parseBoolean('react AND')).toThrow(BooleanSearchError);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// SQL COMPILER — candidate
// ────────────────────────────────────────────────────────────────────────────

describe('compileToSQL — candidate', () => {
  it('compiles single term to OR over default fields', () => {
    const ast = parseBoolean('react');
    const c = compileToSQL(ast, 'candidate', 1);
    // Should reference name, email, current_position, current_company,
    // description AND skills/tags arrays.
    expect(c.sql).toContain('name ILIKE $1');
    expect(c.sql).toContain('email ILIKE $1');
    expect(c.sql).toContain('current_position ILIKE $1');
    expect(c.sql).toContain('unnest(skills)');
    expect(c.sql).toContain('unnest(tags)');
    expect(c.values).toEqual(['%react%']);
    expect(c.nextIndex).toBe(2);
  });

  it('compiles AND of two terms with two distinct placeholders', () => {
    const ast = parseBoolean('react AND typescript');
    const c = compileToSQL(ast, 'candidate', 1);
    expect(c.sql).toContain(' AND ');
    expect(c.sql).toContain('$1');
    expect(c.sql).toContain('$2');
    expect(c.values).toEqual(['%react%', '%typescript%']);
    expect(c.nextIndex).toBe(3);
  });

  it('compiles fielded term to single-column ILIKE', () => {
    const ast = parseBoolean('current_company:Acme');
    const c = compileToSQL(ast, 'candidate', 1);
    expect(c.sql).toBe('current_company ILIKE $1');
    expect(c.values).toEqual(['%Acme%']);
  });

  it('compiles array-field qualifier to EXISTS-unnest', () => {
    const ast = parseBoolean('skills:react');
    const c = compileToSQL(ast, 'candidate', 1);
    expect(c.sql).toContain('EXISTS');
    expect(c.sql).toContain('unnest(skills)');
    expect(c.values).toEqual(['%react%']);
  });

  it('compiles NOT to wrapped NOT-clause', () => {
    const ast = parseBoolean('NOT junior');
    const c = compileToSQL(ast, 'candidate', 1);
    expect(c.sql).toMatch(/^\(NOT /);
  });

  it('compiles grouped expression with correct parens', () => {
    const ast = parseBoolean('(skills:react OR skills:vue) AND title:"senior"');
    const c = compileToSQL(ast, 'candidate', 1);
    // 3 placeholders, 2 nested groups
    expect(c.values).toHaveLength(3);
    expect(c.sql).toContain(' AND ');
    expect(c.sql).toContain(' OR ');
  });

  it('throws on unknown field', () => {
    const ast = parseBoolean('zzz_unknown:foo');
    expect(() => compileToSQL(ast, 'candidate', 1)).toThrow(/Onbekend zoekveld/);
  });

  it('respects startIndex parameter', () => {
    const ast = parseBoolean('react');
    const c = compileToSQL(ast, 'candidate', 5);
    expect(c.sql).toContain('$5');
    expect(c.nextIndex).toBe(6);
  });

  it('supports phrase with multi-word ILIKE', () => {
    const ast = parseBoolean('"senior developer"');
    const c = compileToSQL(ast, 'candidate', 1);
    expect(c.values).toEqual(['%senior developer%']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// SQL COMPILER — job
// ────────────────────────────────────────────────────────────────────────────

describe('compileToSQL — job', () => {
  it('uses job-specific default fields', () => {
    const ast = parseBoolean('engineer');
    const c = compileToSQL(ast, 'job', 1);
    expect(c.sql).toContain('title ILIKE $1');
    expect(c.sql).toContain('description ILIKE $1');
    expect(c.sql).toContain('job_reference ILIKE $1');
    expect(c.sql).toContain('location ILIKE $1');
    expect(c.sql).not.toContain('current_position'); // candidate-only
    expect(c.sql).not.toContain('skills'); // jobs default doesn't include array fields
  });

  it('rejects candidate-only fields when entity is job', () => {
    const ast = parseBoolean('skills:react');
    expect(() => compileToSQL(ast, 'job', 1)).toThrow(/Onbekend zoekveld/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PARAMETERISATION — defensief: geen string-interpolatie
// ────────────────────────────────────────────────────────────────────────────

describe('compileToSQL — SQL injection defence', () => {
  it('passes risky characters as bound values, never inline', () => {
    const ast = parseBoolean('"foo\'); DROP TABLE candidates;--"');
    const c = compileToSQL(ast, 'candidate', 1);
    // The dangerous payload must appear ONLY in the values array, not in SQL
    expect(c.sql).not.toContain('DROP TABLE');
    expect(c.values[0]).toContain('DROP TABLE');
  });

  it('phrase with backslash-escaped quote is preserved', () => {
    const ast = parseBoolean('"he said \\"hi\\""');
    const c = compileToSQL(ast, 'candidate', 1);
    expect(c.values[0]).toBe('%he said "hi"%');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// END-TO-END convenience
// ────────────────────────────────────────────────────────────────────────────

describe('compileBooleanSearch (parse + compile)', () => {
  it('returns SQL+values for a complex query', () => {
    const c = compileBooleanSearch(
      '(skills:react OR skills:vue) AND title:"senior" AND NOT skills:wordpress',
      'candidate',
      1
    );
    expect(c.values).toEqual(['%react%', '%vue%', '%senior%', '%wordpress%']);
    expect(c.sql).toContain(' AND ');
    expect(c.sql).toContain(' OR ');
    expect(c.sql).toContain('NOT ');
    expect(c.nextIndex).toBe(5);
  });
});

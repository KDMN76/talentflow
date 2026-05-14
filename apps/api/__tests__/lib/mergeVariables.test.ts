import { describe, it, expect } from 'vitest';
import {
  applyMergeVars,
  extractMergeVars,
} from '../../src/lib/mergeVariables';

describe('applyMergeVars', () => {
  it('replaces a top-level merge variable', () => {
    const out = applyMergeVars('Hello {{candidate.first_name}}!', {
      candidate: { first_name: 'Sofia' },
    });
    expect(out).toBe('Hello Sofia!');
  });

  it('handles dot-notation traversal across multiple levels', () => {
    const out = applyMergeVars('{{a.b.c}}', {
      a: { b: { c: 'deep' } },
    });
    expect(out).toBe('deep');
  });

  it('replaces unknown paths with an empty string', () => {
    const out = applyMergeVars('Beste {{candidate.first_name}}', {
      candidate: {},
    });
    expect(out).toBe('Beste ');
  });

  it('replaces multiple placeholders in a single template', () => {
    const out = applyMergeVars(
      'Beste {{candidate.first_name}}, bedankt voor je sollicitatie op {{job.title}}.',
      {
        candidate: { first_name: 'Lars' },
        job: { title: 'Senior Engineer' },
      }
    );
    expect(out).toBe(
      'Beste Lars, bedankt voor je sollicitatie op Senior Engineer.'
    );
  });

  it('coerces numbers and booleans to strings', () => {
    const out = applyMergeVars('Score: {{x}}, active: {{y}}', {
      x: 42,
      y: true,
    });
    expect(out).toBe('Score: 42, active: true');
  });

  it('JSON-encodes object/array values', () => {
    const out = applyMergeVars('skills: {{candidate.skills}}', {
      candidate: { skills: ['ts', 'pg'] },
    });
    expect(out).toBe('skills: ["ts","pg"]');
  });

  it('returns empty string for empty template', () => {
    expect(applyMergeVars('', {})).toBe('');
  });

  it('tolerates whitespace inside the placeholder braces', () => {
    const out = applyMergeVars('Hi {{  candidate.first_name  }}', {
      candidate: { first_name: 'Mira' },
    });
    expect(out).toBe('Hi Mira');
  });

  it('does not interpret malformed placeholders', () => {
    // Single brace — leave verbatim.
    const tmpl = 'Hello {candidate.first_name}!';
    expect(applyMergeVars(tmpl, { candidate: { first_name: 'X' } })).toBe(tmpl);
  });
});

describe('extractMergeVars', () => {
  it('returns all unique placeholders in first-occurrence order', () => {
    const vars = extractMergeVars(
      'Beste {{candidate.first_name}}, je sollicitatie voor {{job.title}}. ' +
        'Vragen? Mail {{recruiter.email}} of vraag naar {{recruiter.email}}.'
    );
    expect(vars).toEqual([
      'candidate.first_name',
      'job.title',
      'recruiter.email',
    ]);
  });

  it('returns an empty array for templates without placeholders', () => {
    expect(extractMergeVars('plain text')).toEqual([]);
    expect(extractMergeVars('')).toEqual([]);
  });
});

/**
 * jdGenerator lib tests — Sprint Q3.2.
 *
 * Vitest setup mockt @anthropic-ai/sdk → de mock-fallback in jdGenerator
 * activeert vanzelf zonder ANTHROPIC_API_KEY.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateJd,
  generateSingleJdVariant,
  computeClarityScore,
  computeInclusivityScore,
  detectBiasFlags,
} from '../../src/lib/jdGenerator';

describe('detectBiasFlags', () => {
  it('detects gendered language ("rockstar")', () => {
    const flags = detectBiasFlags(
      'We are looking for a rockstar developer to join our team.'
    );
    expect(flags.some((f) => f.type === 'gendered_language')).toBe(true);
  });

  it('detects unrealistic 10+ years experience', () => {
    const flags = detectBiasFlags('Vereisten: minimaal 10+ jaar ervaring met React.');
    expect(flags.some((f) => f.type === 'unrealistic_requirement')).toBe(true);
  });

  it('detects "native speaker" as exclusionary', () => {
    const flags = detectBiasFlags('Required: native speaker of Dutch.');
    expect(flags.some((f) => f.type === 'exclusionary')).toBe(true);
  });

  it('returns [] for clean Dutch text', () => {
    const flags = detectBiasFlags(
      'We zoeken een ervaren ontwikkelaar met C1-niveau Nederlands.'
    );
    expect(flags).toEqual([]);
  });

  it('caps at 10 flags max', () => {
    const text = Array(20)
      .fill(
        'rockstar ninja guru native speaker 10+ jaar ervaring synergy out of the box'
      )
      .join(' ');
    const flags = detectBiasFlags(text);
    expect(flags.length).toBeLessThanOrEqual(10);
  });

  it('does not duplicate flags for the same phrase', () => {
    const flags = detectBiasFlags('rockstar rockstar rockstar developer');
    const rockstars = flags.filter((f) => f.text.toLowerCase().includes('rockstar'));
    expect(rockstars.length).toBeLessThanOrEqual(1);
  });
});

describe('computeClarityScore', () => {
  it('rewards short clear sentences', () => {
    const score = computeClarityScore(
      'Je bouwt features. Je werkt in een team. Je deelt kennis.'
    );
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('penalises long winding sentences', () => {
    const score = computeClarityScore(
      'In deze rol ben je verantwoordelijk voor het ontwerpen, bouwen, testen, implementeren, monitoren en onderhouden van een breed scala aan complexe softwareoplossingen die zowel intern als extern gebruikt worden door diverse stakeholders binnen en buiten de organisatie.'
    );
    expect(score).toBeLessThan(60);
  });

  it('penalises passive voice', () => {
    const passive = computeClarityScore(
      'Het werk wordt gedaan. De code wordt geschreven. De features worden opgeleverd.'
    );
    const active = computeClarityScore(
      'Je doet het werk. Je schrijft code. Je levert features.'
    );
    expect(active).toBeGreaterThan(passive);
  });

  it('returns a sane default for empty/header-only text', () => {
    const score = computeClarityScore('## Header\n\n## Another Header');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('computeInclusivityScore', () => {
  it('returns 100 for zero flags', () => {
    expect(computeInclusivityScore([])).toBe(100);
  });

  it('decreases with each flag, floors at 30', () => {
    const score3 = computeInclusivityScore(
      Array(3).fill({ type: 'gendered_language', text: 'x', suggestion: 'y' })
    );
    expect(score3).toBe(70);

    const score10 = computeInclusivityScore(
      Array(10).fill({ type: 'gendered_language', text: 'x', suggestion: 'y' })
    );
    expect(score10).toBe(30);
  });
});

describe('generateJd (mock-mode)', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns the requested number of variants', async () => {
    const result = await generateJd({
      role: 'Senior Frontend Developer',
      level: 'senior',
      generate_variants: 3,
    });
    expect(result.mocked).toBe(true);
    expect(result.variants).toHaveLength(3);
  });

  it('clamps variants to 1..5', async () => {
    const max = await generateJd({ role: 'X', generate_variants: 99 });
    expect(max.variants.length).toBeLessThanOrEqual(5);

    const min = await generateJd({ role: 'X', generate_variants: 0 });
    expect(min.variants.length).toBeGreaterThanOrEqual(1);
  });

  it('each variant has all required fields', async () => {
    const result = await generateJd({
      role: 'Backend Developer',
      key_skills: ['Node.js', 'PostgreSQL'],
      generate_variants: 2,
    });

    for (const v of result.variants) {
      expect(typeof v.id).toBe('string');
      expect(v.id.length).toBeGreaterThan(0);
      expect(typeof v.title).toBe('string');
      expect(v.title.length).toBeGreaterThan(0);
      expect(typeof v.description).toBe('string');
      expect(v.description.length).toBeGreaterThan(20);
      expect(Array.isArray(v.bias_flags)).toBe(true);
      expect(typeof v.clarity_score).toBe('number');
      expect(v.clarity_score).toBeGreaterThanOrEqual(0);
      expect(v.clarity_score).toBeLessThanOrEqual(100);
      expect(typeof v.inclusivity_score).toBe('number');
      expect(v.inclusivity_score).toBeGreaterThanOrEqual(30);
      expect(v.inclusivity_score).toBeLessThanOrEqual(100);
      expect(typeof v.word_count).toBe('number');
      expect(v.word_count).toBeGreaterThan(0);
    }
  });

  it('produces unique variant IDs', async () => {
    const result = await generateJd({
      role: 'Engineer',
      generate_variants: 4,
    });
    const ids = result.variants.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('embeds requested skills in mock variants', async () => {
    const result = await generateJd({
      role: 'Data Engineer',
      key_skills: ['Apache Spark', 'Snowflake'],
      generate_variants: 1,
    });
    const text = result.variants[0].description.toLowerCase();
    expect(text.includes('apache spark') || text.includes('snowflake')).toBe(true);
  });

  it('records latency and mocked-flag in _meta', async () => {
    const result = await generateJd({ role: 'Designer', generate_variants: 1 });
    expect(result._meta.mocked).toBe(true);
    expect(result._meta.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result._meta.model).toBe('string');
  });
});

describe('generateSingleJdVariant', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns exactly 1 scored variant', async () => {
    const result = await generateSingleJdVariant({ role: 'PM', generate_variants: 5 });
    expect(result.variant).toBeDefined();
    expect(result.variant.id).toBeTruthy();
    expect(result.mocked).toBe(true);
  });
});

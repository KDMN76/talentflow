import { describe, it, expect } from 'vitest';
import {
  formatVectorLiteral,
  buildCandidateEmbeddingText,
  buildJobEmbeddingText,
  generateEmbedding,
  EMBEDDING_DIMS,
} from '../../src/lib/embeddings';

describe('formatVectorLiteral', () => {
  it('formats a basic float array as pgvector text literal', () => {
    expect(formatVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
  });

  it('clamps NaN and Infinity to 0 (pgvector rejects these)', () => {
    const out = formatVectorLiteral([1, NaN, Infinity, -Infinity, 2]);
    expect(out).toBe('[1,0,0,0,2]');
  });

  it('returns [] for an empty array', () => {
    expect(formatVectorLiteral([])).toBe('[]');
  });
});

describe('buildCandidateEmbeddingText', () => {
  it('includes name, position, skills, summary and description', () => {
    const text = buildCandidateEmbeddingText({
      first_name: 'Sofia',
      last_name: 'Vermeer',
      current_position: 'Senior Engineer',
      current_company: 'KDMN',
      skills: ['TypeScript', 'PostgreSQL'],
      ai_summary: 'Strong backend engineer with cloud experience.',
      description: 'Built recruitment platform.',
    });

    expect(text).toMatch(/Name: Sofia Vermeer/);
    expect(text).toMatch(/Current Position: Senior Engineer/);
    expect(text).toMatch(/Current Company: KDMN/);
    expect(text).toMatch(/Skills: TypeScript, PostgreSQL/);
    expect(text).toMatch(/AI Summary: Strong backend engineer/);
    expect(text).toMatch(/Description: Built recruitment platform\./);
  });

  it('falls back to `name` when first/last absent', () => {
    const text = buildCandidateEmbeddingText({ name: 'Alice' });
    expect(text).toMatch(/Name: Alice/);
  });

  it('skips null/empty fields silently', () => {
    const text = buildCandidateEmbeddingText({
      first_name: 'Bob',
      last_name: null,
      skills: [],
      description: '',
      current_company: null,
    });
    expect(text).toMatch(/Name: Bob/);
    expect(text).not.toMatch(/Skills:/);
    expect(text).not.toMatch(/Description:/);
    expect(text).not.toMatch(/Current Company:/);
  });

  it('combines city and country into a single Location line', () => {
    const text = buildCandidateEmbeddingText({
      first_name: 'X',
      address_city: 'Amsterdam',
      address_country: 'Netherlands',
    });
    expect(text).toMatch(/Location: Amsterdam, Netherlands/);
  });
});

describe('buildJobEmbeddingText', () => {
  it('includes title, description, required_skills and metadata', () => {
    const text = buildJobEmbeddingText({
      title: 'Senior Backend Engineer',
      description: 'Build scalable APIs.',
      required_skills: ['Node.js', 'PostgreSQL'],
      nice_to_have_skills: ['Kubernetes'],
      department: 'Engineering',
      location: 'Amsterdam',
      employment_type: 'fulltime',
    });
    expect(text).toMatch(/Title: Senior Backend Engineer/);
    expect(text).toMatch(/Required Skills: Node\.js, PostgreSQL/);
    expect(text).toMatch(/Nice-to-have Skills: Kubernetes/);
    expect(text).toMatch(/Description: Build scalable APIs\./);
    expect(text).toMatch(/Department: Engineering/);
  });

  it('returns empty string when all fields absent', () => {
    expect(buildJobEmbeddingText({})).toBe('');
  });
});

describe('generateEmbedding (mock-mode)', () => {
  it('returns a deterministic 1536-vector for the same input', async () => {
    const a = await generateEmbedding('senior backend engineer');
    const b = await generateEmbedding('senior backend engineer');
    expect(a.embedding).toHaveLength(EMBEDDING_DIMS);
    expect(b.embedding).toHaveLength(EMBEDDING_DIMS);
    expect(a.embedding).toEqual(b.embedding);
    expect(a.mocked).toBe(true);
    expect(a.model).toMatch(/mock/);
  });

  it('produces different vectors for different inputs', async () => {
    const a = await generateEmbedding('typescript developer');
    const b = await generateEmbedding('product manager');
    expect(a.embedding).not.toEqual(b.embedding);
  });

  it('produces an L2-normalised vector (||v|| ≈ 1)', async () => {
    const { embedding } = await generateEmbedding('any text here');
    let sumSq = 0;
    for (const x of embedding) sumSq += x * x;
    expect(Math.sqrt(sumSq)).toBeCloseTo(1, 4);
  });

  it('throws on empty input', async () => {
    await expect(generateEmbedding('')).rejects.toThrow(/Lege input/);
    await expect(generateEmbedding('   ')).rejects.toThrow(/Lege input/);
  });
});

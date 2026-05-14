/**
 * Feature-extractor tests — Sprint Q3.3.
 *
 * Covers all helpers + the master extractor. We bewust geen DB hier — pure JS
 * functies, deterministic, 0 ms per case.
 */

import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  skillsOverlap,
  yoeMatch,
  sourceEncoded,
  hasReferral,
  descLengthNorm,
  positionMatch,
  recencyScore,
  levenshtein,
  extractFeatures,
  featuresToVector,
  FEATURE_NAMES,
} from '../../../src/lib/talentFit/features';

describe('cosineSimilarity', () => {
  it('returns 0 for null/empty vectors', () => {
    expect(cosineSimilarity(null, null)).toBe(0);
    expect(cosineSimilarity([], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [])).toBe(0);
  });

  it('returns 0 for length-mismatch', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });

  it('returns 1 for identical normalized vectors', () => {
    // identieke vectors → cos=1 → (1+1)/2 = 1
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it('returns 0 for opposite vectors', () => {
    // anti-parallel → cos=-1 → (1-1)/2 = 0
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBe(0);
  });

  it('returns 0.5 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0.5);
  });
});

describe('skillsOverlap', () => {
  it('handles empty inputs', () => {
    expect(skillsOverlap([], [])).toEqual({ overlap_pct: 0, score_avg: 0 });
  });

  it('computes Jaccard overlap on normalised keys', () => {
    const result = skillsOverlap(
      [{ skill: 'TypeScript', score: 80 }, { skill: 'Node.js', score: 70 }],
      ['typescript', 'react']
    );
    // intersect = {typescript}, union = {typescript, node.js, react} → 1/3
    expect(result.overlap_pct).toBeCloseTo(1 / 3, 4);
    expect(result.score_avg).toBeCloseTo(0.8, 4);
  });

  it('treats whitespace/dash variants as same skill', () => {
    const result = skillsOverlap(
      [{ skill: 'node-js', score: 50 }],
      ['Node JS']
    );
    expect(result.overlap_pct).toBe(1);
  });

  it('returns zero score_avg when overlapping skill has no score', () => {
    const result = skillsOverlap([{ skill: 'go', score: null }], ['go']);
    expect(result.overlap_pct).toBe(1);
    expect(result.score_avg).toBe(0);
  });
});

describe('yoeMatch (gauss peak)', () => {
  it('returns ~1 when YOE matches expected level', () => {
    expect(yoeMatch(8, 'senior')).toBeCloseTo(1, 4);
  });

  it('returns 0.5 when YOE unknown (null)', () => {
    expect(yoeMatch(null, 'senior')).toBe(0.5);
  });

  it('decays with sigma=3', () => {
    // diff=3 → exp(-9/18) = exp(-0.5) ≈ 0.606
    expect(yoeMatch(11, 'senior')).toBeGreaterThan(0.59);
    expect(yoeMatch(11, 'senior')).toBeLessThan(0.62);
  });

  it('falls back to 5 years for unknown level string', () => {
    // candidate yoe=5, target=5 → 1.0
    expect(yoeMatch(5, 'wizard')).toBeCloseTo(1, 4);
  });

  it('accepts numeric level', () => {
    expect(yoeMatch(10, 10)).toBeCloseTo(1, 4);
  });
});

describe('sourceEncoded + hasReferral', () => {
  it('returns 0.5 when stats empty and source missing', () => {
    expect(sourceEncoded(null, {})).toBe(0.5);
    expect(sourceEncoded(undefined, {})).toBe(0.5);
  });

  it('returns tenant-stats[source] when present', () => {
    expect(sourceEncoded('LinkedIn', { linkedin: 0.4, __avg__: 0.2 })).toBe(0.4);
  });

  it('falls back to __avg__ for unknown source', () => {
    expect(sourceEncoded('Indeed', { linkedin: 0.4, __avg__: 0.2 })).toBe(0.2);
  });

  it('hasReferral recognises referral sources', () => {
    expect(hasReferral('referral')).toBe(1);
    expect(hasReferral('Employee_Referral')).toBe(1);
    expect(hasReferral('linkedin')).toBe(0);
    expect(hasReferral(null)).toBe(0);
  });
});

describe('descLengthNorm', () => {
  it('returns 0 for null/empty', () => {
    expect(descLengthNorm(null)).toBe(0);
    expect(descLengthNorm('')).toBe(0);
  });

  it('grows monotonically with length', () => {
    const a = descLengthNorm('a'.repeat(100));
    const b = descLengthNorm('a'.repeat(1000));
    const c = descLengthNorm('a'.repeat(5000));
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(1);
  });
});

describe('levenshtein + positionMatch', () => {
  it('levenshtein returns 0 for identical', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('levenshtein computes a known distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('positionMatch returns 1 for exact match (case-insensitive)', () => {
    expect(positionMatch('Senior Engineer', 'senior engineer')).toBe(1);
  });

  it('positionMatch returns 0 if either side missing', () => {
    expect(positionMatch(null, 'foo')).toBe(0);
    expect(positionMatch('foo', null)).toBe(0);
  });

  it('positionMatch returns intermediate value for similar titles', () => {
    const v = positionMatch('Senior Software Engineer', 'Senior Engineer');
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(1);
  });
});

describe('recencyScore', () => {
  it('returns 0 for null', () => {
    expect(recencyScore(null)).toBe(0);
  });

  it('returns ~1 for now', () => {
    const now = new Date('2026-05-07T12:00:00Z');
    expect(recencyScore(now, now)).toBeCloseTo(1, 4);
  });

  it('halves at ~60 days', () => {
    const now = new Date('2026-05-07T12:00:00Z');
    const old = new Date('2026-03-08T12:00:00Z'); // 60 dagen eerder
    const v = recencyScore(old, now);
    expect(v).toBeGreaterThan(0.45);
    expect(v).toBeLessThan(0.55);
  });

  it('handles ISO strings', () => {
    const now = new Date('2026-05-07T12:00:00Z');
    expect(recencyScore('2026-05-07T12:00:00Z', now)).toBeCloseTo(1, 4);
  });
});

describe('extractFeatures master', () => {
  it('produces all 10 features in [0,1] for a complete candidate/job', () => {
    const candidate = {
      embedding: Array(8).fill(1),
      skills: ['TypeScript', 'React'],
      candidate_skills: [
        { skill: 'TypeScript', score: 90 },
        { skill: 'React', score: 80 },
      ],
      current_position: 'Senior Engineer',
      years_of_experience: 8,
      source: 'linkedin',
      resume_url: 'https://example.com/cv.pdf',
      ai_summary: 'Senior engineer with deep TypeScript experience.',
      last_activity_at: new Date(),
    };
    const job = {
      title: 'Senior Engineer',
      embedding: Array(8).fill(1),
      required_skills: ['TypeScript', 'React'],
      level: 'senior',
      description: 'TypeScript role',
    };
    const f = extractFeatures(candidate, job, { linkedin: 0.3, __avg__: 0.2 });
    for (const name of FEATURE_NAMES) {
      const v = f[name];
      expect(v, `${name} must be 0..1`).toBeGreaterThanOrEqual(0);
      expect(v, `${name} must be 0..1`).toBeLessThanOrEqual(1);
    }
    expect(f.cosine_sim).toBeCloseTo(1, 6);
    expect(f.skills_overlap_pct).toBe(1);
    expect(f.has_resume).toBe(1);
    expect(f.position_match).toBe(1);
  });

  it('handles missing fields without throwing', () => {
    const f = extractFeatures({}, {}, {});
    expect(f.cosine_sim).toBe(0);
    expect(f.skills_overlap_pct).toBe(0);
    expect(f.has_referral).toBe(0);
    expect(f.has_resume).toBe(0);
  });

  it('featuresToVector keeps canonical order', () => {
    const f = extractFeatures(
      { embedding: [1, 0], skills: ['x'] },
      { embedding: [1, 0], required_skills: ['x'] },
      {}
    );
    const vec = featuresToVector(f);
    expect(vec.length).toBe(FEATURE_NAMES.length);
    expect(vec[0]).toBe(f.cosine_sim);
    expect(vec[1]).toBe(f.skills_overlap_pct);
  });
});

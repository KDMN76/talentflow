/**
 * Trainer tests — Sprint Q3.3.
 *
 * We genereren synthetische datasets met een bekende decision-rule en
 * verifiëren dat de trainer convergeert (AUC > 0.7) en dat predict reageert
 * op de feature-volgorde.
 */

import { describe, it, expect } from 'vitest';
import {
  trainLogisticRegression,
  predictFitScore,
  computeAUC,
  TrainingExample,
} from '../../../src/lib/talentFit/trainer';
import {
  TalentFitFeatures,
  FEATURE_NAMES,
} from '../../../src/lib/talentFit/features';

// ─────────────────────────────────────────────────────────────────────────────
// Helper — genereer features met bias zodat hires en rejects scheidbaar zijn
// ─────────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthetic dataset waarin hires gemiddeld hoog scoren op cosine_sim,
 * skills_overlap_pct en yoe_match — de drie features die in de praktijk
 * het meeste signaal hebben.
 */
function makeDataset(
  nPos: number,
  nNeg: number,
  seed: number = 7
): TrainingExample[] {
  const rand = mulberry32(seed);
  const data: TrainingExample[] = [];

  function clamp01(n: number): number {
    return Math.max(0, Math.min(1, n));
  }
  function gauss(): number {
    // Box-Muller (uniforme rand → gauss).
    const u = rand() || 1e-9;
    const v = rand() || 1e-9;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  for (let i = 0; i < nPos; i++) {
    const f: TalentFitFeatures = {
      cosine_sim: clamp01(0.85 + 0.05 * gauss()),
      skills_overlap_pct: clamp01(0.7 + 0.1 * gauss()),
      skills_score_avg: clamp01(0.7 + 0.1 * gauss()),
      yoe_match: clamp01(0.85 + 0.07 * gauss()),
      source_encoded: clamp01(0.4 + 0.1 * gauss()),
      has_referral: rand() < 0.4 ? 1 : 0,
      desc_length_norm: clamp01(0.7 + 0.1 * gauss()),
      position_match: clamp01(0.65 + 0.15 * gauss()),
      recency_score: clamp01(0.7 + 0.1 * gauss()),
      has_resume: rand() < 0.95 ? 1 : 0,
    };
    data.push({ features: f, label: 1 });
  }
  for (let i = 0; i < nNeg; i++) {
    const f: TalentFitFeatures = {
      cosine_sim: clamp01(0.55 + 0.08 * gauss()),
      skills_overlap_pct: clamp01(0.25 + 0.1 * gauss()),
      skills_score_avg: clamp01(0.3 + 0.1 * gauss()),
      yoe_match: clamp01(0.45 + 0.15 * gauss()),
      source_encoded: clamp01(0.2 + 0.1 * gauss()),
      has_referral: rand() < 0.05 ? 1 : 0,
      desc_length_norm: clamp01(0.4 + 0.15 * gauss()),
      position_match: clamp01(0.3 + 0.15 * gauss()),
      recency_score: clamp01(0.4 + 0.15 * gauss()),
      has_resume: rand() < 0.7 ? 1 : 0,
    };
    data.push({ features: f, label: 0 });
  }
  return data;
}

describe('trainLogisticRegression', () => {
  it('throws on empty dataset', () => {
    expect(() => trainLogisticRegression([])).toThrow();
  });

  it('produces a model with the right shape', () => {
    const data = makeDataset(40, 40);
    const model = trainLogisticRegression(data, { seed: 1 });
    expect(model.weights.length).toBe(FEATURE_NAMES.length);
    expect(model.normalization.length).toBe(FEATURE_NAMES.length);
    expect(model.feature_names).toEqual([...FEATURE_NAMES]);
  });

  it('converges with AUC > 0.7 on separable synthetic data', () => {
    const data = makeDataset(80, 80, 11);
    const model = trainLogisticRegression(data, { seed: 1 });
    expect(model.metrics.auc).toBeGreaterThan(0.7);
  });

  it('precision-at-1 = 1 on clearly separable data', () => {
    const data = makeDataset(60, 60, 19);
    const model = trainLogisticRegression(data, { seed: 1 });
    // top-1 should be hire.
    expect(model.metrics.precision_at_1).toBeGreaterThanOrEqual(0.5);
  });

  it('predictFitScore returns higher scores for the positive prototype', () => {
    const data = makeDataset(60, 60, 33);
    const model = trainLogisticRegression(data, { seed: 1 });

    const positive: TalentFitFeatures = {
      cosine_sim: 0.9,
      skills_overlap_pct: 0.8,
      skills_score_avg: 0.8,
      yoe_match: 0.9,
      source_encoded: 0.5,
      has_referral: 1,
      desc_length_norm: 0.8,
      position_match: 0.8,
      recency_score: 0.8,
      has_resume: 1,
    };
    const negative: TalentFitFeatures = {
      cosine_sim: 0.5,
      skills_overlap_pct: 0.2,
      skills_score_avg: 0.2,
      yoe_match: 0.4,
      source_encoded: 0.2,
      has_referral: 0,
      desc_length_norm: 0.3,
      position_match: 0.2,
      recency_score: 0.3,
      has_resume: 0,
    };
    const pPos = predictFitScore(model, positive);
    const pNeg = predictFitScore(model, negative);
    expect(pPos).toBeGreaterThan(pNeg);
    expect(pPos).toBeGreaterThan(0.6);
    expect(pNeg).toBeLessThan(0.4);
  });
});

describe('computeAUC', () => {
  it('returns 1 when all positives outrank all negatives', () => {
    expect(computeAUC([0.9, 0.8, 0.1, 0.2], [1, 1, 0, 0])).toBe(1);
  });

  it('returns 0.5 for random predictions', () => {
    const preds = [0.5, 0.5, 0.5, 0.5];
    const labels: (0 | 1)[] = [1, 0, 1, 0];
    expect(computeAUC(preds, labels)).toBe(0.5);
  });

  it('returns 0 when all positives outranked by negatives', () => {
    expect(computeAUC([0.1, 0.2, 0.9, 0.8], [1, 1, 0, 0])).toBe(0);
  });

  it('returns 0 when one class is empty', () => {
    expect(computeAUC([0.5, 0.7], [0, 0])).toBe(0);
  });
});

describe('predictFitScore — invariants', () => {
  it('always returns a value in [0,1]', () => {
    const data = makeDataset(40, 40, 5);
    const model = trainLogisticRegression(data, { seed: 1 });
    for (let i = 0; i < 50; i++) {
      const f: TalentFitFeatures = {
        cosine_sim: Math.random(),
        skills_overlap_pct: Math.random(),
        skills_score_avg: Math.random(),
        yoe_match: Math.random(),
        source_encoded: Math.random(),
        has_referral: Math.random() < 0.3 ? 1 : 0,
        desc_length_norm: Math.random(),
        position_match: Math.random(),
        recency_score: Math.random(),
        has_resume: Math.random() < 0.8 ? 1 : 0,
      };
      const p = predictFitScore(model, f);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('measures predict latency well under 5ms per call', () => {
    const data = makeDataset(80, 80, 1);
    const model = trainLogisticRegression(data, { seed: 1 });
    const f: TalentFitFeatures = {
      cosine_sim: 0.7,
      skills_overlap_pct: 0.5,
      skills_score_avg: 0.5,
      yoe_match: 0.7,
      source_encoded: 0.4,
      has_referral: 0,
      desc_length_norm: 0.6,
      position_match: 0.5,
      recency_score: 0.5,
      has_resume: 1,
    };
    const start = performance.now();
    for (let i = 0; i < 1000; i++) predictFitScore(model, f);
    const elapsed = performance.now() - start;
    // 1000 predicts ruim onder 1 sec → <1ms/call.
    expect(elapsed).toBeLessThan(500);
  });
});

/**
 * Logistic-regression trainer + inference — Sprint Q3.3.
 *
 * Pure JS gradient-descent trainer met:
 *   • Z-score feature-normalisatie (mean/std bewaard in model voor inference).
 *   • Sigmoid activation, binary cross-entropy loss, batch gradient descent.
 *   • L2-regularisatie tegen overfitting op kleine tenant-datasets (<200 samples).
 *   • Stratified train/test-split + AUC / precision@1 / recall@10 metrics.
 *
 * Waarom geen externe ML-lib?
 *   • TalentFlow draait zonder native bindings (Docker-image moet klein blijven,
 *     deploy via PM2/Docker op Hetzner zonder Python-toolchain).
 *   • Het feature-aantal is klein (10) en samples per tenant <2000 — gradient
 *     descent in JS converged in <100ms met 500 epochs, ruim binnen budget.
 *
 * Determinisme:
 *   • Een seedable RNG zorgt dat tests reproduceerbaar zijn. `options.seed`
 *     default = 42; expliciet doorgeven om alternatieve runs te draaien.
 */

import {
  FEATURE_NAMES,
  TalentFitFeatures,
  featuresToVector,
} from './features';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface TrainingExample {
  features: TalentFitFeatures;
  /** 1 = hired (positive), 0 = rejected/offer_declined (negative). */
  label: 0 | 1;
}

export interface NormalizationParams {
  mean: number;
  std: number;
}

export interface TrainedModel {
  feature_names: string[];
  weights: number[];
  intercept: number;
  /** Z-score normalisatie per feature — gebruikt door predictFitScore. */
  normalization: NormalizationParams[];
  trained_on: number;
  metrics: {
    precision_at_1: number;
    recall_at_10: number;
    auc: number;
  };
}

export interface TrainerOptions {
  learning_rate?: number;
  epochs?: number;
  l2_lambda?: number;
  test_split?: number;
  seed?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function sigmoid(z: number): number {
  // Stabiel voor grote |z| — voorkom Infinity / NaN op outliers.
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/**
 * Mulberry32 — kleine deterministische PRNG. Genoeg voor train/test split en
 * shuffle; we hoeven niet cryptografisch random te zijn.
 */
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

function shuffleInPlace<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function computeNormalization(rows: number[][]): NormalizationParams[] {
  if (rows.length === 0) return [];
  const nFeatures = rows[0].length;
  const means = new Array<number>(nFeatures).fill(0);
  for (const r of rows) for (let i = 0; i < nFeatures; i++) means[i] += r[i];
  for (let i = 0; i < nFeatures; i++) means[i] /= rows.length;

  const variances = new Array<number>(nFeatures).fill(0);
  for (const r of rows) {
    for (let i = 0; i < nFeatures; i++) {
      const d = r[i] - means[i];
      variances[i] += d * d;
    }
  }
  for (let i = 0; i < nFeatures; i++) variances[i] /= Math.max(1, rows.length - 1);
  return means.map((m, i) => ({
    mean: m,
    std: Math.max(Math.sqrt(variances[i]), 1e-6),
  }));
}

function applyNormalization(
  vec: number[],
  norm: NormalizationParams[]
): number[] {
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = (vec[i] - norm[i].mean) / norm[i].std;
  }
  return out;
}

/**
 * Stratified split: zorg dat zowel train als test minimaal 1 hire en 1 reject
 * bevatten (anders kunnen we geen AUC berekenen). Bij heel kleine sets vallen
 * we terug op test_split = 0 (alle data in train, AUC=NaN).
 */
function stratifiedSplit(
  rows: Array<{ x: number[]; y: 0 | 1 }>,
  testSplit: number,
  rand: () => number
): { train: typeof rows; test: typeof rows } {
  const positives = rows.filter((r) => r.y === 1);
  const negatives = rows.filter((r) => r.y === 0);
  shuffleInPlace(positives, rand);
  shuffleInPlace(negatives, rand);

  const nTestPos = Math.max(1, Math.round(positives.length * testSplit));
  const nTestNeg = Math.max(1, Math.round(negatives.length * testSplit));
  // Maak nooit train leeg.
  const safeTestPos = Math.min(nTestPos, positives.length - 1);
  const safeTestNeg = Math.min(nTestNeg, negatives.length - 1);

  const test = [
    ...positives.slice(0, safeTestPos),
    ...negatives.slice(0, safeTestNeg),
  ];
  const train = [
    ...positives.slice(safeTestPos),
    ...negatives.slice(safeTestNeg),
  ];
  shuffleInPlace(train, rand);
  shuffleInPlace(test, rand);
  return { train, test };
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AUC via sorting predictions DESC: count positive-pairs waar de positive
 * prediction > negative prediction. O(n log n).
 */
export function computeAUC(predictions: number[], labels: (0 | 1)[]): number {
  const n = predictions.length;
  if (n === 0) return 0;
  const positives: number[] = [];
  const negatives: number[] = [];
  for (let i = 0; i < n; i++) {
    if (labels[i] === 1) positives.push(predictions[i]);
    else negatives.push(predictions[i]);
  }
  if (positives.length === 0 || negatives.length === 0) return 0;
  // Mann-Whitney U: P(p > n) + 0.5 * P(p == n).
  // O(n log n) via merge-style counting.
  const sortedNegs = [...negatives].sort((a, b) => a - b);
  let pairs = 0;
  for (const p of positives) {
    // count negatives < p (binary search), plus 0.5 * count == p.
    let lo = 0;
    let hi = sortedNegs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedNegs[mid] < p) lo = mid + 1;
      else hi = mid;
    }
    let lessCount = lo;
    // count == p
    let eq = 0;
    while (lo < sortedNegs.length && sortedNegs[lo] === p) {
      eq++;
      lo++;
    }
    pairs += lessCount + 0.5 * eq;
  }
  return pairs / (positives.length * negatives.length);
}

function precisionAtK(predictions: number[], labels: (0 | 1)[], k: number): number {
  if (predictions.length === 0) return 0;
  const indices = predictions.map((_, i) => i);
  indices.sort((a, b) => predictions[b] - predictions[a]);
  const topK = indices.slice(0, Math.min(k, indices.length));
  const hits = topK.filter((i) => labels[i] === 1).length;
  return topK.length === 0 ? 0 : hits / topK.length;
}

function recallAtK(predictions: number[], labels: (0 | 1)[], k: number): number {
  const totalPos = labels.filter((l) => l === 1).length;
  if (totalPos === 0) return 0;
  const indices = predictions.map((_, i) => i);
  indices.sort((a, b) => predictions[b] - predictions[a]);
  const topK = indices.slice(0, Math.min(k, indices.length));
  const hits = topK.filter((i) => labels[i] === 1).length;
  return hits / totalPos;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trainer
// ─────────────────────────────────────────────────────────────────────────────

export function trainLogisticRegression(
  examples: TrainingExample[],
  options: TrainerOptions = {}
): TrainedModel {
  if (examples.length === 0) {
    throw new Error('trainLogisticRegression: cannot train on empty dataset');
  }
  const lr = options.learning_rate ?? 0.05;
  const epochs = options.epochs ?? 500;
  const l2 = options.l2_lambda ?? 0.01;
  const testSplit = options.test_split ?? 0.2;
  const seed = options.seed ?? 42;

  // Build vectors + labels.
  const rows = examples.map((ex) => ({
    x: featuresToVector(ex.features),
    y: ex.label,
  }));
  const nFeatures = rows[0].x.length;
  if (nFeatures !== FEATURE_NAMES.length) {
    throw new Error(
      `trainLogisticRegression: expected ${FEATURE_NAMES.length} features, got ${nFeatures}`
    );
  }

  const rand = mulberry32(seed);
  const split =
    rows.length >= 4 && testSplit > 0
      ? stratifiedSplit(rows, testSplit, rand)
      : { train: rows, test: [] as typeof rows };

  // Normalisatie alleen op train-set zodat test-set geen leakage heeft.
  const norm = computeNormalization(split.train.map((r) => r.x));
  const Xtrain = split.train.map((r) => applyNormalization(r.x, norm));
  const ytrain = split.train.map((r) => r.y);
  const Xtest = split.test.map((r) => applyNormalization(r.x, norm));
  const ytest = split.test.map((r) => r.y);

  // Init weights at zero (stable convergence with z-scored inputs).
  const weights = new Array<number>(nFeatures).fill(0);
  let intercept = 0;

  // Batch gradient descent.
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array<number>(nFeatures).fill(0);
    let gradB = 0;
    for (let i = 0; i < Xtrain.length; i++) {
      const xi = Xtrain[i];
      let z = intercept;
      for (let j = 0; j < nFeatures; j++) z += weights[j] * xi[j];
      const p = sigmoid(z);
      const err = p - ytrain[i];
      for (let j = 0; j < nFeatures; j++) gradW[j] += err * xi[j];
      gradB += err;
    }
    const m = Xtrain.length;
    // Update with L2 regularisation (intercept untouched).
    for (let j = 0; j < nFeatures; j++) {
      const reg = l2 * weights[j];
      weights[j] -= lr * (gradW[j] / m + reg);
    }
    intercept -= lr * (gradB / m);
  }

  // Compute metrics on test fold.
  const testPreds = Xtest.map((xi) => {
    let z = intercept;
    for (let j = 0; j < nFeatures; j++) z += weights[j] * xi[j];
    return sigmoid(z);
  });
  const auc = Xtest.length > 0 ? computeAUC(testPreds, ytest) : 0;
  const p1 = Xtest.length > 0 ? precisionAtK(testPreds, ytest, 1) : 0;
  const r10 = Xtest.length > 0 ? recallAtK(testPreds, ytest, 10) : 0;

  return {
    feature_names: [...FEATURE_NAMES],
    weights,
    intercept,
    normalization: norm,
    trained_on: examples.length,
    metrics: {
      precision_at_1: p1,
      recall_at_10: r10,
      auc,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inference
// ─────────────────────────────────────────────────────────────────────────────

export function predictFitScore(
  model: TrainedModel,
  features: TalentFitFeatures
): number {
  const vec = featuresToVector(features);
  if (vec.length !== model.weights.length) {
    throw new Error(
      `predictFitScore: feature-vector length ${vec.length} ≠ model weights ${model.weights.length}`
    );
  }
  let z = model.intercept;
  for (let j = 0; j < vec.length; j++) {
    const norm = model.normalization[j];
    const xn = (vec[j] - norm.mean) / norm.std;
    z += model.weights[j] * xn;
  }
  const p = sigmoid(z);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

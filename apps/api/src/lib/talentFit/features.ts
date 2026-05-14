/**
 * Talent-Fit feature extractor — Sprint Q3.3.
 *
 * Pure JS engineering van de features die de logistic-regression trainer + de
 * inference-stap consumeren. Geen externe ML-libs; alle berekeningen zijn O(n)
 * over kleine inputs (skills/strings/embedding) zodat we honderden predictions
 * per seconde kunnen draaien zonder native bindings.
 *
 * Design-principes:
 *   • Alle features worden geforceerd naar [0..1] of {0,1}. Buiten-bereik
 *     waarden zijn een silent bug-trap voor de trainer (z-score normalisatie
 *     verbergt anders de fout).
 *   • Geen externe DB-calls; caller (talentFit.service) geeft alle benodigde
 *     velden in een platte object door. Reden: de feature-extractor wordt
 *     ook aangeroepen tijdens training (1 row per applicatie) — daar willen
 *     we het in één query bulk-laden i.p.v. N+1.
 *   • Robust tegen ontbrekende velden (null/undefined) — de werkelijkheid
 *     van TalentFlow data is dat niet alle kandidaten compleet zijn.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface TalentFitFeatures {
  /** Cosine-similarity tussen candidate.embedding en job.embedding (0..1). */
  cosine_sim: number;
  /** Skills-overlap percentage: |intersect| / |union| over skill-strings (0..1). */
  skills_overlap_pct: number;
  /** Gemiddelde candidate_skills.score op overlappende skills (0..1, score=0..100 ÷100). */
  skills_score_avg: number;
  /** Years-of-experience match: gauss-piek rondom verwacht level voor de job (0..1). */
  yoe_match: number;
  /** Source-encoding via tenant-specifieke success-rate (0..1). */
  source_encoded: number;
  /** Heeft een referral-source (LinkedIn-referral / employee-referral) — 0/1. */
  has_referral: number;
  /** Description / ai_summary length normalized op een softplus-curve (0..1). */
  desc_length_norm: number;
  /** Position match: 1 - normalized Levenshtein distance over title vs current_position (0..1). */
  position_match: number;
  /** Recency: hoe recent is candidate.last_activity_at (0..1, dichter bij nu = hoger). */
  recency_score: number;
  /** Heeft deze kandidaat een geüploade resume — 0/1. */
  has_resume: number;
}

/** Volgorde van de features in de model-vector. Vast — verandering is een breaking change. */
export const FEATURE_NAMES: ReadonlyArray<keyof TalentFitFeatures> = Object.freeze([
  'cosine_sim',
  'skills_overlap_pct',
  'skills_score_avg',
  'yoe_match',
  'source_encoded',
  'has_referral',
  'desc_length_norm',
  'position_match',
  'recency_score',
  'has_resume',
]);

/**
 * Input-shapes — duck-typed zodat caller zowel een DB-row als een
 * geconstrueerd test-object kan doorgeven.
 */
export interface CandidateInput {
  id?: string;
  embedding?: number[] | null;
  /** array van skill-strings (legacy candidates.skills) */
  skills?: string[] | null;
  /**
   * Verrijkte skills uit candidate_skills: { skill, score 0..100 }.
   * Optioneel — als niet gezet, gebruiken we `skills` met score=null.
   */
  candidate_skills?: Array<{ skill: string; score?: number | null }> | null;
  current_position?: string | null;
  years_of_experience?: number | null;
  source?: string | null;
  description?: string | null;
  ai_summary?: string | null;
  resume_url?: string | null;
  last_activity_at?: Date | string | null;
}

export interface JobInput {
  id?: string;
  title?: string | null;
  embedding?: number[] | null;
  required_skills?: string[] | null;
  /** Verwacht ervarings-level: 'junior' | 'medior' | 'senior' | 'lead' | numeriek (jaren). */
  level?: string | number | null;
  description?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — clamping, normalisatie
// ─────────────────────────────────────────────────────────────────────────────

const REFERRAL_SOURCES = new Set([
  'referral',
  'employee_referral',
  'employee-referral',
  'linkedin_referral',
  'linkedin-referral',
  'internal_referral',
]);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeSkillKey(skill: string): string {
  return skill.trim().toLowerCase().replace(/[\s\-_]+/g, ' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Cosine similarity (pure JS)
// ─────────────────────────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  // Cosine in [-1, 1]; we map naar [0,1] door (1 + cos) / 2 zodat de feature
  // monotoon stijgend is over het volledige bereik. Voor genormaliseerde
  // OpenAI-embeddings ligt de natuurlijke range typisch al [0.5, 1].
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return clamp01((cos + 1) / 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Skills overlap
// ─────────────────────────────────────────────────────────────────────────────

interface SkillsOverlapResult {
  overlap_pct: number;
  score_avg: number;
}

export function skillsOverlap(
  candidateSkills: Array<{ skill: string; score?: number | null }>,
  jobRequiredSkills: string[]
): SkillsOverlapResult {
  if (jobRequiredSkills.length === 0 && candidateSkills.length === 0) {
    return { overlap_pct: 0, score_avg: 0 };
  }
  const candMap = new Map<string, number | null>();
  for (const cs of candidateSkills) {
    if (!cs?.skill) continue;
    const key = normalizeSkillKey(cs.skill);
    if (!key) continue;
    // Score = candidate_skills.score (0..100). Hoogste wint bij duplicates.
    const prev = candMap.get(key) ?? null;
    const next =
      typeof cs.score === 'number' && Number.isFinite(cs.score)
        ? Math.max(prev ?? 0, cs.score)
        : prev;
    candMap.set(key, next);
  }
  const jobSet = new Set<string>();
  for (const s of jobRequiredSkills) {
    if (!s) continue;
    const key = normalizeSkillKey(s);
    if (key) jobSet.add(key);
  }

  const candSet = new Set(candMap.keys());

  // Intersect & union (exact-match op normalised skill key).
  let intersectCount = 0;
  let scoreSum = 0;
  let scoreN = 0;
  for (const key of candSet) {
    if (jobSet.has(key)) {
      intersectCount++;
      const score = candMap.get(key);
      if (typeof score === 'number') {
        scoreSum += score;
        scoreN++;
      }
    }
  }
  const unionCount = new Set([...candSet, ...jobSet]).size;
  const overlapPct = unionCount === 0 ? 0 : intersectCount / unionCount;
  const scoreAvg = scoreN === 0 ? 0 : scoreSum / scoreN / 100; // /100 → 0..1

  return {
    overlap_pct: clamp01(overlapPct),
    score_avg: clamp01(scoreAvg),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Years of experience match — gaussian peak
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_TO_YEARS: Record<string, number> = {
  intern: 0,
  junior: 2,
  medior: 5,
  senior: 8,
  lead: 12,
  principal: 15,
};

export function yoeMatch(
  candidateYoe: number | null | undefined,
  jobLevel: string | number | null | undefined
): number {
  if (candidateYoe === null || candidateYoe === undefined || !Number.isFinite(candidateYoe)) {
    // Onbekend → neutraal-laag (model leert of het belangrijk is via z-score).
    return 0.5;
  }
  let target: number;
  if (typeof jobLevel === 'number' && Number.isFinite(jobLevel)) {
    target = jobLevel;
  } else if (typeof jobLevel === 'string' && jobLevel.length > 0) {
    target = LEVEL_TO_YEARS[jobLevel.trim().toLowerCase()] ?? 5;
  } else {
    target = 5;
  }
  const diff = candidateYoe - target;
  // Gauss met sigma=3 — kandidaat met +/- 3 jaar verschil scoort nog ~0.61.
  // Onbeperkte overshoot in de jonge richting (junior vs senior gap)
  // straffen we hetzelfde als de oude richting (er zijn geen "te ervaren"
  // assumpties hier — die mag het model leren via andere features).
  const sigma = 3;
  const gauss = Math.exp(-(diff * diff) / (2 * sigma * sigma));
  return clamp01(gauss);
}

// ─────────────────────────────────────────────────────────────────────────────
// Source-encoded — tenant-specifieke success rate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `tenantSourceStats[source]` = historische success-rate (hires / (hires+rejects))
 * voor die source in deze tenant. Voor onbekende sources fallbacken we naar de
 * gemiddelde rate over alle sources (== map["__avg__"]) of 0.5.
 */
export function sourceEncoded(
  source: string | null | undefined,
  tenantSourceStats: Record<string, number>
): number {
  if (!source) {
    return clamp01(tenantSourceStats.__avg__ ?? 0.5);
  }
  const key = source.trim().toLowerCase();
  if (key in tenantSourceStats) {
    return clamp01(tenantSourceStats[key]);
  }
  return clamp01(tenantSourceStats.__avg__ ?? 0.5);
}

export function hasReferral(source: string | null | undefined): number {
  if (!source) return 0;
  return REFERRAL_SOURCES.has(source.trim().toLowerCase()) ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Description length normalisation
// ─────────────────────────────────────────────────────────────────────────────

export function descLengthNorm(text: string | null | undefined): number {
  if (!text) return 0;
  const len = text.length;
  // Softplus-achtige curve: 0 → 0, 500 → ~0.40, 2000 → ~0.79, 5000+ → ~0.95.
  // 1500 chars is een redelijke "complete" CV-summary → score 0.7.
  return clamp01(1 - Math.exp(-len / 1500));
}

// ─────────────────────────────────────────────────────────────────────────────
// Position match — Levenshtein-based string-similarity
// ─────────────────────────────────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  // Two-row DP — O(min(a,b)) memory.
  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      // min(insert, delete, substitute)
      const v = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      curr[j] = v;
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

export function positionMatch(
  candidatePosition: string | null | undefined,
  jobTitle: string | null | undefined
): number {
  if (!candidatePosition || !jobTitle) return 0;
  const a = candidatePosition.trim().toLowerCase();
  const b = jobTitle.trim().toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return clamp01(1 - dist / maxLen);
}

// ─────────────────────────────────────────────────────────────────────────────
// Recency
// ─────────────────────────────────────────────────────────────────────────────

export function recencyScore(
  lastActivity: Date | string | null | undefined,
  now: Date = new Date()
): number {
  if (!lastActivity) return 0;
  const d = lastActivity instanceof Date ? lastActivity : new Date(lastActivity);
  const t = d.getTime();
  if (!Number.isFinite(t)) return 0;
  const ageMs = now.getTime() - t;
  if (ageMs <= 0) return 1;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Halflife = 60 dagen. Activiteit van vandaag = 1, 60 dagen oud = 0.5,
  // 120 dagen = 0.25, 1 jaar ≈ 0.015. Gebruik 2^(-age/halflife) zodat de
  // semantiek expliciet halverend is i.p.v. exp-decay met diezelfde tau.
  return clamp01(Math.pow(2, -ageDays / 60));
}

// ─────────────────────────────────────────────────────────────────────────────
// Master extractor
// ─────────────────────────────────────────────────────────────────────────────

export function extractFeatures(
  candidate: CandidateInput,
  job: JobInput,
  tenantSourceStats: Record<string, number> = {}
): TalentFitFeatures {
  const candidateSkills =
    candidate.candidate_skills && candidate.candidate_skills.length > 0
      ? candidate.candidate_skills
      : (candidate.skills ?? []).map((s) => ({ skill: s, score: null }));
  const skills = skillsOverlap(candidateSkills, job.required_skills ?? []);

  // Description = candidate-side rijkheid: bij voorkeur ai_summary, anders description.
  const candDesc = candidate.ai_summary ?? candidate.description ?? null;

  return {
    cosine_sim: cosineSimilarity(candidate.embedding, job.embedding),
    skills_overlap_pct: skills.overlap_pct,
    skills_score_avg: skills.score_avg,
    yoe_match: yoeMatch(candidate.years_of_experience, job.level),
    source_encoded: sourceEncoded(candidate.source, tenantSourceStats),
    has_referral: hasReferral(candidate.source),
    desc_length_norm: descLengthNorm(candDesc),
    position_match: positionMatch(candidate.current_position, job.title),
    recency_score: recencyScore(candidate.last_activity_at),
    has_resume: candidate.resume_url ? 1 : 0,
  };
}

/**
 * Helper: features → vector in de canonieke FEATURE_NAMES-volgorde.
 * Gebruikt door de trainer (gradient descent input) en tijdens inference.
 */
export function featuresToVector(features: TalentFitFeatures): number[] {
  const vec = new Array<number>(FEATURE_NAMES.length);
  for (let i = 0; i < FEATURE_NAMES.length; i++) {
    vec[i] = features[FEATURE_NAMES[i]];
  }
  return vec;
}

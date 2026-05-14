/**
 * Scorecards — interview-evaluatie per (applicatie, stage, interviewer).
 *
 * Eén scorecard per interviewer per (application, stage). Update is een
 * UPSERT op die unieke combinatie. `submitted_at` wordt enkel gezet wanneer
 * de caller expliciet `submit: true` meegeeft — anders blijft het een draft.
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type ScorecardRecommendation =
  | 'strong_yes'
  | 'yes'
  | 'neutral'
  | 'no'
  | 'strong_no';

export interface ScorecardCriterionScore {
  criterion: string;
  score: number;
  comment?: string;
}

export interface Scorecard {
  id: string;
  tenant_id: string;
  application_id: string;
  stage_id: string | null;
  interviewer_id: string;
  overall_score: number | null;
  recommendation: ScorecardRecommendation | null;
  notes: string | null;
  criteria_scores: ScorecardCriterionScore[];
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScorecardInput {
  overall_score?: number;
  recommendation?: ScorecardRecommendation;
  notes?: string;
  criteria_scores?: ScorecardCriterionScore[];
  submit?: boolean;
}

export interface ScorecardCriterionDefinition {
  key: string;
  label: string;
  description?: string;
  weight?: number;
}

export interface ScorecardTemplate {
  id: string;
  tenant_id: string;
  name: string;
  criteria: ScorecardCriterionDefinition[];
  applies_to_job_id: string | null;
  applies_to_stage_id: string | null;
  is_default: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateInput {
  name: string;
  criteria: ScorecardCriterionDefinition[];
  applies_to_job_id?: string | null;
  applies_to_stage_id?: string | null;
  is_default?: boolean;
}

function rowToScorecard(row: Record<string, unknown>): Scorecard {
  return {
    ...(row as unknown as Scorecard),
    criteria_scores: parseJsonArray<ScorecardCriterionScore>(row.criteria_scores),
  };
}

function rowToTemplate(row: Record<string, unknown>): ScorecardTemplate {
  return {
    ...(row as unknown as ScorecardTemplate),
    criteria: parseJsonArray<ScorecardCriterionDefinition>(row.criteria),
  };
}

function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? (p as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ────────────────────────────────────────────────────────────────────────────
// Scorecards
// ────────────────────────────────────────────────────────────────────────────

export async function listScorecardsForApplication(
  tenantId: string,
  applicationId: string
): Promise<Scorecard[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT s.*, u.name AS interviewer_name, u.email AS interviewer_email
       FROM scorecards s
       LEFT JOIN users u ON u.id = s.interviewer_id
       WHERE s.tenant_id = $1 AND s.application_id = $2
       ORDER BY s.created_at DESC`,
      [tenantId, applicationId]
    );
    return rows.map(rowToScorecard);
  });
}

export async function getScorecard(
  tenantId: string,
  scorecardId: string
): Promise<Scorecard> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM scorecards WHERE id = $1 AND tenant_id = $2`,
      [scorecardId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'SCORECARD_NOT_FOUND', 'Scorecard niet gevonden');
    }
    return rowToScorecard(rows[0]);
  });
}

/**
 * Create or update (UPSERT) the scorecard for this interviewer on this stage
 * of this application. The unique-index `uq_scorecards_app_stage_interviewer`
 * makes ON CONFLICT atomic.
 */
export async function createOrUpdateScorecard(
  tenantId: string,
  userId: string,
  applicationId: string,
  stageId: string | null,
  data: CreateScorecardInput,
  ctx: AuditContext = {}
): Promise<Scorecard> {
  if (data.overall_score !== undefined) {
    if (data.overall_score < 1 || data.overall_score > 5) {
      throw new AppError(
        400,
        'INVALID_OVERALL_SCORE',
        'overall_score moet tussen 1.0 en 5.0 liggen'
      );
    }
  }

  return withTenant(tenantId, async (client) => {
    // Verifieer dat de applicatie bestaat in deze tenant — RLS bewaart de
    // boundary, maar een 404-bericht is duidelijker dan stille no-op.
    const { rows: appRows } = await client.query(
      `SELECT id FROM applications WHERE id = $1 AND tenant_id = $2`,
      [applicationId, tenantId]
    );
    if (appRows.length === 0) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Sollicitatie niet gevonden');
    }

    // Default voor draft: criteria_scores=[] en geen submitted_at; submit-flag
    // promoot tot 'submitted'. Gebruiken now() zodat audit + UI dezelfde tijd zien.
    const submittedAt = data.submit ? new Date() : null;

    const { rows } = await client.query(
      `INSERT INTO scorecards
         (tenant_id, application_id, stage_id, interviewer_id,
          overall_score, recommendation, notes, criteria_scores, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (application_id, stage_id, interviewer_id)
       DO UPDATE SET
         overall_score   = EXCLUDED.overall_score,
         recommendation  = EXCLUDED.recommendation,
         notes           = EXCLUDED.notes,
         criteria_scores = EXCLUDED.criteria_scores,
         submitted_at    = COALESCE(EXCLUDED.submitted_at, scorecards.submitted_at),
         updated_at      = now()
       RETURNING *`,
      [
        tenantId,
        applicationId,
        stageId,
        userId,
        data.overall_score ?? null,
        data.recommendation ?? null,
        data.notes ?? null,
        JSON.stringify(data.criteria_scores ?? []),
        submittedAt,
      ]
    );

    const card = rowToScorecard(rows[0]);

    if (submittedAt) {
      await logAudit(
        client,
        tenantId,
        {
          action: AuditActions.SCORECARD_SUBMITTED,
          entityType: 'scorecard',
          entityId: card.id,
          after: {
            application_id: applicationId,
            stage_id: stageId,
            recommendation: card.recommendation,
            overall_score: card.overall_score,
          },
          userId,
        },
        ctx
      );
    }

    return card;
  });
}

export async function deleteScorecard(
  tenantId: string,
  scorecardId: string,
  userId: string,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `DELETE FROM scorecards WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [scorecardId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'SCORECARD_NOT_FOUND', 'Scorecard niet gevonden');
    }
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.SCORECARD_DELETED,
        entityType: 'scorecard',
        entityId: scorecardId,
        before: rows[0],
        userId,
      },
      ctx
    );
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Templates
// ────────────────────────────────────────────────────────────────────────────

export async function listTemplates(
  tenantId: string,
  jobId?: string,
  stageId?: string
): Promise<ScorecardTemplate[]> {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId];
    let where = `tenant_id = $1 AND deleted_at IS NULL`;
    if (jobId) {
      params.push(jobId);
      where += ` AND (applies_to_job_id = $${params.length} OR applies_to_job_id IS NULL)`;
    }
    if (stageId) {
      params.push(stageId);
      where += ` AND (applies_to_stage_id = $${params.length} OR applies_to_stage_id IS NULL)`;
    }
    const { rows } = await client.query(
      `SELECT * FROM scorecard_templates
       WHERE ${where}
       ORDER BY is_default DESC, name ASC`,
      params
    );
    return rows.map(rowToTemplate);
  });
}

export async function getTemplate(
  tenantId: string,
  id: string
): Promise<ScorecardTemplate> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM scorecard_templates
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'SCORECARD_TEMPLATE_NOT_FOUND', 'Template niet gevonden');
    }
    return rowToTemplate(rows[0]);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Agreement matrix — Sprint Q3.4
// ────────────────────────────────────────────────────────────────────────────
//
// Voor een applicatie de inter-rater agreement berekenen tussen alle
// interviewers die een scorecard hebben ingediend. Per criterium het
// gemiddelde + std-dev, per interviewer een mean-score, en outlier-detectie.
//
// Outlier-rule: een interviewer is outlier wanneer zijn/haar gemiddelde
// absolute afwijking tot het groepsgemiddelde > 1.5 * groep-std-dev is.
// Rationale: dat is de klassieke "Tukey-light" buitengrens — 1.5 * sigma
// vangt ~13% van de gevallen op een normale verdeling, ruwweg de top-half
// van outliers zonder dat we te triggerhappy zijn voor 3-interviewer-panels
// waar 1 std-dev scheef trekt.

export interface AgreementMatrixCell {
  interviewer_id: string;
  interviewer_name: string;
  criterion_key: string;
  criterion_label: string;
  score: number | null;
  recommendation: string | null;
  std_deviation_from_mean: number;
}

export interface AgreementCriterionStats {
  criterion_key: string;
  criterion_label: string;
  mean: number;
  std_dev: number;
  range: number;
  consensus: 'strong' | 'moderate' | 'low';
}

export interface AgreementInterviewerStats {
  interviewer_id: string;
  name: string;
  mean_score: number;
  recommendation: string | null;
}

export interface AgreementMatrix {
  matrix: AgreementMatrixCell[];
  per_criterion: AgreementCriterionStats[];
  per_interviewer: AgreementInterviewerStats[];
  outlier_interviewer: { id: string; name: string; reason: string } | null;
}

interface ScorecardForAgreementRow {
  id: string;
  interviewer_id: string;
  interviewer_name: string | null;
  recommendation: string | null;
  overall_score: string | number | null;
  criteria_scores: unknown;
}

/**
 * Build de agreement matrix voor één applicatie. Alleen ingediende
 * (submitted) scorecards tellen mee — drafts negeren we omdat die nog niet
 * representatief zijn voor het oordeel van de interviewer.
 */
export async function getAgreementMatrix(
  tenantId: string,
  applicationId: string
): Promise<AgreementMatrix> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT s.id, s.interviewer_id, s.recommendation, s.overall_score,
              s.criteria_scores, u.name AS interviewer_name
       FROM scorecards s
       LEFT JOIN users u ON u.id = s.interviewer_id
       WHERE s.tenant_id = $1
         AND s.application_id = $2
         AND s.submitted_at IS NOT NULL`,
      [tenantId, applicationId]
    );

    const cards = (rows as ScorecardForAgreementRow[]).map((r) => ({
      ...r,
      overall_score:
        r.overall_score === null
          ? null
          : typeof r.overall_score === 'string'
            ? parseFloat(r.overall_score)
            : r.overall_score,
      criteria_scores: parseJsonArray<ScorecardCriterionScore>(r.criteria_scores),
    }));

    return computeAgreementMatrix(cards);
  });
}

/**
 * Pure rekenkern — geëxporteerd voor unit-tests zodat we de matrix kunnen
 * voeden zonder DB.
 */
export function computeAgreementMatrix(
  cards: Array<{
    interviewer_id: string;
    interviewer_name: string | null;
    recommendation: string | null;
    overall_score: number | null;
    criteria_scores: ScorecardCriterionScore[];
  }>
): AgreementMatrix {
  if (cards.length === 0) {
    return {
      matrix: [],
      per_criterion: [],
      per_interviewer: [],
      outlier_interviewer: null,
    };
  }

  // Verzamel alle criteria-keys (union over alle scorecards). Label =
  // de eerste criterion-string die we tegenkomen voor die key.
  const criterionLabels = new Map<string, string>();
  for (const c of cards) {
    for (const cs of c.criteria_scores) {
      if (!criterionLabels.has(cs.criterion)) {
        criterionLabels.set(cs.criterion, cs.criterion);
      }
    }
  }
  const criterionKeys = [...criterionLabels.keys()];

  // Per criterium: pak de score per interviewer (null als die het niet scoorde).
  const matrix: AgreementMatrixCell[] = [];
  const perCriterion: AgreementCriterionStats[] = [];

  for (const key of criterionKeys) {
    const scoresByInterviewer = new Map<string, number | null>();
    for (const c of cards) {
      const found = c.criteria_scores.find((cs) => cs.criterion === key);
      scoresByInterviewer.set(c.interviewer_id, found ? found.score : null);
    }
    const numeric = [...scoresByInterviewer.values()].filter(
      (v): v is number => typeof v === 'number'
    );
    const stats = numeric.length === 0
      ? { mean: 0, std_dev: 0, range: 0 }
      : computeStats(numeric);

    perCriterion.push({
      criterion_key: key,
      criterion_label: criterionLabels.get(key) ?? key,
      mean: round2(stats.mean),
      std_dev: round2(stats.std_dev),
      range: round2(stats.range),
      consensus: classifyConsensus(stats.std_dev),
    });

    for (const c of cards) {
      const score = scoresByInterviewer.get(c.interviewer_id) ?? null;
      matrix.push({
        interviewer_id: c.interviewer_id,
        interviewer_name: c.interviewer_name ?? c.interviewer_id,
        criterion_key: key,
        criterion_label: criterionLabels.get(key) ?? key,
        score,
        recommendation: c.recommendation,
        std_deviation_from_mean:
          score === null ? 0 : round2(score - stats.mean),
      });
    }
  }

  // Per interviewer: gemiddelde over zijn/haar criteria-scores (gebruik
  // overall_score als fallback wanneer criteria leeg zijn).
  const perInterviewer: AgreementInterviewerStats[] = cards.map((c) => {
    const numeric = c.criteria_scores
      .map((cs) => cs.score)
      .filter((s): s is number => typeof s === 'number');
    const mean = numeric.length > 0
      ? numeric.reduce((a, b) => a + b, 0) / numeric.length
      : (c.overall_score ?? 0);
    return {
      interviewer_id: c.interviewer_id,
      name: c.interviewer_name ?? c.interviewer_id,
      mean_score: round2(mean),
      recommendation: c.recommendation,
    };
  });

  // Outlier: per interviewer berekenen we zijn/haar gemiddelde absolute
  // afwijking tot het groepsgemiddelde over alle criteria. > 1.5 * groep-
  // std-dev (over alle scores in de matrix) → outlier. Bij <3 interviewers
  // skippen we — outlier-detectie heeft geen zin in een twee-mans-panel.
  let outlier: AgreementMatrix['outlier_interviewer'] = null;
  if (cards.length >= 3) {
    const allNumericScores = matrix
      .map((m) => m.score)
      .filter((s): s is number => typeof s === 'number');
    const groupStats = computeStats(allNumericScores);

    let maxAbsDev = 0;
    let maxId: string | null = null;
    let maxName: string | null = null;
    for (const c of cards) {
      const cellsForInterviewer = matrix.filter(
        (m) => m.interviewer_id === c.interviewer_id && m.score !== null
      );
      if (cellsForInterviewer.length === 0) continue;
      const meanAbsDev =
        cellsForInterviewer.reduce(
          (acc, m) => acc + Math.abs((m.score as number) - findCriterionMean(perCriterion, m.criterion_key)),
          0
        ) / cellsForInterviewer.length;
      if (meanAbsDev > maxAbsDev) {
        maxAbsDev = meanAbsDev;
        maxId = c.interviewer_id;
        maxName = c.interviewer_name ?? c.interviewer_id;
      }
    }
    if (maxId && maxAbsDev > 1.5 * groupStats.std_dev && groupStats.std_dev > 0) {
      outlier = {
        id: maxId,
        name: maxName ?? maxId,
        reason: `Mean absolute deviation ${round2(maxAbsDev)} > 1.5 * groep-std-dev ${round2(groupStats.std_dev)}`,
      };
    }
  }

  return { matrix, per_criterion: perCriterion, per_interviewer: perInterviewer, outlier_interviewer: outlier };
}

function computeStats(values: number[]): { mean: number; std_dev: number; range: number } {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const range = Math.max(...values) - Math.min(...values);
  return { mean, std_dev: stdDev, range };
}

function classifyConsensus(stdDev: number): 'strong' | 'moderate' | 'low' {
  if (stdDev < 0.5) return 'strong';
  if (stdDev < 1.5) return 'moderate';
  return 'low';
}

function findCriterionMean(stats: AgreementCriterionStats[], key: string): number {
  return stats.find((s) => s.criterion_key === key)?.mean ?? 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function createTemplate(
  tenantId: string,
  userId: string,
  input: CreateTemplateInput,
  ctx: AuditContext = {}
): Promise<ScorecardTemplate> {
  if (!Array.isArray(input.criteria) || input.criteria.length === 0) {
    throw new AppError(400, 'CRITERIA_REQUIRED', 'Minimaal 1 criterium vereist');
  }

  return withTenant(tenantId, async (client) => {
    // Wanneer is_default=true, gooi alle andere defaults terug naar false zodat
    // er per (job, stage)-bucket maximaal 1 default-template overblijft.
    if (input.is_default) {
      await client.query(
        `UPDATE scorecard_templates
         SET is_default = FALSE, updated_at = now()
         WHERE tenant_id = $1
           AND COALESCE(applies_to_job_id, '00000000-0000-0000-0000-000000000000'::uuid) =
               COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
           AND COALESCE(applies_to_stage_id, '00000000-0000-0000-0000-000000000000'::uuid) =
               COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
           AND is_default = TRUE`,
        [tenantId, input.applies_to_job_id ?? null, input.applies_to_stage_id ?? null]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO scorecard_templates
         (tenant_id, name, criteria, applies_to_job_id, applies_to_stage_id, is_default)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)
       RETURNING *`,
      [
        tenantId,
        input.name,
        JSON.stringify(input.criteria),
        input.applies_to_job_id ?? null,
        input.applies_to_stage_id ?? null,
        input.is_default ?? false,
      ]
    );
    const tmpl = rowToTemplate(rows[0]);

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.SCORECARD_TEMPLATE_CREATED,
        entityType: 'scorecard_template',
        entityId: tmpl.id,
        after: { name: tmpl.name, is_default: tmpl.is_default },
        userId,
      },
      ctx
    );

    return tmpl;
  });
}

/**
 * Skills service — Sprint Q3.6 (Agent HHH).
 *
 * Verantwoordelijkheden:
 *   - Lezen van het skill-profiel van een kandidaat / vacature in ESCO-termen.
 *   - Synchroniseren van legacy free-form skills naar ESCO-mappings.
 *   - Skills-gap analyse tussen vacature en kandidaat.
 *   - ESCO-skill search-API.
 *
 * Conventies:
 *   - Tenant-tabellen (candidate_skill_mappings, job_skill_mappings) altijd
 *     via `withTenant` — RLS-policies van migratie 020 doen de rest.
 *   - `esco_skills` is system-wide (geen RLS) — gelezen via `withoutTenant`
 *     of via dezelfde tx-client (Postgres negeert RLS op tabellen waar het
 *     niet aan staat).
 */

import type { PoolClient } from 'pg';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import {
  mapManySkillsToEsco,
  type SkillMappingResult,
} from '../../lib/skills/mapper';

// ────────────────────────────────────────────────────────────────────────────
// Types — exported voor controllers en tests
// ────────────────────────────────────────────────────────────────────────────

export interface EscoSkillSearchHit {
  id: string;
  preferred_label: string;
  alt_labels: string[];
  description: string | null;
  skill_type: string | null;
  category: string | null;
  parent_id: string | null;
}

export interface CandidateEscoSkillEntry {
  esco_skill_id: string;
  preferred_label: string;
  category: string | null;
  proficiency: number | null;
  confidence: number;
  source_skill_text: string;
  matched_via: string;
}

export interface CandidateSkillProfile {
  candidate_id: string;
  esco_skills: CandidateEscoSkillEntry[];
  total_skills: number;
  /** Map category → count. */
  skill_categories: Record<string, number>;
}

export interface JobEscoSkillEntry {
  esco_skill_id: string;
  preferred_label: string;
  category: string | null;
  required: boolean;
  confidence: number;
  source_skill_text: string;
}

export interface JobSkillProfile {
  job_id: string;
  esco_skills: JobEscoSkillEntry[];
  required_count: number;
  nice_to_have_count: number;
  skill_categories: Record<string, number>;
}

export interface SkillsGapMatchEntry {
  esco_skill_id: string;
  preferred_label: string;
  category: string | null;
  has: boolean;
  proficiency: number | null;
}

export interface SkillsGapBonusEntry {
  esco_skill_id: string;
  preferred_label: string;
  category: string | null;
  proficiency: number | null;
}

export type SkillsGapRecommendation =
  | 'strong_fit'
  | 'good_fit'
  | 'partial_fit'
  | 'weak_fit';

export interface SkillsGapAnalysis {
  job_id: string;
  candidate_id: string;
  required_skills_match: SkillsGapMatchEntry[];
  nice_to_have_match: SkillsGapMatchEntry[];
  match_pct: number;
  bonus_skills: SkillsGapBonusEntry[];
  recommendation: SkillsGapRecommendation;
}

export interface SyncResult {
  mapped: number;
  unmapped: number;
}

export interface EscoSearchOptions {
  q?: string;
  category?: string;
  skill_type?: string;
  limit?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// ESCO search
// ────────────────────────────────────────────────────────────────────────────

/**
 * Vrij-tekst zoek in ESCO-skills. Retourneert top-N via ILIKE op
 * preferred_label OF in alt_labels. Geen tenant-filter — taxonomie is shared.
 */
export async function searchEscoSkills(
  options: EscoSearchOptions = {}
): Promise<EscoSkillSearchHit[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  return withoutTenant(async (client) => {
    const filters: string[] = [];
    const params: unknown[] = [];

    if (options.q && options.q.trim().length > 0) {
      params.push(`%${options.q.trim()}%`);
      filters.push(
        `(preferred_label ILIKE $${params.length}
          OR EXISTS (SELECT 1 FROM unnest(alt_labels) al
                      WHERE al ILIKE $${params.length}))`
      );
    }
    if (options.category) {
      params.push(options.category);
      filters.push(`category = $${params.length}`);
    }
    if (options.skill_type) {
      params.push(options.skill_type);
      filters.push(`skill_type = $${params.length}`);
    }

    params.push(limit);
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await client.query<EscoSkillSearchHit>(
      `SELECT id, preferred_label, alt_labels, description, skill_type, category, parent_id
         FROM esco_skills
         ${where}
         ORDER BY preferred_label ASC
         LIMIT $${params.length}`,
      params
    );
    return rows;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Candidate skill profile
// ────────────────────────────────────────────────────────────────────────────

export async function getCandidateSkillProfile(
  tenantId: string,
  candidateId: string
): Promise<CandidateSkillProfile> {
  return withTenant(tenantId, async (client) => {
    // Verifieer dat de kandidaat bestaat (RLS-veilige read).
    const { rows: existsRows } = await client.query<{ id: string }>(
      `SELECT id FROM candidates WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [candidateId]
    );
    if (existsRows.length === 0) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    const { rows } = await client.query<CandidateEscoSkillEntry>(
      `SELECT m.esco_skill_id,
              s.preferred_label,
              s.category,
              m.proficiency,
              m.confidence::float AS confidence,
              m.source_skill_text,
              m.matched_via
         FROM candidate_skill_mappings m
         JOIN esco_skills s ON s.id = m.esco_skill_id
        WHERE m.candidate_id = $1
        ORDER BY s.preferred_label ASC`,
      [candidateId]
    );

    const skill_categories: Record<string, number> = {};
    for (const r of rows) {
      const cat = r.category ?? 'Other';
      skill_categories[cat] = (skill_categories[cat] ?? 0) + 1;
    }
    return {
      candidate_id: candidateId,
      esco_skills: rows,
      total_skills: rows.length,
      skill_categories,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Job skill profile
// ────────────────────────────────────────────────────────────────────────────

export async function getJobSkillProfile(
  tenantId: string,
  jobId: string
): Promise<JobSkillProfile> {
  return withTenant(tenantId, async (client) => {
    const { rows: existsRows } = await client.query<{ id: string }>(
      `SELECT id FROM jobs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [jobId]
    );
    if (existsRows.length === 0) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }

    const { rows } = await client.query<JobEscoSkillEntry>(
      `SELECT m.esco_skill_id,
              s.preferred_label,
              s.category,
              m.required,
              m.confidence::float AS confidence,
              m.source_skill_text
         FROM job_skill_mappings m
         JOIN esco_skills s ON s.id = m.esco_skill_id
        WHERE m.job_id = $1
        ORDER BY m.required DESC, s.preferred_label ASC`,
      [jobId]
    );

    const skill_categories: Record<string, number> = {};
    let required_count = 0;
    let nice_to_have_count = 0;
    for (const r of rows) {
      const cat = r.category ?? 'Other';
      skill_categories[cat] = (skill_categories[cat] ?? 0) + 1;
      if (r.required) required_count++;
      else nice_to_have_count++;
    }
    return {
      job_id: jobId,
      esco_skills: rows,
      required_count,
      nice_to_have_count,
      skill_categories,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Sync: candidate.skills + candidate_skills → candidate_skill_mappings
// ────────────────────────────────────────────────────────────────────────────

interface CandidateSourceSkill {
  text: string;
  proficiency: number | null;
}

async function loadCandidateSourceSkills(
  client: PoolClient,
  candidateId: string
): Promise<CandidateSourceSkill[]> {
  const { rows: cand } = await client.query<{
    skills: string[] | null;
  }>(
    `SELECT skills FROM candidates WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [candidateId]
  );
  if (cand.length === 0) {
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
  }
  const freeForm = (cand[0].skills ?? []).filter((s) => s && s.trim().length > 0);

  const { rows: scored } = await client.query<{
    skill: string;
    score: number | null;
  }>(
    `SELECT skill, score FROM candidate_skills WHERE candidate_id = $1`,
    [candidateId]
  );

  // Merge: scored entries hebben priority op proficiency. Free-form ondersteunt
  // alleen text. Dedupe op lower-cased text.
  const merged = new Map<string, CandidateSourceSkill>();
  for (const f of freeForm) {
    const key = f.trim().toLowerCase();
    if (!merged.has(key)) merged.set(key, { text: f.trim(), proficiency: null });
  }
  for (const s of scored) {
    if (!s.skill) continue;
    const key = s.skill.trim().toLowerCase();
    const prof = s.score ?? null;
    const existing = merged.get(key);
    if (existing) {
      existing.proficiency = prof ?? existing.proficiency;
    } else {
      merged.set(key, { text: s.skill.trim(), proficiency: prof });
    }
  }
  return [...merged.values()];
}

export async function syncCandidateSkillsToEsco(
  tenantId: string,
  candidateId: string
): Promise<SyncResult> {
  return withTenant(tenantId, async (client) => {
    const sources = await loadCandidateSourceSkills(client, candidateId);
    if (sources.length === 0) {
      return { mapped: 0, unmapped: 0 };
    }

    // Map alle source-texts in één batch — dedupliceert + cache-vriendelijk.
    const mappings = await mapManySkillsToEsco(
      sources.map((s) => s.text),
      { client }
    );

    let mapped = 0;
    let unmapped = 0;

    // Dedupe op esco_skill_id — meerdere source-texts kunnen op dezelfde
    // ESCO-skill mappen (bv. "JS" en "JavaScript"). We pakken de hoogste
    // confidence en hoogste proficiency.
    const perEsco = new Map<
      string,
      {
        result: SkillMappingResult;
        source_text: string;
        proficiency: number | null;
      }
    >();

    mappings.forEach((m, idx) => {
      const src = sources[idx];
      if (!m.result) {
        unmapped++;
        return;
      }
      const prev = perEsco.get(m.result.esco_skill_id);
      if (!prev || m.result.confidence > prev.result.confidence) {
        perEsco.set(m.result.esco_skill_id, {
          result: m.result,
          source_text: src.text,
          proficiency: src.proficiency,
        });
      } else if (
        prev.proficiency == null &&
        src.proficiency != null
      ) {
        prev.proficiency = src.proficiency;
      }
    });

    for (const entry of perEsco.values()) {
      await client.query(
        `INSERT INTO candidate_skill_mappings
           (tenant_id, candidate_id, esco_skill_id,
            source_skill_text, confidence, proficiency, matched_via)
         VALUES (current_setting('app.tenant_id', true)::uuid, $1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, candidate_id, esco_skill_id) DO UPDATE
           SET source_skill_text = EXCLUDED.source_skill_text,
               confidence        = EXCLUDED.confidence,
               proficiency       = EXCLUDED.proficiency,
               matched_via       = EXCLUDED.matched_via`,
        [
          candidateId,
          entry.result.esco_skill_id,
          entry.source_text,
          entry.result.confidence.toFixed(4),
          entry.proficiency,
          entry.result.matched_via,
        ]
      );
      mapped++;
    }

    return { mapped, unmapped };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Sync: jobs.required_skills + nice_to_have_skills → job_skill_mappings
// ────────────────────────────────────────────────────────────────────────────

export async function syncJobSkillsToEsco(
  tenantId: string,
  jobId: string
): Promise<SyncResult> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      required_skills: string[] | null;
      nice_to_have_skills: string[] | null;
    }>(
      `SELECT required_skills, nice_to_have_skills
         FROM jobs
        WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [jobId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }
    const required = (rows[0].required_skills ?? []).filter(
      (s) => s && s.trim().length > 0
    );
    const nice = (rows[0].nice_to_have_skills ?? []).filter(
      (s) => s && s.trim().length > 0
    );

    const all = [...required.map((t) => ({ text: t, required: true })),
                 ...nice.map((t) => ({ text: t, required: false }))];
    if (all.length === 0) return { mapped: 0, unmapped: 0 };

    const mappings = await mapManySkillsToEsco(
      all.map((a) => a.text),
      { client }
    );

    let mapped = 0;
    let unmapped = 0;

    // Dedupe per esco_skill — kies hoogste confidence; required wint over nice.
    const perEsco = new Map<
      string,
      { result: SkillMappingResult; source_text: string; required: boolean }
    >();
    mappings.forEach((m, idx) => {
      const item = all[idx];
      if (!m.result) {
        unmapped++;
        return;
      }
      const prev = perEsco.get(m.result.esco_skill_id);
      if (!prev) {
        perEsco.set(m.result.esco_skill_id, {
          result: m.result,
          source_text: item.text,
          required: item.required,
        });
      } else {
        // Higher confidence wins; required-status OR-merged (true blijft true).
        if (m.result.confidence > prev.result.confidence) {
          prev.result = m.result;
          prev.source_text = item.text;
        }
        if (item.required) prev.required = true;
      }
    });

    for (const entry of perEsco.values()) {
      await client.query(
        `INSERT INTO job_skill_mappings
           (tenant_id, job_id, esco_skill_id, source_skill_text, confidence, required)
         VALUES (current_setting('app.tenant_id', true)::uuid, $1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, job_id, esco_skill_id) DO UPDATE
           SET source_skill_text = EXCLUDED.source_skill_text,
               confidence        = EXCLUDED.confidence,
               required          = EXCLUDED.required OR job_skill_mappings.required`,
        [
          jobId,
          entry.result.esco_skill_id,
          entry.source_text,
          entry.result.confidence.toFixed(4),
          entry.required,
        ]
      );
      mapped++;
    }

    return { mapped, unmapped };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Skills-gap analyse
// ────────────────────────────────────────────────────────────────────────────

/**
 * Bepaal de fit-recommendation op basis van match-percentage.
 *  ≥80 strong, ≥60 good, ≥40 partial, <40 weak
 *
 * Geëxporteerd voor unit-tests.
 */
export function classifyRecommendation(matchPct: number): SkillsGapRecommendation {
  if (matchPct >= 80) return 'strong_fit';
  if (matchPct >= 60) return 'good_fit';
  if (matchPct >= 40) return 'partial_fit';
  return 'weak_fit';
}

interface JobReqSkillRow {
  esco_skill_id: string;
  preferred_label: string;
  category: string | null;
  required: boolean;
}

interface CandSkillRow {
  esco_skill_id: string;
  preferred_label: string;
  category: string | null;
  proficiency: number | null;
}

export async function analyzeSkillsGap(
  tenantId: string,
  jobId: string,
  candidateId: string
): Promise<SkillsGapAnalysis> {
  return withTenant(tenantId, async (client) => {
    // Job skills
    const { rows: jobSkillRows } = await client.query<JobReqSkillRow>(
      `SELECT m.esco_skill_id,
              s.preferred_label,
              s.category,
              m.required
         FROM job_skill_mappings m
         JOIN esco_skills s ON s.id = m.esco_skill_id
        WHERE m.job_id = $1`,
      [jobId]
    );

    // Candidate skills
    const { rows: candSkillRows } = await client.query<CandSkillRow>(
      `SELECT m.esco_skill_id,
              s.preferred_label,
              s.category,
              m.proficiency
         FROM candidate_skill_mappings m
         JOIN esco_skills s ON s.id = m.esco_skill_id
        WHERE m.candidate_id = $1`,
      [candidateId]
    );

    if (jobSkillRows.length === 0) {
      // Geen job-skills gemapt — aanrader: roep eerst syncJobSkillsToEsco.
      // We retourneren een "neutral" structuur i.p.v. exception zodat de UI
      // zonder crashes de "geen data"-state kan tonen.
      return {
        job_id: jobId,
        candidate_id: candidateId,
        required_skills_match: [],
        nice_to_have_match: [],
        match_pct: 0,
        bonus_skills: candSkillRows.map((c) => ({
          esco_skill_id: c.esco_skill_id,
          preferred_label: c.preferred_label,
          category: c.category,
          proficiency: c.proficiency,
        })),
        recommendation: 'weak_fit',
      };
    }

    const candidateSkillMap = new Map(
      candSkillRows.map((c) => [c.esco_skill_id, c])
    );

    const required_skills_match: SkillsGapMatchEntry[] = [];
    const nice_to_have_match: SkillsGapMatchEntry[] = [];
    let requiredTotal = 0;
    let requiredHits = 0;

    for (const r of jobSkillRows) {
      const has = candidateSkillMap.has(r.esco_skill_id);
      const prof = has
        ? candidateSkillMap.get(r.esco_skill_id)?.proficiency ?? null
        : null;
      const entry: SkillsGapMatchEntry = {
        esco_skill_id: r.esco_skill_id,
        preferred_label: r.preferred_label,
        category: r.category,
        has,
        proficiency: prof,
      };
      if (r.required) {
        required_skills_match.push(entry);
        requiredTotal++;
        if (has) requiredHits++;
      } else {
        nice_to_have_match.push(entry);
      }
    }

    const match_pct =
      requiredTotal === 0
        ? 100 // geen required gedefinieerd ⇒ perfect by definition
        : (requiredHits / requiredTotal) * 100;

    const jobSkillIds = new Set(jobSkillRows.map((r) => r.esco_skill_id));
    const bonus_skills: SkillsGapBonusEntry[] = candSkillRows
      .filter((c) => !jobSkillIds.has(c.esco_skill_id))
      .map((c) => ({
        esco_skill_id: c.esco_skill_id,
        preferred_label: c.preferred_label,
        category: c.category,
        proficiency: c.proficiency,
      }));

    return {
      job_id: jobId,
      candidate_id: candidateId,
      required_skills_match,
      nice_to_have_match,
      match_pct: Number(match_pct.toFixed(2)),
      bonus_skills,
      recommendation: classifyRecommendation(match_pct),
    };
  });
}

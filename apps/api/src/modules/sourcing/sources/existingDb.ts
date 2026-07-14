/**
 * existing-DB sourcing connector — Sprint Q4.5 (Agent WWW).
 *
 * Zoekt in de eigen `candidates` tabel. Combineert:
 *   1. ILIKE / full-text op name + current_position + current_company + description
 *   2. Skill-matching via candidates.skills (jsonb array) — count overlapping skills
 *      met must_have + nice_to_have voor scoring.
 *   3. Location filter (address_city, address_country).
 *
 * Geen pgvector hier — dat is voor de matching-service (Q3.3) op job_id-context.
 * De agent kan separately matching.service.findCandidatesForJob aanroepen voor
 * embedding-similarity, maar voor brief-driven sourcing (geen job vereist) is
 * lexical search het robuustst.
 *
 * Always-on: deze source is altijd enabled — eigen DB is gratis.
 */

import { withTenant } from '../../../db/pool';
import type {
  SourcingSource,
  RawCandidate,
  BooleanQuery,
  SourcingSourceContext,
} from './types';

interface CandidateRow {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  current_position: string | null;
  current_company: string | null;
  description: string | null;
  skills: unknown;
  languages: unknown;
  address_city: string | null;
  address_country: string | null;
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Bouw een ILIKE-clause uit de boolean-query string. Voor MVP: parsen we de
 * query door de eerste 3-5 alphanumerieke termen te pakken. Een volledige
 * boolean-parser is overkill — Claude levert al gestructureerde queries en
 * we gebruiken hier conjunctie van must_have als basis.
 */
function extractKeywords(query: string): string[] {
  const tokens = (query.match(/[a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ0-9.+#-]{1,40}/g) ?? [])
    .filter((t) => !/^(or|and|not)$/i.test(t))
    .map((t) => t.toLowerCase());
  // Dedupe + cap.
  return Array.from(new Set(tokens)).slice(0, 8);
}

function scoreCandidate(
  row: CandidateRow,
  brief: { must_have: string[]; nice_to_have: string[] }
): number {
  const skills = asArray(row.skills).map((s) => s.toLowerCase());
  const description = (row.description ?? '').toLowerCase();
  const title = (row.current_position ?? '').toLowerCase();

  let score = 0;
  let mustHits = 0;
  for (const m of brief.must_have) {
    const needle = m.toLowerCase();
    if (skills.includes(needle) || description.includes(needle) || title.includes(needle)) {
      mustHits++;
      score += 12;
    }
  }
  for (const n of brief.nice_to_have) {
    const needle = n.toLowerCase();
    if (skills.includes(needle) || description.includes(needle) || title.includes(needle)) {
      score += 4;
    }
  }
  // Penalty wanneer geen enkele must-have raakt.
  if (brief.must_have.length > 0 && mustHits === 0) score = Math.max(0, score - 10);
  return Math.min(100, score);
}

export const existingDbSource: SourcingSource = {
  id: 'existing_db',
  name: 'Existing DB',
  isEnabled: () => true,
  async search(
    query: BooleanQuery,
    ctx: SourcingSourceContext
  ): Promise<RawCandidate[]> {
    const keywords = extractKeywords(query.query);
    const limit = Math.max(5, Math.min(200, ctx.limit ?? 50));
    const locations = (query.locations ?? ctx.brief.search_locations).map((l) => l.toLowerCase());

    return withTenant(ctx.tenantId, async (client) => {
      // Base SQL — ILIKE OR over name / position / description / skills.
      const params: unknown[] = [ctx.tenantId];
      const orClauses: string[] = [];
      for (const kw of keywords) {
        params.push(`%${kw}%`);
        const idx = params.length;
        orClauses.push(
          `(name ILIKE $${idx} OR current_position ILIKE $${idx} OR current_company ILIKE $${idx} OR description ILIKE $${idx} OR skills::text ILIKE $${idx})`
        );
      }
      // deleted_at IS NULL: soft-deleted kandidaten mogen NOOIT als sourcing-
      // finding terugkomen (AVG — "recht op verwijdering").
      const wheres: string[] = ['tenant_id = $1', 'deleted_at IS NULL'];
      if (orClauses.length > 0) wheres.push(`(${orClauses.join(' OR ')})`);
      if (locations.length > 0) {
        const locClauses: string[] = [];
        for (const loc of locations) {
          params.push(`%${loc}%`);
          const idx = params.length;
          locClauses.push(`(address_city ILIKE $${idx} OR address_country ILIKE $${idx})`);
        }
        wheres.push(`(${locClauses.join(' OR ')})`);
      }
      params.push(limit);
      const sql = `SELECT id, name, first_name, last_name, current_position, current_company,
                          description, skills, languages, address_city, address_country
                     FROM candidates
                    WHERE ${wheres.join(' AND ')}
                    ORDER BY updated_at DESC NULLS LAST
                    LIMIT $${params.length}`;
      let rows: CandidateRow[] = [];
      try {
        const result = await client.query<CandidateRow>(sql, params);
        rows = result.rows;
      } catch {
        // candidates-tabel kan in een test-fixture niet bestaan — geen crash.
        return [];
      }

      const out: RawCandidate[] = rows.map((row) => {
        const fullName =
          row.name ??
          [row.first_name, row.last_name].filter(Boolean).join(' ') ??
          'Onbekend';
        const score = scoreCandidate(row, {
          must_have: ctx.brief.must_have,
          nice_to_have: ctx.brief.nice_to_have,
        });
        return {
          externalId: row.id,
          externalUrl: null,
          fullName,
          currentTitle: row.current_position,
          currentCompany: row.current_company,
          location: [row.address_city, row.address_country].filter(Boolean).join(', ') || null,
          headline: row.current_position,
          summary: row.description,
          skills: asArray(row.skills),
          languages: asArray(row.languages),
          rawScore: score,
          metadata: { internal_candidate_id: row.id },
        };
      });
      // Sort by score desc, cap to limit.
      out.sort((a, b) => (b.rawScore ?? 0) - (a.rawScore ?? 0));
      return out.slice(0, limit);
    });
  },
};

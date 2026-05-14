-- 006_pgvector_matching.sql
-- pgvector setup voor AI-matching tussen jobs en candidates.
-- Volgt KDMN-conventie: idempotent (IF NOT EXISTS / DO $$ guards),
-- snake_case, RLS-stijl uit 001_init.sql.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ RUNTIME REQUIREMENT — pgvector extensie moet beschikbaar zijn op de DB  │
-- ├─────────────────────────────────────────────────────────────────────────┤
-- │ Production opties:                                                      │
-- │   • Neon Postgres        — beschikbaar out-of-the-box (CREATE EXTENSION)│
-- │   • Supabase             — pre-installed in elke project DB             │
-- │   • RDS / Aurora         — vanaf Postgres 15.2 / Aurora 15.4 standaard  │
-- │   • Self-hosted (Docker) — gebruik image `pgvector/pgvector:pg16`       │
-- │                            of installeer via apt: postgresql-16-pgvector│
-- │                                                                         │
-- │ Migratie faalt netjes met een leesbare foutmelding als de extensie      │
-- │ niet beschikbaar is — zie het notice-block hieronder.                   │
-- └─────────────────────────────────────────────────────────────────────────┘

-- =========================================================================
-- 0) PGVECTOR EXTENSION
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
  ) THEN
    RAISE EXCEPTION
      'pgvector extension is niet beschikbaar op deze PostgreSQL-instantie. '
      'Installeer pgvector (zie comment bovenaan migratie 006) en voer migrate opnieuw uit.';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS vector;

-- =========================================================================
-- 1) CANDIDATES — embedding kolommen
-- =========================================================================
-- text-embedding-3-small produceert 1536-dimensionale vectors.
-- embedding_updated_at NULL = nooit geïndexeerd (UI kan "X kandidaten zonder
-- AI-profiel" tonen).

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS embedding            vector(1536);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;

-- HNSW-index (Hierarchical Navigable Small World) voor snelle approximate
-- nearest-neighbor zoek met cosine-distance. Defensief: alleen aanmaken als
-- er nog geen index is en als pgvector ≥ 0.5.0 (HNSW) draait.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'idx_candidates_embedding_hnsw'
  ) THEN
    -- m=16, ef_construction=64 zijn pgvector defaults — goede balans
    -- recall/snelheid voor ≤ 100k rijen. Bij grotere volumes evalueer.
    CREATE INDEX idx_candidates_embedding_hnsw
      ON candidates USING hnsw (embedding vector_cosine_ops);
  END IF;
END $$;

-- =========================================================================
-- 2) JOBS — embedding kolommen
-- =========================================================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS embedding            vector(1536);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'idx_jobs_embedding_hnsw'
  ) THEN
    CREATE INDEX idx_jobs_embedding_hnsw
      ON jobs USING hnsw (embedding vector_cosine_ops);
  END IF;
END $$;

-- =========================================================================
-- 3) MATCH_SCORES — pre-computed scores + AI explanations cache
-- =========================================================================
-- Cache-tabel: ai_explanation wordt door Agent Q lazy-gevuld via een aparte
-- endpoint. score zelf is altijd live (cosine sim) — deze rij dient primair
-- voor de explanation cache plus pre-compute optimalisatie later.

CREATE TABLE IF NOT EXISTS match_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES jobs(id)        ON DELETE CASCADE,
  candidate_id    UUID NOT NULL REFERENCES candidates(id)  ON DELETE CASCADE,
  score           NUMERIC(5,4) NOT NULL,           -- 0.0000 - 1.0000 (cosine similarity)
  ai_explanation  TEXT,                            -- 2-3 regel uitleg waarom deze match
  explanation_at  TIMESTAMPTZ,
  computed_at     TIMESTAMPTZ DEFAULT now()
);

-- Defensieve CHECK voor score-range (idempotent).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'match_scores_score_range_check'
  ) THEN
    ALTER TABLE match_scores
      ADD CONSTRAINT match_scores_score_range_check
      CHECK (score >= 0 AND score <= 1);
  END IF;
END $$;

-- UNIQUE (tenant_id, job_id, candidate_id) — één cache-rij per (job,candidate).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'uq_match_scores_tenant_job_candidate'
  ) THEN
    CREATE UNIQUE INDEX uq_match_scores_tenant_job_candidate
      ON match_scores(tenant_id, job_id, candidate_id);
  END IF;
END $$;

-- RLS
ALTER TABLE match_scores ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'match_scores'
      AND policyname = 'tenant_isolation_match_scores'
  ) THEN
    CREATE POLICY tenant_isolation_match_scores ON match_scores
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Indexes voor "top N matches voor een job" en "top N matches voor een candidate".
CREATE INDEX IF NOT EXISTS idx_match_scores_tenant_job_score
  ON match_scores(tenant_id, job_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_match_scores_tenant_candidate_score
  ON match_scores(tenant_id, candidate_id, score DESC);

-- 015_jd_generator_reactivation.sql
-- Sprint Q3.2 — AI vacaturetekst-generator + Talent Reactivation.
--
-- Voegt twee nieuwe tabellen toe:
--   1. jd_drafts                    — door de AI gegenereerde vacatureteksten
--                                      met meerdere A/B-varianten, voordat ze
--                                      worden gepubliceerd als job.
--   2. talent_reactivation_alerts   — nightly cron-resultaten: archived/rejected
--                                      kandidaten die alsnog hoog matchen op
--                                      een actieve vacature (vector similarity).
--
-- KDMN-conventies: idempotent (IF NOT EXISTS / DO $$ guards), snake_case, RLS via
-- app.tenant_id-setting (zoals 001_init.sql en 014_mailbox_integrations.sql).

-- =========================================================================
-- A) JD_DRAFTS — gegenereerde JDs voordat ze als jobs gepubliceerd worden
-- =========================================================================
--
-- variants is een JSONB array van {id, title, description, bias_flags,
-- clarity_score, inclusivity_score, word_count}. selected_variant_id is een
-- TEXT (matcht het 'id' veld in de variant-objects, niet de UUID van een job).
-- job_id wordt gevuld zodra publishJdDraft een jobs-rij aanmaakt.

CREATE TABLE IF NOT EXISTS jd_drafts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  prompt              TEXT NOT NULL,                                 -- ruwe input van recruiter
  parameters          JSONB NOT NULL DEFAULT '{}'::jsonb,            -- {role, level, key_skills, tone, length, language, ...}
  variants            JSONB NOT NULL DEFAULT '[]'::jsonb,            -- array van JD-variant-objects
  selected_variant_id TEXT,                                          -- variant.id van de gekozen variant
  status              TEXT NOT NULL DEFAULT 'draft',                 -- draft|published|discarded
  job_id              UUID REFERENCES jobs(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jd_drafts_status_check'
  ) THEN
    ALTER TABLE jd_drafts
      ADD CONSTRAINT jd_drafts_status_check
      CHECK (status IN ('draft','published','discarded'));
  END IF;
END $$;

ALTER TABLE jd_drafts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'jd_drafts' AND policyname = 'tenant_isolation_jd_drafts'
  ) THEN
    CREATE POLICY tenant_isolation_jd_drafts ON jd_drafts
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jd_drafts_tenant_status_created
  ON jd_drafts(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jd_drafts_tenant_user_created
  ON jd_drafts(tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jd_drafts_job
  ON jd_drafts(job_id) WHERE job_id IS NOT NULL;

-- =========================================================================
-- B) TALENT_REACTIVATION_ALERTS — nightly recall van slapende kandidaten
-- =========================================================================
--
-- UNIQUE(tenant_id, job_id, candidate_id) zorgt dat de nightly cron idempotent
-- is: dezelfde (job, candidate)-combo wordt nooit dubbel ingelegd. Gebruik
-- INSERT ... ON CONFLICT DO NOTHING in de worker.
--
-- match_score is cosine similarity 0..1 (NUMERIC(5,4) net als match_scores).
-- reason is een korte tag voor UI-grouping ('old_archived','rejected_in_other_job',
-- 'strong_skill_match'). acknowledged_at / dismissed_at zijn beide NULL =
-- "nieuw"; gevuld zodra de recruiter de alert behandelt.

CREATE TABLE IF NOT EXISTS talent_reactivation_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  match_score     NUMERIC(5,4) NOT NULL,
  reason          TEXT,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'talent_reactivation_alerts_score_range_check'
  ) THEN
    ALTER TABLE talent_reactivation_alerts
      ADD CONSTRAINT talent_reactivation_alerts_score_range_check
      CHECK (match_score >= 0 AND match_score <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'talent_reactivation_alerts_unique_tjc'
  ) THEN
    ALTER TABLE talent_reactivation_alerts
      ADD CONSTRAINT talent_reactivation_alerts_unique_tjc
      UNIQUE (tenant_id, job_id, candidate_id);
  END IF;
END $$;

ALTER TABLE talent_reactivation_alerts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'talent_reactivation_alerts'
      AND policyname = 'tenant_isolation_talent_reactivation_alerts'
  ) THEN
    CREATE POLICY tenant_isolation_talent_reactivation_alerts
      ON talent_reactivation_alerts
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- "Open alerts voor deze job" — NULLS FIRST zodat unacknowledged bovenaan komt.
CREATE INDEX IF NOT EXISTS idx_talent_reactivation_alerts_job_ack
  ON talent_reactivation_alerts(tenant_id, job_id, acknowledged_at NULLS FIRST);

-- "Alle openstaande alerts deze week" — voor stats endpoint.
CREATE INDEX IF NOT EXISTS idx_talent_reactivation_alerts_tenant_created
  ON talent_reactivation_alerts(tenant_id, created_at DESC);

-- "Alerts voor een specifieke candidate" — handig wanneer recruiter de
-- candidate-detail pagina opent.
CREATE INDEX IF NOT EXISTS idx_talent_reactivation_alerts_candidate
  ON talent_reactivation_alerts(tenant_id, candidate_id, created_at DESC);

-- 016_talent_fit_model.sql
-- Sprint Q3.3 — Talent Fit Model.
--
-- Per-tenant logistic-regression model trainable van applications-history.
-- Pure JS implementatie (geen Python/XGBoost/native bindings) zodat we het
-- in-process kunnen trainen via een nightly worker.
--
-- Twee tabellen:
--   1. talent_fit_models       — getrainde modellen (coefficients + metrics)
--   2. talent_fit_predictions  — cache van predictions per (job, candidate)
--
-- KDMN-conventies: idempotent (IF NOT EXISTS / DO $$ guards), snake_case, RLS
-- via app.tenant_id-setting (gelijk aan 001_init.sql / 015_jd_generator_*).

-- =========================================================================
-- A) TALENT_FIT_MODELS — getrainde logistic-regression modellen per tenant
-- =========================================================================
--
-- coefficients      JSONB met { weights:[...], intercept:n, normalization:[{mean,std},...] }
--                   — feature_names zit ook expliciet als TEXT[] zodat we
--                     consistente ordering kunnen valideren bij inference.
-- trained_on        aantal training samples (hires + rejects).
-- precision_at_1    cross-validated; in test-fold heeft top-1 ranking precisie.
-- recall_at_10      idem, top-10.
-- auc               area under ROC-curve op test-fold.
-- active            True = ingezette model voor predictions. Bij training
--                   wordt het oude model gedeactiveerd in dezelfde tx.

CREATE TABLE IF NOT EXISTS talent_fit_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  coefficients    JSONB NOT NULL,
  feature_names   TEXT[] NOT NULL,
  trained_on      INTEGER NOT NULL,
  hires           INTEGER NOT NULL,
  rejects         INTEGER NOT NULL,
  precision_at_1  NUMERIC(5,4),
  recall_at_10    NUMERIC(5,4),
  auc             NUMERIC(5,4),
  trained_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  trained_by      TEXT NOT NULL DEFAULT 'cron',
  active          BOOLEAN NOT NULL DEFAULT TRUE
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'talent_fit_models_trained_on_check'
  ) THEN
    ALTER TABLE talent_fit_models
      ADD CONSTRAINT talent_fit_models_trained_on_check
      CHECK (trained_on >= 0 AND hires >= 0 AND rejects >= 0);
  END IF;
END $$;

ALTER TABLE talent_fit_models ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'talent_fit_models'
      AND policyname = 'tenant_isolation_talent_fit_models'
  ) THEN
    CREATE POLICY tenant_isolation_talent_fit_models ON talent_fit_models
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- "Welk active model heeft deze tenant?" — meest gebruikte query.
CREATE INDEX IF NOT EXISTS idx_talent_fit_models_tenant_active_trained
  ON talent_fit_models(tenant_id, active, trained_at DESC);

-- "Geschiedenis van getrainde modellen voor compliance / drift-check".
CREATE INDEX IF NOT EXISTS idx_talent_fit_models_tenant_trained
  ON talent_fit_models(tenant_id, trained_at DESC);

-- =========================================================================
-- B) TALENT_FIT_PREDICTIONS — cache van per-(job,candidate) predictions
-- =========================================================================
--
-- combined_score = 0.6 * cosine_similarity + 0.4 * fit_score (0..1).
-- feature_values bewaart de ruwe features per prediction zodat we
-- explainability / debugging hebben zonder de berekening opnieuw te draaien.
-- similar_hires = top-3 candidate-ids van historische hires die op deze
-- kandidaat lijken (cosine op embedding).

CREATE TABLE IF NOT EXISTS talent_fit_predictions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  model_id        UUID NOT NULL REFERENCES talent_fit_models(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  fit_score       NUMERIC(5,4) NOT NULL,
  combined_score  NUMERIC(5,4) NOT NULL,
  feature_values  JSONB,
  similar_hires   UUID[] DEFAULT '{}',
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'talent_fit_predictions_score_range_check'
  ) THEN
    ALTER TABLE talent_fit_predictions
      ADD CONSTRAINT talent_fit_predictions_score_range_check
      CHECK (
        fit_score      >= 0 AND fit_score      <= 1
        AND combined_score >= 0 AND combined_score <= 1
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'uq_talent_fit_predictions_model_job_candidate'
  ) THEN
    CREATE UNIQUE INDEX uq_talent_fit_predictions_model_job_candidate
      ON talent_fit_predictions(tenant_id, model_id, job_id, candidate_id);
  END IF;
END $$;

ALTER TABLE talent_fit_predictions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'talent_fit_predictions'
      AND policyname = 'tenant_isolation_talent_fit_predictions'
  ) THEN
    CREATE POLICY tenant_isolation_talent_fit_predictions ON talent_fit_predictions
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- "Top-N kandidaten voor een job" via combined_score DESC.
CREATE INDEX IF NOT EXISTS idx_talent_fit_predictions_tenant_job_combined
  ON talent_fit_predictions(tenant_id, job_id, combined_score DESC);

-- "Predictions voor een kandidaat" (candidate-detail page).
CREATE INDEX IF NOT EXISTS idx_talent_fit_predictions_tenant_candidate_combined
  ON talent_fit_predictions(tenant_id, candidate_id, combined_score DESC);

-- 043_ai_action_proposals.sql
-- EU AI Act — human-oversight-gate (art. 14: menselijke controle op
-- geautomatiseerde besluitvorming in high-risk recruitment-AI).
--
-- Achtergrond: de workflow-engine kan met een `move_to_stage`-actie een
-- sollicitatie AUTOMATISCH naar een afwijzings-stage verplaatsen. Dat is een
-- geautomatiseerd negatief besluit zonder menselijke tussenkomst. Vanaf deze
-- migratie worden zulke acties niet meer direct uitgevoerd, maar als
-- VOORSTEL (`pending_review`) in deze tabel gezet. Een recruiter bevestigt
-- of verwerpt het voorstel in de UI; pas bij bevestiging wordt de actie
-- daadwerkelijk toegepast. Beslissingen worden gelogd in `audit_events`
-- (append-only, migration 008) met wie/wanneer/welk voorstel.
--
-- Kolommen bewust ruim (TEXT) — smal is een bug die wacht.
-- Volledig idempotent: herhaald draaien is een no-op.

CREATE TABLE IF NOT EXISTS ai_action_proposals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Bron van het voorstel: 'workflow' (nu), later evt. 'matching'/'nurture'.
  source        TEXT NOT NULL DEFAULT 'workflow',
  -- Id van de bron (workflow id). Geen FK — de bron mag verdwijnen zonder
  -- dat het voorstel-archief breekt.
  source_id     UUID,
  -- Actietype zoals de workflow-engine het kent ('move_to_stage', 'reject_application').
  action_type   TEXT NOT NULL,
  -- Originele action-config (stage_id/stage_name/...) zodat de actie bij
  -- goedkeuring exact zo uitgevoerd kan worden als voorgesteld.
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Trigger-event dat het voorstel veroorzaakte (bv. 'candidate.stage_changed').
  trigger_event TEXT,
  -- Entiteit waarop de actie zou werken. Voor reject-moves: de application.
  entity_type   TEXT NOT NULL DEFAULT 'application',
  entity_id     UUID NOT NULL,
  -- Denormalisatie voor de review-UI (geen joins door de workflow-runner heen).
  candidate_id  UUID,
  job_id        UUID,
  -- Mens-leesbare reden waarom dit voorstel review vereist.
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending_review',
  proposed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ,
  decided_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  decision_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_action_proposals_status_check'
  ) THEN
    ALTER TABLE ai_action_proposals
      ADD CONSTRAINT ai_action_proposals_status_check
      CHECK (status IN ('pending_review', 'approved', 'rejected', 'failed'));
  END IF;
END $$;

-- Max één openstaand voorstel per (bron, actietype, entiteit) — voorkomt dat
-- een workflow die N keer triggert N duplicaten in de review-wachtrij zet.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_action_proposals_pending
  ON ai_action_proposals(tenant_id, source, action_type, entity_id)
  WHERE status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_ai_action_proposals_tenant_status
  ON ai_action_proposals(tenant_id, status, proposed_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_action_proposals_tenant_candidate
  ON ai_action_proposals(tenant_id, candidate_id);

-- RLS conform het geharde patroon uit 036/037/042: ENABLE + FORCE, policy
-- met USING én WITH CHECK op app.tenant_id.
ALTER TABLE ai_action_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_action_proposals FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ai_action_proposals'
      AND policyname = 'tenant_isolation_ai_action_proposals'
  ) THEN
    CREATE POLICY tenant_isolation_ai_action_proposals ON ai_action_proposals
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ─── Retentie-notitie (EU AI Act art. 12/19 — logging ≥ 6 maanden) ──────────
-- `ai_events` is WORM (migration 008: UPDATE/DELETE hard geblokkeerd via
-- trigger) en wordt door GEEN enkele retention-/cleanup-job opgeruimd; de
-- retention-worker (compliance/retention.service.ts) raakt uitsluitend
-- `candidates`. De 6-maanden-minimumbewaartermijn is daarmee structureel
-- gegarandeerd. Deze proposals-tabel is bewust NIET WORM: de status-kolom
-- muteert (pending → approved/rejected); het onveranderlijke bewijs van de
-- menselijke beslissing staat in `audit_events` (wel WORM).

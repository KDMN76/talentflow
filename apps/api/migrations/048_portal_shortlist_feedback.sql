-- 048_portal_shortlist_feedback.sql
-- Klantportaal voor shortlist-feedback (roadmap-item).
--
-- Drie wijzigingen op de bestaande portal-tabellen uit migration 010:
--   1) guest_portal_feedback.action krijgt 'doubt' erbij — de klant kan per
--      kandidaat ✓ Geschikt / ✗ Niet geschikt / ? Twijfel geven.
--   2) guest_portal_feedback.application_id wordt nullable — een "algemene
--      opmerking" over de hele shortlist is niet aan één kandidaat gebonden.
--   3) portal_activity_log action-check krijgt 'doubted' en 'general_comment'
--      erbij zodat de recruiter-feed deze events kan tonen.
--
-- Idempotent: constraints worden drop-en-add herschreven binnen guards;
-- DROP NOT NULL is van nature idempotent.

-- 1) + 2) guest_portal_feedback
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guest_portal_feedback_action_check'
  ) THEN
    ALTER TABLE guest_portal_feedback
      DROP CONSTRAINT guest_portal_feedback_action_check;
  END IF;
  ALTER TABLE guest_portal_feedback
    ADD CONSTRAINT guest_portal_feedback_action_check
    CHECK (action IN ('approved', 'rejected', 'commented', 'doubt'));
END $$;

ALTER TABLE guest_portal_feedback
  ALTER COLUMN application_id DROP NOT NULL;

-- Algemene opmerking vereist wél tekst: zonder kandidaat én zonder comment
-- is een feedback-rij betekenisloos.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guest_portal_feedback_general_comment_check'
  ) THEN
    ALTER TABLE guest_portal_feedback
      ADD CONSTRAINT guest_portal_feedback_general_comment_check
      CHECK (application_id IS NOT NULL OR comment IS NOT NULL);
  END IF;
END $$;

-- Feedback per applicatie snel kunnen groeperen in de publieke serialisatie.
CREATE INDEX IF NOT EXISTS idx_guest_portal_feedback_link_application
  ON guest_portal_feedback(portal_link_id, application_id, created_at);

-- 3) portal_activity_log
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'portal_activity_log_action_check'
  ) THEN
    ALTER TABLE portal_activity_log
      DROP CONSTRAINT portal_activity_log_action_check;
  END IF;
  ALTER TABLE portal_activity_log
    ADD CONSTRAINT portal_activity_log_action_check
    CHECK (action IN (
      'viewed_portal',
      'viewed_candidate',
      'accepted',
      'rejected',
      'doubted',
      'commented',
      'general_comment',
      'downloaded_cv',
      'viewed_resume',
      'viewed_pipeline_history'
    ));
END $$;

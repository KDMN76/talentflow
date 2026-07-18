-- =========================================================================
-- 058_commission_records_reversed_status.sql
--
-- Bug-fix: voiding a `sent` invoice never reversed already-recorded
-- commissions (commission_records tied to that invoice kept status
-- 'pending'/'approved' with zero trace that the underlying invoice was
-- voided). `invoicing.service.voidInvoice()` now reverses `pending`/
-- `approved` commission_records to a new 'reversed' status and blocks
-- voiding when a tied commission_record is already 'paid' (clawback out of
-- scope — see invoicing.service.ts voidInvoice() comment).
--
-- Idempotent (IF NOT EXISTS / DO $$ guard), no DROP.
-- =========================================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commission_records_status_check'
  ) THEN
    ALTER TABLE commission_records
      DROP CONSTRAINT commission_records_status_check;
  END IF;
  ALTER TABLE commission_records
    ADD CONSTRAINT commission_records_status_check
    CHECK (status IN ('pending','approved','paid','disputed','reversed'));
END $$;

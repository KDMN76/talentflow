-- 039_inbox_thread_soft_delete.sql
-- Sectie 4.14a — soft-delete voor unified_threads.
--
-- Een verwijderde thread blijft in de database staan (audit + eventueel herstel)
-- maar verdwijnt uit de inbox-lijst. Idempotent: veilig om opnieuw te draaien.

ALTER TABLE unified_threads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Versnelt de default lijst-query die verwijderde threads uitsluit.
CREATE INDEX IF NOT EXISTS idx_unified_threads_tenant_active
  ON unified_threads (tenant_id, last_message_at DESC NULLS LAST, id DESC)
  WHERE deleted_at IS NULL;

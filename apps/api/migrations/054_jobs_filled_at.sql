-- 054_jobs_filled_at.sql
-- Legt het moment vast waarop een vacature 'filled' (vervuld) raakt, zodat
-- time-to-hire correct berekend kan worden.
--
-- Waarom: de report-aggregator (lib/reports/aggregator.ts, metric time_to_hire)
-- rekende met `jobs.filled_at`, maar die kolom bestond niet → elke rapport-run
-- met die metric gooide "column j.filled_at does not exist" (2 system-templates
-- faalden). De analytics-service gebruikte `close_date` als proxy — maar dat is
-- een handmatig ingevulde sluitingsdatum, niet het hire-moment, en telt ook
-- niet-hire-sluitingen mee. `filled_at` = het echte moment van status→'filled'.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). De service (jobs.service.ts) zet
-- filled_at voortaan op de status→'filled'-transitie. Deze migratie backfillt
-- bestaande 'filled'-vacatures: primair uit het JOB_FILLED-audit-event
-- ('job.filled'), anders uit updated_at als benadering.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS filled_at TIMESTAMPTZ;

-- Backfill: alleen rijen die nu al 'filled' zijn en nog geen filled_at hebben.
-- Idempotent door de WHERE filled_at IS NULL — herhaald draaien is een no-op.
UPDATE jobs j
   SET filled_at = COALESCE(
     (SELECT MIN(e.created_at)
        FROM audit_events e
       WHERE e.entity_type = 'job'
         AND e.entity_id = j.id
         AND e.action = 'job.filled'),
     j.updated_at
   )
 WHERE j.status = 'filled'
   AND j.filled_at IS NULL;

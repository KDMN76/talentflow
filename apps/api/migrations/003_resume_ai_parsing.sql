-- 003_resume_ai_parsing.sql
-- Uitbreiding van candidate_resumes met AI-parsing kolommen + storage_key.
-- Volgt KDMN-conventie: idempotent (IF NOT EXISTS / DO $$ guards),
-- snake_case, defensieve constraint-creatie via pg_constraint checks.

-- =========================================================================
-- 1) CANDIDATE_RESUMES — AI parsing kolommen
-- =========================================================================

-- 3-regel samenvatting van de AI (Claude/OpenAI), nullable tot parse done is.
ALTER TABLE candidate_resumes ADD COLUMN IF NOT EXISTS ai_summary TEXT;

-- Ruwe geextraheerde tekst (volledige text dump uit pdf-parse / mammoth).
ALTER TABLE candidate_resumes ADD COLUMN IF NOT EXISTS parsed_text TEXT;

-- Status van de parser-pipeline. Default 'pending'.
-- We voegen eerst de kolom toe (met een veilige default), dan defensief de
-- CHECK-constraint via een DO-block zodat herhaalde runs niet falen.
ALTER TABLE candidate_resumes
  ADD COLUMN IF NOT EXISTS parse_status TEXT NOT NULL DEFAULT 'pending';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidate_resumes_parse_status_check'
  ) THEN
    ALTER TABLE candidate_resumes
      ADD CONSTRAINT candidate_resumes_parse_status_check
      CHECK (parse_status IN ('pending', 'processing', 'done', 'failed'));
  END IF;
END $$;

-- Foutbericht als parse_status='failed'. Nullable.
ALTER TABLE candidate_resumes ADD COLUMN IF NOT EXISTS parse_error TEXT;

-- Storage-sleutel los van de URL. NULLABLE want bestaande rijen hebben dit
-- niet. Nieuwe code zet 'm altijd in. Format:
-- tenants/<tenantId>/candidates/<candidateId>/resumes/<resumeId>__<safeFilename>
ALTER TABLE candidate_resumes ADD COLUMN IF NOT EXISTS storage_key TEXT;

-- Index op parse_status zodat de worker snel pending-jobs kan tellen / herstarten.
CREATE INDEX IF NOT EXISTS idx_candidate_resumes_parse_status
  ON candidate_resumes(parse_status);

-- =========================================================================
-- 2) CANDIDATES — current_position / current_company
-- Manatal-pariteit (Live Tour identificeerde deze als kernvelden). De AI-parser
-- vult deze in vanuit het CV; manual edits via candidates.service.ts blijven mogelijk.
-- =========================================================================

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_position TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_company  TEXT;

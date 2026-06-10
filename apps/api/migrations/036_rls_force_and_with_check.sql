-- 036_rls_force_and_with_check.sql
-- Fase 0 — RLS-hardening, laag 1 van 2: maak het policy-vlak CORRECT en VOLLEDIG.
--
-- Audit-bevindingen (2026-06-10) op de live dev-DB:
--   * 119 tenant-tabellen hebben RLS *enabled*, maar 0 hebben FORCE.
--   * 73 tenant-tabellen hebben op géén enkele policy een WITH CHECK — d.w.z.
--     een INSERT/UPDATE met een vréémd tenant_id wordt door de policy niet
--     tegengehouden (alleen reads zijn gefilterd via USING).
--
-- Deze migratie:
--   1. Zet FORCE ROW LEVEL SECURITY op elke tabel met een tenant_id-kolom en
--      RLS aan. FORCE zorgt dat óók de tabel-eigenaar aan RLS onderworpen is
--      (zonder FORCE bypasst de owner RLS standaard).
--   2. Spiegelt op elke tenant-isolatie-policy de USING-expressie naar
--      WITH CHECK, zodat schrijfacties exact dezelfde tenant-grens krijgen als
--      leesacties. pg_get_expr() kopieert de bestaande expressie letterlijk —
--      dus policies met afwijkende vorm krijgen hun eigen check, niet een
--      hardgecodeerde aanname.
--
-- BELANGRIJK — dit is een NO-OP zolang de applicatie als `neondb_owner`
-- verbindt: die rol heeft het attribuut BYPASSRLS, dat ALTIJD voorrang heeft,
-- óók boven FORCE. Echte afdwinging vereist een non-owner, non-BYPASSRLS rol
-- (laag 2 — zie docs/RLS_HARDENING.md voor de productie-cutover). Deze
-- migratie is daarom veilig te draaien vóór die cutover: ze breekt niets en
-- legt het fundament zodat de rol-omschakeling waterdicht is.
--
-- Volledig idempotent: herhaald draaien herstelt slechts ontbrekende FORCE/
-- WITH CHECK en laat al-correcte policies ongemoeid.

DO $$
DECLARE
  r RECORD;
  forced_count INT := 0;
  check_count  INT := 0;
BEGIN
  -- 1) FORCE ROW LEVEL SECURITY op elke tenant-tabel met RLS aan.
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity            -- RLS enabled
      AND NOT c.relforcerowsecurity   -- nog niet forced
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'tenant_id'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.relname);
    forced_count := forced_count + 1;
  END LOOP;

  -- 2) WITH CHECK := USING voor elke schrijfbare tenant-policy die het mist.
  --    polcmd: '*' = ALL, 'a' = INSERT, 'w' = UPDATE — alleen die accepteren
  --    een WITH CHECK (SELECT/DELETE niet).
  FOR r IN
    SELECT pol.polname,
           cls.relname,
           pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
    FROM pg_policy pol
    JOIN pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    WHERE n.nspname = 'public'
      AND pol.polwithcheck IS NULL         -- WITH CHECK ontbreekt
      AND pol.polqual IS NOT NULL          -- maar er is wél een USING
      AND pol.polcmd IN ('*', 'a', 'w')    -- en de policy accepteert WITH CHECK
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = cls.relname
          AND col.column_name = 'tenant_id'
      )
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON public.%I WITH CHECK (%s)',
      r.polname, r.relname, r.using_expr
    );
    check_count := check_count + 1;
  END LOOP;

  RAISE NOTICE '036: FORCE gezet op % tabellen, WITH CHECK toegevoegd aan % policies', forced_count, check_count;
END $$;

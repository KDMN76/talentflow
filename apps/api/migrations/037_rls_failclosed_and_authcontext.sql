-- 037_rls_failclosed_and_authcontext.sql
-- Fase 0 — RLS-hardening, laag 2-voorbereiding: maak het policy-vlak
-- (a) fail-closed bij een lege tenant-context en (b) bruikbaar voor de
-- auth-flow onder een non-owner-rol.
--
-- Achtergrond (bewezen met scripts/rls-isolation-proof.cjs op een non-owner
-- rol):
--   * De policy-expressie `current_setting('app.tenant_id', true)::uuid` GOOIT
--     een fout op een lege GUC ("invalid input syntax for type uuid") i.p.v.
--     stil 0 rijen te geven. Geen lek, maar onvoorspelbaar (500's). We wikkelen
--     de GUC in nullif(...) → lege context wordt NULL → 0 rijen (fail-closed).
--   * De auth-flow doet drie secret-key-lookups die per definitie GEEN
--     tenant-context kunnen hebben: refresh-token op token_hash, api-key op
--     key_hash (+ de JOIN naar users daarbij). Onder een non-owner-rol zouden
--     die 0 rijen geven. We voegen op exact die tabellen een READ-uitzondering
--     toe: `OR app.auth_context = 'on'`. De applicatie zet die GUC uitsluitend
--     in de auth-helper (withAuthTx({authContext:true})). De WITH CHECK op
--     schrijfacties blijft ALTIJD strikt tenant-gebonden — auth_context
--     verruimt enkel reads.
--
-- No-op zolang de app als BYPASSRLS-owner verbindt. Volledig idempotent
-- (strpos-guards + NOT LIKE-guards voorkomen dubbele toepassing).

DO $$
DECLARE
  r RECORD;
  frag        CONSTANT text := '(current_setting(''app.tenant_id''::text, true))::uuid';
  frag_nullif CONSTANT text := '(nullif(current_setting(''app.tenant_id''::text, true), ''''::text))::uuid';
  new_using text;
  new_check text;
  hardened  INT := 0;
  carved    INT := 0;
BEGIN
  -- 1) Fail-closed: vervang de directe ::uuid-cast door een nullif-variant in
  --    zowel USING als WITH CHECK van elke policy die 'm bevat.
  FOR r IN
    SELECT pol.polname, cls.relname,
           pg_get_expr(pol.polqual, pol.polrelid)      AS using_expr,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr,
           pol.polwithcheck IS NOT NULL                AS has_check
    FROM pg_policy pol
    JOIN pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    WHERE n.nspname = 'public'
      AND strpos(pg_get_expr(pol.polqual, pol.polrelid), frag) > 0
  LOOP
    new_using := replace(r.using_expr, frag, frag_nullif);
    IF r.has_check THEN
      new_check := replace(r.check_expr, frag, frag_nullif);
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)',
                     r.polname, r.relname, new_using, new_check);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)',
                     r.polname, r.relname, new_using);
    END IF;
    hardened := hardened + 1;
  END LOOP;

  -- 2) auth_context-carve-out op de secret-key-lookup-tabellen. Verruimt enkel
  --    USING (reads); WITH CHECK blijft ongemoeid en dus strikt.
  FOR r IN
    SELECT pol.polname, cls.relname,
           pg_get_expr(pol.polqual, pol.polrelid)      AS using_expr,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr,
           pol.polwithcheck IS NOT NULL                AS has_check
    FROM pg_policy pol
    JOIN pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    WHERE n.nspname = 'public'
      AND cls.relname IN ('refresh_tokens', 'users', 'api_keys')
      AND strpos(pg_get_expr(pol.polqual, pol.polrelid), 'auth_context') = 0
  LOOP
    new_using := '(' || r.using_expr ||
                 ' OR nullif(current_setting(''app.auth_context''::text, true), ''''::text) = ''on'')';
    IF r.has_check THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)',
                     r.polname, r.relname, new_using, r.check_expr);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)',
                     r.polname, r.relname, new_using);
    END IF;
    carved := carved + 1;
  END LOOP;

  RAISE NOTICE '037: % policies fail-closed gemaakt, % auth_context-carve-outs gezet', hardened, carved;
END $$;

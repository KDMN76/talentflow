# RLS Hardening — Productie-cutover-runbook

Security-runbook voor de TalentFlow multi-tenant SaaS. Dit document beschrijft de
overgang naar echt door de database afgedwongen tenant-isolatie via Row-Level
Security (RLS).

---

## Bevinding

TalentFlow (Node/Express + PostgreSQL op Neon dev / Hetzner-Docker prod) is
multi-tenant met RLS-policies op 119 tenant-tabellen.

**Kritische bevinding:** de applicatie verbindt als DB-rol `neondb_owner`, en die
rol heeft het attribuut `BYPASSRLS`. `BYPASSRLS` heeft **altijd** voorrang — óók
boven `FORCE ROW LEVEL SECURITY`. Daardoor waren de RLS-policies feitelijk
**inert**: tenant-isolatie leunde volledig op de `WHERE tenant_id = $1`-clausules
in de applicatiecode. Echte DB-afdwinging vereist een NON-owner, NON-BYPASSRLS
rol.

---

## Wat is geïmplementeerd

Op branch `fix/demo-vrijdag`:

- **Migratie `apps/api/migrations/036_rls_force_and_with_check.sql`**: zet
  `FORCE ROW LEVEL SECURITY` op alle 119 tenant-tabellen en voegt `WITH CHECK`
  toe aan elke schrijfbare tenant-policy (spiegelt `USING` → `WITH CHECK`).
  Idempotent.
- **Migratie `apps/api/migrations/037_rls_failclosed_and_authcontext.sql`**:
  - (a) maakt policies fail-closed door de tenant-GUC te wikkelen in
    `nullif(current_setting('app.tenant_id', true), '')::uuid` (lege context →
    `NULL` → 0 rijen i.p.v. een cast-error);
  - (b) voegt een READ-uitzondering toe op exact 3 secret-key-lookup-tabellen
    (`refresh_tokens`, `users`, `api_keys`):
    `... OR nullif(current_setting('app.auth_context', true), '') = 'on'`.
    De `WITH CHECK` op die tabellen blijft strikt tenant-gebonden
    (`auth_context` verruimt enkel reads). Idempotent.
- **Code `apps/api/src/db/pool.ts`**: nieuwe helper `withAuthTx(fn, {authContext})`
  — wikkelt de auth-flow in een echte transactie (nodig zodat
  `SET LOCAL app.tenant_id` over meerdere statements werkt) en zet optioneel
  `SET LOCAL app.auth_context = 'on'` voor de secret-key-lookups.
- **`apps/api/src/modules/auth/auth.service.ts`**: `login` / `register` /
  `issueSessionForUser` / `logout` gebruiken nu `withAuthTx`; `refreshAccessToken`
  doet de hash-lookup in `withAuthTx({authContext:true})` en alle schrijfacties
  tenant-scoped via `withTenant`.
- **`apps/api/src/middleware/auth.ts`**: de api-key-lookup op `key_hash` draait in
  `withAuthTx({authContext:true})`; de usage-log/last_used-writes lopen al
  tenant-scoped via `withTenant`.

> Dit alles is een **NO-OP** zolang de app als BYPASSRLS-owner verbindt; het wordt
> pas actief na de rol-cutover hieronder.

---

## Bewijs op dev

Al uitgevoerd op dev; scripts in `apps/api/scripts/`:

- **`rls-audit.cjs`**: rapporteert FORCE/WITH CHECK-status (na 036: 119/119
  forced, 0 zonder WITH CHECK).
- **`rls-isolation-proof.cjs`**: maakt een tijdelijke NOBYPASSRLS-rol en bewijst:
  tenant A ziet enkel eigen rijen, tenant B ziet 0 van A, geen-context =
  geweigerd, cross-tenant INSERT geblokkeerd, eigen-tenant INSERT toegestaan.
- **`rls-e2e-role.cjs create|drop`**: maakt/dropt de non-owner rol `tf_app_e2e`
  met de exacte grants. Met deze rol is de ECHTE app gebooted (op poort 4010) en
  gesmoke-test: login + refresh-rotatie werkten, 20 endpoints gaven 0× HTTP 500,
  candidates-read=12, candidate-write=201. Bewezen dat de app correct functioneert
  onder afgedwongen RLS.

---

## Cutover-stappen

Productie, user-led.

### Stap 1 — Maak de applicatierol aan op de productie-DB

Verbonden als owner/admin:

```sql
CREATE ROLE talentflow_app LOGIN PASSWORD '<sterk-gegenereerd-wachtwoord>' NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO talentflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO talentflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO talentflow_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO talentflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO talentflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO talentflow_app;
```

### Stap 2 — Zorg dat migraties 036 + 037 zijn toegepast

Idempotent; via de bestaande migrate-runner:

```bash
# In de container
node /app/dist/db/migrate.js
```

```bash
# Of lokaal/dev
npx tsx src/db/migrate.ts
```

### Stap 3 — Wissel de `DATABASE_URL` om naar de nieuwe rol

Zelfde host/db, andere `user:password`. Op Hetzner: in de env/compose van de
api-container.

> **LET OP:** dit is een build-time/runtime env — herstart/redeploy de
> api-container.

### Stap 4 — Smoke-test op productie

- `login` → 200 + `accessToken`
- `POST /api/auth/refresh` → 200, nieuwe cookie
- `GET /api/candidates` → 200

### Stap 5 — Optioneel: isolatie-bewijs tegen productie

Draai een variant van `rls-isolation-proof.cjs` tegen productie ter bevestiging.

---

## Rollback

- Zet `DATABASE_URL` terug naar de owner-rol en herstart de api-container.
- Omdat 036/037 no-ops zijn onder `BYPASSRLS`, is er geen schema-rollback nodig.
- De rol `talentflow_app` kan blijven bestaan.

---

## Aandachtspunten

- **Wachtwoordbeheer:** het rol-wachtwoord is een nieuw secret — bewaar in de
  secrets-store, niet in git.
- **`auth_context`-GUC:** wordt UITSLUITEND gezet in `withAuthTx({authContext:true})`
  (auth.service refresh/logout + api-key-middleware). Voeg nooit lukraak
  `SET app.auth_context` toe elders — dat zou de READ-isolatie op
  `refresh_tokens` / `users` / `api_keys` omzeilen.
- **Fail-closed gedrag:** onder de non-owner rol faalt een query ZONDER
  tenant-context fail-closed (0 rijen) door de nullif-hardening; een paar tabellen
  zonder die hardening zouden een 500 geven — alle reguliere endpoints gebruiken
  echter `withTenant`.
- **Neon-specifiek:** extra rollen kunnen via SQL worden aangemaakt en kunnen
  direct verbinden (bewezen op dev).

---

## Verificatie-commando's

Vanuit `apps/api/scripts/`:

```bash
# 1. FORCE/WITH CHECK-status rapporteren (verwacht na 036: 119/119 forced, 0 zonder WITH CHECK)
node rls-audit.cjs

# 2. Isolatie bewijzen via tijdelijke NOBYPASSRLS-rol
node rls-isolation-proof.cjs

# 3. Non-owner rol tf_app_e2e aanmaken/droppen voor end-to-end smoke-test
node rls-e2e-role.cjs create
node rls-e2e-role.cjs drop
```

# RLS Hardening — Productie-cutover-runbook

Security-runbook voor de TalentFlow multi-tenant SaaS. Dit document beschrijft de
overgang naar echt door de database afgedwongen tenant-isolatie via Row-Level
Security (RLS).

> ## ✅ CUTOVER UITGEVOERD — 2026-07-08
> Productie draait sinds 2026-07-08 onder de non-owner rol **`talentflow_app`**
> (`NOSUPERUSER NOBYPASSRLS`). RLS wordt nu écht door de database afgedwongen;
> tenant-isolatie leunt niet langer alleen op de app-laag. Vooraf: verse
> Postgres-dump naar R2 (`postgres-2026-07-08-1827.sql.gz`, 337 MB). Isolatie-
> probe onder de rol bewees: reads mét context werken (incl. de nieuwe tabellen
> `ai_action_proposals`/`tenant_module_settings`/`data_export_tokens`),
> cross-tenant = 0 rijen, geen context = 0 rijen (fail-closed, geen 500). Live
> smoke ná cutover: login 200, **refresh 200** (auth_context-pad), POST
> /candidates 201 (WITH CHECK), candidates/jobs/dashboard 200.
>
> - `DATABASE_URL` in `infra/.env.prod` wijst nu naar `talentflow_app`.
> - De owner-URL staat als `MIGRATE_DATABASE_URL` in `.env.prod` — **toekomstige
>   migraties draaien met die URL** (de app-rol kan geen DDL): zie "Toekomstige
>   migraties ná de cutover" onderaan.
> - Rollback (indien ooit nodig): zet `DATABASE_URL` terug op de owner-waarde uit
>   `infra/.env.prod.bak-rlscutover` en `./infra/deploy.sh up -d --no-deps
>   --force-recreate api api-worker`.
> - Het rol-wachtwoord staat alleen in `infra/.env.prod` (chmod 600) op de VPS.

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

## Productie-specifiek (Hetzner — self-hosted Postgres in Docker)

Productie draait **niet** op Neon maar op een self-hosted `pgvector/pgvector:pg16`-
container (`talentflow-postgres`). De app verbindt als rol `${POSTGRES_USER}`
(= `talentflow`), die door het officiële postgres-image als **SUPERUSER** is
aangemaakt. Een superuser bypasst RLS altijd (ook boven FORCE) — exact dezelfde
situatie als de Neon-owner. De cutover-mechaniek is identiek; de paste-klare
commando's hieronder zijn afgestemd op `infra/docker-compose.prod.yml` +
`infra/.env.prod` + de `./infra/deploy.sh`-wrapper.

> **Volgorde-eis:** migraties vereisen DDL-rechten (owner); de app-rol krijgt
> alleen DML. Draai migraties dus **als owner** vóór je `DATABASE_URL` omwisselt.

### A — Deploy de branch + migraties (als owner)
```bash
# Op de VPS, in de repo-root van talentflow:
git fetch && git checkout fix/demo-vrijdag && git pull
./infra/deploy.sh build api web && ./infra/deploy.sh up -d
# Migraties 033 t/m 037 toepassen (idempotent), nog als owner:
./infra/deploy.sh exec -T api node /app/dist/db/migrate.js
```

### B — Maak de non-superuser app-rol aan
```bash
# Laad de prod-env in je shell (voor $POSTGRES_USER/$POSTGRES_DB):
set -a; . infra/.env.prod; set +a
# Genereer een sterk wachtwoord en NOTEER het (komt zo in .env.prod):
APP_PW=$(openssl rand -base64 24); echo "talentflow_app wachtwoord: $APP_PW"

./infra/deploy.sh exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE ROLE talentflow_app LOGIN PASSWORD '${APP_PW}'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO talentflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO talentflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO talentflow_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO talentflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO talentflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO talentflow_app;
SQL
```

### C — Wissel `DATABASE_URL` om in `infra/.env.prod`
```
# Nieuw (runtime app-rol) — let op: poort 5432 binnen het docker-netwerk:
DATABASE_URL=postgresql://talentflow_app:<APP_PW>@postgres:5432/talentflow
# Bewaar de owner-URL apart voor toekomstige migraties:
MIGRATE_DATABASE_URL=postgresql://talentflow:<POSTGRES_PASSWORD>@postgres:5432/talentflow
```

### D — Herstart enkel de api (migrate NIET opnieuw)
```bash
./infra/deploy.sh up -d --no-deps --force-recreate api
```

### E — Smoke-test live
```bash
curl -s -o /dev/null -w "health %{http_code}\n" https://talentflow.kdmn.nl/api/health
# + login (200 + accessToken), POST /api/auth/refresh (200), GET /api/candidates (200)
```

### Toekomstige migraties ná de cutover
De app-rol kan geen DDL. Draai migraties expliciet met de owner-URL:
```bash
./infra/deploy.sh exec -T \
  -e DATABASE_URL="postgresql://talentflow:<POSTGRES_PASSWORD>@postgres:5432/talentflow" \
  api node /app/dist/db/migrate.js
```

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

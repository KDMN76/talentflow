# Docker & deploy — TalentFlow

Dit document legt de impliciete kennis vast achter `apps/api/Dockerfile`,
`apps/web/Dockerfile` en `infra/docker-compose.prod.yml`. Die bestanden zitten
vol valkuilen die we tijdens Sub-fase 2A en het productie-incident van
2026-05-18..21 één voor één hebben ontdekt. Lees dit vóór je iets aan de
Dockerfiles of compose-config wijzigt.

## TL;DR — hoe deploy ik?

```bash
# Op de VPS, in /opt/talentflow:
git pull
./infra/deploy.sh build web         # of build api / build (alles)
./infra/deploy.sh up -d              # start/herstart met nieuwe images
./infra/deploy.sh ps                 # status
./infra/deploy.sh logs -f api        # logs volgen
```

**Gebruik `./infra/deploy.sh`, nooit `docker compose` rechtstreeks.** De wrapper
injecteert altijd `--env-file infra/.env.prod`. Zie §6.

Migraties (apart, na een API-deploy met schema-wijzigingen):

```bash
./infra/deploy.sh exec -T api node /app/dist/db/migrate.js
```

> `node dist/db/migrate.js`, **niet** `npm run migrate` — `tsx` is in de runtime
> image weg-geprund, dus het npm-script (dat `tsx` aanroept) faalt daar.

## 1. Build-context is de monorepo-root, niet `apps/<svc>`

Beide services bouwen met `context: ..` (de repo-root) in plaats van hun eigen
app-map:

```yaml
api:
  build:
    context: ..
    dockerfile: apps/api/Dockerfile
```

**Waarom:** de Dockerfiles moeten `packages/contracts/` mee kunnen `COPY`en (de
shared Zod-schemas). Dat package leeft buiten `apps/<svc>`, dus de build-context
moet hoog genoeg zijn om er bij te kunnen. Gevolg: alle `COPY`-paden in de
Dockerfiles zijn relatief aan de repo-root (`COPY apps/api/... `, niet
`COPY src/...`).

## 2. npm-workspaces hoisten `node_modules` naar de root

In een npm-workspaces monorepo worden dependencies gehoist naar de
root-`node_modules`; per-app `node_modules` bestaan grotendeels niet. In de
builder-stage betekent dit dat een `npm ci` op de root alles installeert. Reken
er niet op dat `apps/web/node_modules` of `apps/api/node_modules` los bestaan.

Concreet gevolg dat ons eerder beet: een peer-dependency (bv. `react-is` voor
recharts) die productie via `--legacy-peer-deps` wél hoist maar lokaal niet —
los je op door de dep expliciet als directe dependency toe te voegen, niet door
op hoisting te vertrouwen.

## 3. Next.js standalone-tracer in monorepo-modus

`apps/web` bouwt met `output: 'standalone'` + `transpilePackages:
['@talentflow/contracts']`. De standalone-tracer produceert een zelf-bevattende
bundle, maar in een monorepo verhuist hij `node_modules` en static-assets naar
een geneste `apps/web/`-structuur binnen de output, terwijl de gegenereerde
`server.js` op de root van de bundle landt.

**Gevolg:** je moet `node_modules` soms fysiek naar de verwachte plek `cp -r`en;
een symlink is niet genoeg omdat de tracer hem niet volgt.

## 4. Static-asset paden: server.js zoekt op een ander pad dan Next bouwt

Dit veroorzaakte het productie-incident (witte pagina, 3 dagen):

- Next bouwt static naar `/app/apps/web/.next/static`.
- De standalone `server.js` (op `/app/server.js`) zoekt ze op `/app/.next/static`.

Mismatch → alle client-bundles 404'en terwijl de HTML wél geserveerd wordt.
**Fix (zie `apps/web/Dockerfile`):** kopieer static naar **beide** paden:

```dockerfile
COPY --from=builder ... /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder ... /app/apps/web/.next/static ./.next/static
```

Wijzig je de Dockerfile, behoud dan beide COPY-regels.

## 5. `npm prune` moet op de monorepo-root

`npm prune --workspaces` (om devDependencies uit de runtime image te halen) MOET
op de monorepo-root draaien. Draai je hem in een workspace-subdir, dan faalt hij
op een registry-lookup van de `workspace:`-protocol deps (die alleen vanuit de
root resolven).

## 6. Env-vars: waarom `deploy.sh` bestaat

Op 2026-05-21 ging tweemaal op één dag dezelfde fout mis: een `docker compose`
zonder `--env-file infra/.env.prod`.

1. **`up -d` zonder de flag** → alle `${VAR}` werden lege strings → compose zag
   een "config-wijziging" en recreëerde postgres/redis/minio/api met blanke
   env-vars → API in restart-loop (`DATABASE_URL is required`).
2. **`build web` zonder de flag** → `${NEXT_PUBLIC_API_URL}` undefined → Next
   bakte `http://localhost:4000/api` in álle JS-bundles → dashboard 84×
   `ERR_CONNECTION_REFUSED` in de browser.

Root cause van beide: compose-substitutie van `${VAR}` met undefined wordt
stilletjes een lege string, en de waarschuwing verdrinkt tussen de andere
status-regels.

**Oplossing:** `infra/deploy.sh` is het enige aanroeppad en zet altijd
`--env-file infra/.env.prod` voor élk subcommando (build, up, down, logs, exec).
Niemand hoeft de flag te onthouden.

### Openstaand vangnet (TODO, valideren op VPS)

Een tweede vangnet — `env_file: ./.env.prod` per service in de compose-YAML — is
nog **niet** doorgevoerd omdat het niet veilig lokaal te valideren is (geen
docker + geen `.env.prod` op de dev-machine). Let op bij het doorvoeren:
`environment:` **overschrijft** `env_file:`, dus je moet tegelijk de pure
pass-through `${VAR}`-entries uit de `environment:`-blokken halen (anders maakt
een vergeten `--env-file` ze leeg en winnen die lege waarden van de env_file).
Remapped vars (bv. `SENTRY_DSN: ${SENTRY_DSN_API}`) moeten als expliciete
`environment:`-entry blijven staan. Build-time `NEXT_PUBLIC_*` (in `args:`) lost
`env_file:` sowieso niet op — daarvoor blijft `deploy.sh` nodig. Zie ROADMAP.

## 7. Healthchecks

- **api**: `wget /health` → 200.
- **api-worker**: healthcheck `disable: true` — de worker draait geen
  HTTP-server, dus een HTTP-check kan nooit slagen. Worker-state monitoren we via
  BullMQ + Sentry.
- **web**: twee probes — (1) `/login` → 200 én (2) een echte JS-chunk uit
  `.next/static/chunks/` → 200. Probe 2 is toegevoegd na het incident van §4:
  de oude check (alleen `/login`) bleef `healthy` terwijl alle bundles 404'den.
  De chunk-naam bevat een content-hash, dus de check zoekt er één op schijf en
  verifieert dat exact die via HTTP geserveerd wordt (hash-agnostisch).

## 8. Poorten op de KDMN-VPS (host-Nginx-modus)

De legacy KDMN-stack draait al op 3000/5432, dus TalentFlow bindt op andere
host-poorten (allemaal op `127.0.0.1`, dus niet publiek):

| Service | Host → container |
|---|---|
| postgres | `127.0.0.1:54320` → 5432 |
| api | `127.0.0.1:40000` → 4000 |
| web | `127.0.0.1:31000` → 3000 |

De host-Nginx vhost (`infra/nginx-talentflow.conf`) reverse-proxyt
`talentflow.kdmn.nl` naar deze poorten. Caddy starten we **niet** op deze VPS
(daarom geen `--profile caddy`).

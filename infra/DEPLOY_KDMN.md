# TalentFlow — Deploy op de KDMN VPS

Concrete deploy-runbook voor `talentflow.kdmn.nl` op de bestaande Hetzner-VPS
(`91.98.232.104`) die al `app.kdmnprojecten.com`, `planning.kdmnprojecten.com`
en `financieel.kdmnprojecten.com` draait.

**Aanname:** Docker + Docker Compose v2 (plugin) + Nginx + certbot draaien al.
De VPS host al een KDMN-stack (`kdmn-api` op `:3000`, `kdmn-db` op `:5432`,
`kdmn-frontend` op `:8080`, `n8n` op `:5679`) + 3 PM2-managed apps. TalentFlow
gebruikt eigen geïsoleerde containers op alternatieve host-poorten
(54320 / 40000 / 31000) om elk port-conflict te vermijden.

---

## Stap 0 — DNS (eenmalig, bij TransIP)

Voeg aan `kdmn.nl` toe:

```
Type:    A
Naam:    talentflow
TTL:     1 min (300s)
Waarde:  91.98.232.104
```

Verifieer:

```bash
dig +short talentflow.kdmn.nl
# moet 91.98.232.104 returnen
```

---

## Stap 1 — Source op de VPS plaatsen

Op de **VPS** (SSH'd in als `root` of `kdmn`):

```bash
# Map aanmaken
sudo mkdir -p /opt/talentflow
sudo chown $USER:$USER /opt/talentflow

# Code clonen
cd /opt
git clone https://github.com/KDMN76/talentflow.git
cd /opt/talentflow

# Bevestig dat de prod-compose en nginx-config aanwezig zijn
ls infra/docker-compose.prod.yml infra/nginx-talentflow.conf
```

---

## Stap 2 — Secrets genereren + `.env.prod` invullen

Op de **VPS**:

```bash
cd /opt/talentflow
cp infra/.env.prod.example infra/.env.prod
chmod 600 infra/.env.prod

# Genereer 5 sterke secrets:
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "STORAGE_S3_ACCESS_KEY=$(openssl rand -hex 12)"
echo "STORAGE_S3_SECRET_KEY=$(openssl rand -hex 24)"
```

Kopieer die regels in `infra/.env.prod` en update óók:

- `DATABASE_URL=postgresql://talentflow:<POSTGRES_PASSWORD>@postgres:5432/talentflow`
- `REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379`

API keys (optioneel — als je mock-mode draait, laat leeg):

- `ANTHROPIC_API_KEY=` (voor Claude — AI sourcing-agent, JD generator, etc.)
- `OPENAI_API_KEY=` (voor embeddings — matching)
- `RESEND_API_KEY=` (voor outbound e-mail)

Zonder deze API-keys draait alles in **mock-mode**: alle AI features
geven synthetische deterministische output, e-mails worden gelogd maar
niet verstuurd. Voor stage/demo prima.

---

## Stap 3 — Containers starten

```bash
cd /opt/talentflow

# Build + start alles BEHALVE Caddy (de host-Nginx neemt SSL over).
docker compose --env-file infra/.env.prod \
  -f infra/docker-compose.prod.yml up -d --build

# Wacht ~30s tot containers healthy zijn, controleer:
docker compose --env-file infra/.env.prod \
  -f infra/docker-compose.prod.yml ps
```

Verwachte output: 6 containers `Up` (postgres, redis, minio, minio-init,
api, api-worker, web). `talentflow-caddy` mag NIET verschijnen (correct —
die wordt alleen gestart met `--profile caddy`).

---

## Stap 4 — Database migraties draaien

```bash
cd /opt/talentflow

# 32 idempotente migraties — kunnen 2x gedraaid worden zonder issues.
docker compose --env-file infra/.env.prod \
  -f infra/docker-compose.prod.yml \
  exec api npm run migrate

# Verifieer dat alle migraties geslaagd zijn:
docker compose --env-file infra/.env.prod \
  -f infra/docker-compose.prod.yml \
  exec postgres psql -U talentflow -d talentflow \
  -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"
# Verwacht: ≥ 80 tabellen
```

---

## Stap 5 — Nginx vhost installeren

```bash
# Kopieer de vhost
sudo cp /opt/talentflow/infra/nginx-talentflow.conf \
        /etc/nginx/sites-available/talentflow.kdmn.nl.conf

# Activeer
sudo ln -sf /etc/nginx/sites-available/talentflow.kdmn.nl.conf \
            /etc/nginx/sites-enabled/talentflow.kdmn.nl.conf

# Syntaxcheck — moet "syntax is ok" zeggen
sudo nginx -t

# Reload (geen restart — bestaande verbindingen blijven)
sudo systemctl reload nginx
```

Op dit punt kun je `http://talentflow.kdmn.nl/` proberen — die geeft een
redirect naar HTTPS, en HTTPS faalt omdat we nog geen cert hebben.

---

## Stap 6 — SSL met certbot

```bash
sudo certbot --nginx -d talentflow.kdmn.nl \
  --non-interactive --agree-tos \
  --email kaanduman76@icloud.com \
  --redirect
```

Certbot detecteert de Nginx vhost, vraagt Let's Encrypt om een cert, vult
de SSL-paden in en herlaadt Nginx. Eindresultaat: `https://talentflow.kdmn.nl/`
serveert TalentFlow met gratis SSL die automatisch elke 60 dagen vernieuwt.

Verifieer:

```bash
curl -I https://talentflow.kdmn.nl/
# Verwacht: HTTP/2 200, Server: nginx, en HSTS-header
```

---

## Stap 7 — Eerste tenant + admin-user aanmaken

```bash
cd /opt/talentflow

docker compose --env-file infra/.env.prod \
  -f infra/docker-compose.prod.yml \
  exec api node dist/scripts/seed-first-tenant.js \
  --workspace kdmn-demo \
  --email kaanduman76@icloud.com \
  --password "<sterk-wachtwoord>" \
  --name "Kaan Duman"
```

Daarna kun je inloggen op `https://talentflow.kdmn.nl/login` met:
- Workspace: `kdmn-demo`
- E-mail: `kaanduman76@icloud.com`
- Wachtwoord: (wat je hierboven hebt ingevuld)

---

## Stap 8 — Smoke test

```bash
# Health endpoint
curl https://talentflow.kdmn.nl/api/health
# Verwacht: {"status":"ok","db":"ok","redis":"ok"}

# Dashboard
curl -I https://talentflow.kdmn.nl/
# Verwacht: 200 of 307 redirect naar /login
```

In de browser:
1. Open `https://talentflow.kdmn.nl/`
2. Log in met de admin-user uit stap 7
3. Test dashboard → kandidaat aanmaken → vacature aanmaken
4. Open `/inbox` (omni-channel inbox) — moet leeg-state tonen
5. Open `/sourcing-agent` — moet brief-creator tonen

---

## Stap 9 — Backup-cron (productie-hardening)

```bash
# Daily Postgres dump + R2 sync (zie infra/backup.sh)
sudo crontab -e
```

Voeg toe:
```
0 3 * * * cd /opt/talentflow && ./infra/backup.sh >> /var/log/talentflow-backup.log 2>&1
```

(Vereist `BACKUP_R2_*` env-vars in `.env.prod` — overslaan als je dit later
wilt doen.)

---

## Update-flow (na de eerste deploy)

```bash
cd /opt/talentflow
git pull
docker compose --env-file infra/.env.prod \
  -f infra/docker-compose.prod.yml up -d --build

# Indien nieuwe migraties:
docker compose --env-file infra/.env.prod \
  -f infra/docker-compose.prod.yml \
  exec api npm run migrate
```

Of automatisch via GitHub Actions — zie `.github/workflows/deploy.yml`
(later configureren met SSH deploy-key + secrets).

---

## Troubleshooting

**Containers starten niet:**
```bash
docker compose --env-file infra/.env.prod \
  -f infra/docker-compose.prod.yml logs <service-name>
```

**Nginx 502 bad gateway:**
```bash
# Container down? Check status:
docker compose --env-file infra/.env.prod \
  -f infra/docker-compose.prod.yml ps

# API niet bereikbaar vanaf host?
curl http://127.0.0.1:4000/health
# Web niet bereikbaar vanaf host?
curl http://127.0.0.1:3000/
```

**Certbot faalt:**
```bash
# DNS niet gepropageerd?
dig +short talentflow.kdmn.nl

# Poort 80 onbereikbaar van buiten?
curl -I http://talentflow.kdmn.nl/.well-known/acme-challenge/test
```

**Migraties falen:**
```bash
# Drop + re-create de DB (alleen in dev/eerste setup!):
docker compose --env-file infra/.env.prod \
  -f infra/docker-compose.prod.yml \
  exec postgres dropdb -U talentflow talentflow
docker compose --env-file infra/.env.prod \
  -f infra/docker-compose.prod.yml \
  exec postgres createdb -U talentflow talentflow
docker compose --env-file infra/.env.prod \
  -f infra/docker-compose.prod.yml \
  exec api npm run migrate
```

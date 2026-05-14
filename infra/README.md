# TalentFlow Infrastructure Runbook

End-to-end runbook for deploying, operating, and recovering the TalentFlow
production stack on the shared KDMN Hetzner VPS (`91.98.232.104`).

---

## Stack overview

| Component   | Image                       | Purpose                              |
|-------------|-----------------------------|--------------------------------------|
| `postgres`  | `pgvector/pgvector:pg16`    | Primary database (RLS multi-tenant). pgvector required for AI matching (Slice 4). |
| `redis`     | `redis:7-alpine`            | BullMQ queue, rate-limit store.      |
| `minio`     | `minio/minio:latest`        | S3-compatible object storage (resumes, attachments). |
| `api`       | `talentflow/api:latest`     | Express REST API on `:4000`.         |
| `api-worker`| `talentflow/api:latest`     | BullMQ workers (resume parser, embeddings, email, workflow, comms). |
| `web`       | `talentflow/web:latest`     | Next.js 14 dashboard + careers SSR on `:3000`. |
| `caddy`     | `caddy:2-alpine`            | Reverse proxy + automatic Let's Encrypt TLS. |

All inter-service traffic stays on the `talentflow_net` Docker network.
Only Caddy publishes ports 80/443 to the host.

---

## Caddy vs Nginx — which to use

We ship **both** configs. The default deploy uses **Caddy** because:

1. **Automatic TLS** — Caddy obtains and renews certificates automatically;
   no certbot timer to babysit.
2. **On-demand TLS** — required for the Q2 white-label career-page feature
   (customers point a custom domain at our IP; Caddy issues a cert per
   domain on first request). Nginx + certbot does not support this without
   a homemade ACME wrapper.
3. **Smaller config surface** — single 80-line Caddyfile vs ~150 lines of
   Nginx.

Use `infra/nginx.conf` instead if:
- You need very granular request-level controls (rate limiting per zone,
  caching directives, mTLS) that Caddy doesn't expose ergonomically.
- Ops familiarity is Nginx.
- You prefer to manage certs explicitly via certbot and not rely on
  Caddy's automatic ACME.

To swap: stop the `caddy` service in `docker-compose.prod.yml`, remove
its ports block, install Nginx on the host, copy `infra/nginx.conf` to
`/etc/nginx/sites-available/talentflow.conf`, link, and run certbot.

The on-demand TLS block in `Caddyfile` is **commented out** until the
`/api/portal/verify-domain` endpoint ships in Q2.

---

## First deploy (operator runbook)

### 1. Provision Hetzner VPS

Already exists at `91.98.232.104` (Ubuntu, shared with KDMN Planning &
Financieel). On a fresh box:

```bash
# As root
apt update && apt upgrade -y
apt install -y docker.io docker-compose-plugin git awscli ufw fail2ban

# Firewall
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp   # HTTP/3
ufw enable

# Service user
useradd -m -s /bin/bash talentflow-deploy
usermod -aG docker talentflow-deploy
mkdir -p /opt/talentflow
chown talentflow-deploy:talentflow-deploy /opt/talentflow
```

### 2. Set up SSH key for CD

On your laptop:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/talentflow_deploy -C 'github-actions-talentflow-cd'
ssh-copy-id -i ~/.ssh/talentflow_deploy.pub talentflow-deploy@91.98.232.104
```

Add the **private** key to GitHub repo secrets as `HETZNER_SSH_KEY`.

### 3. Clone repo on the VPS

```bash
sudo -u talentflow-deploy bash <<'EOF'
cd /opt/talentflow
git clone https://github.com/<your-org>/talentflow.git .
EOF
```

### 4. Create production env

```bash
sudo -u talentflow-deploy bash <<'EOF'
cd /opt/talentflow
cp infra/.env.prod.example infra/.env.prod
chmod 600 infra/.env.prod
# Edit infra/.env.prod and fill in:
#   - POSTGRES_PASSWORD, REDIS_PASSWORD: openssl rand -hex 24
#   - JWT_SECRET, JWT_REFRESH_SECRET: openssl rand -hex 32
#   - STORAGE_S3_ACCESS_KEY: openssl rand -hex 12
#   - STORAGE_S3_SECRET_KEY: openssl rand -hex 24
#   - ANTHROPIC_API_KEY, OPENAI_API_KEY, RESEND_API_KEY: real keys
#   - BACKUP_R2_*: from Cloudflare R2 dashboard
EOF
```

### 5. DNS

In your DNS provider, set:

| Record | Type | Value             |
|--------|------|-------------------|
| `talentflow.app`     | A     | `91.98.232.104`  |
| `www.talentflow.app` | A     | `91.98.232.104`  |
| `api.talentflow.app` | A     | `91.98.232.104`  |
| `*.talentflow.app`   | A     | `91.98.232.104`  | *(wildcard for career pages — add when Q2 ships)* |

TTL 300s during initial setup, raise to 3600 after stable.

Verify with `dig +short api.talentflow.app` before continuing — Caddy
needs DNS to resolve to issue Let's Encrypt certs.

### 6. First boot

```bash
sudo -u talentflow-deploy bash <<'EOF'
cd /opt/talentflow

# Build images
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml build

# Start infrastructure (postgres + redis + minio + minio-init)
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d postgres redis minio minio-init

# Wait for postgres
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml exec postgres pg_isready -U talentflow

# Run migrations
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml run --rm api npm run migrate

# Start everything
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d

# Verify
sleep 30
curl -fsS https://api.talentflow.app/health
curl -fsS https://talentflow.app | head -c 200
EOF
```

### 7. Set up backup cron

```bash
sudo -u talentflow-deploy bash <<'EOF'
chmod +x /opt/talentflow/infra/backup.sh /opt/talentflow/infra/restore-test.sh

# Daily backup at 03:00 UTC
( crontab -l 2>/dev/null; echo "0 3 * * * /opt/talentflow/infra/backup.sh >> /var/log/talentflow-backup.log 2>&1" ) | crontab -

# Weekly restore verification at 04:00 UTC Sunday
( crontab -l 2>/dev/null; echo "0 4 * * 0 /opt/talentflow/infra/restore-test.sh >> /var/log/talentflow-restore-test.log 2>&1" ) | crontab -
EOF

# Logrotate
cat <<'CONF' | sudo tee /etc/logrotate.d/talentflow
/var/log/talentflow-*.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
    create 0644 talentflow-deploy talentflow-deploy
}
CONF
```

### 8. R2 lifecycle policy (one-time, via Cloudflare dash)

In R2 console -> bucket `talentflow-backups` -> Lifecycle rules:
- Rule: "30-day retention"
- Prefix: `talentflow-backups/`
- Action: Delete after 30 days

---

## Updates (post-first-deploy)

Push to `main`. CI runs (`.github/workflows/ci.yml`); on success the CD
workflow (`.github/workflows/deploy.yml`) SSHes into the VPS and runs:

```bash
git fetch origin main
git reset --hard origin/main
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml build api web
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml run --rm api npm run migrate
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d --no-deps api api-worker web
```

Manual deploy: trigger `Deploy` workflow via GitHub Actions UI.

The `production` environment has manual approval — required reviewer must
click "Approve and deploy" in the Actions UI.

---

## Backup & restore

### Backup (automated)

`infra/backup.sh` runs nightly at 03:00 UTC, dumps Postgres, gzips, and
uploads to Cloudflare R2 under
`s3://talentflow-backups/YYYY-MM-DD-HH/postgres-<timestamp>.sql.gz`.

### Restore (manual disaster recovery)

```bash
cd /opt/talentflow
source infra/.env.prod

# 1. Find the backup
AWS_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_KEY" \
aws s3 ls "s3://${BACKUP_R2_BUCKET}/talentflow-backups/" \
  --endpoint-url "$BACKUP_R2_ENDPOINT" --recursive | tail -n 20

# 2. Download
AWS_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_KEY" \
aws s3 cp "s3://${BACKUP_R2_BUCKET}/talentflow-backups/<KEY>" /tmp/restore.sql.gz \
  --endpoint-url "$BACKUP_R2_ENDPOINT"

# 3. Stop API + workers (web stays up serving 5xx — fix copy in step 4)
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml stop api api-worker

# 4. Restore (drops + recreates schema if dump used --clean)
gunzip -c /tmp/restore.sql.gz | \
  docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1

# 5. Restart API
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d api api-worker

# 6. Verify
curl -fsS https://api.talentflow.app/health
```

### Verifying backups still work

`infra/restore-test.sh` runs weekly (Sunday 04:00 UTC). It downloads the
latest backup, restores into a throwaway DB, runs `SELECT count(*) FROM
tenants`, and drops the DB. Failures emit a non-zero exit code so cron
mail / monitoring picks them up.

---

## Domain setup recap

DNS A-records (see step 5 above):

```
talentflow.app          A   91.98.232.104
www.talentflow.app      A   91.98.232.104
api.talentflow.app      A   91.98.232.104
*.talentflow.app        A   91.98.232.104   # for Q2 career-page custom subdomains
```

For customer custom domains (Q2): customer points `careers.theircompany.com`
CNAME at `talentflow.app`. Caddy on-demand TLS provisions a cert when the
`/api/portal/verify-domain` endpoint returns 200 for that hostname.

---

## Troubleshooting

### Logs

```bash
# Live logs for a service
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml logs -f api

# All services since 1h ago
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml logs --since 1h
```

### Common errors

| Symptom                                    | Likely cause / fix                              |
|--------------------------------------------|--------------------------------------------------|
| Caddy: `tls: failed to verify certificate` | DNS not propagated yet — wait, then `docker compose restart caddy`. |
| API healthcheck failing                    | Check `docker compose logs api`. Usually DB connection (wrong DATABASE_URL or postgres not healthy). |
| Worker not picking up jobs                 | Check `api-worker` logs. Verify REDIS_PASSWORD matches between redis service and worker env. |
| MinIO `AccessDenied`                       | STORAGE_S3_ACCESS_KEY mismatch; recreate bucket via `minio-init`. |
| Resume parser stuck on `processing`        | Look at `api-worker` logs. Usually OPENAI_API_KEY missing or PDF >25 MB. |
| `next.config.mjs` standalone build missing | Confirm `output: 'standalone'` is set; rebuild image. |
| pgvector extension missing                 | We use `pgvector/pgvector:pg16`. If you accidentally seeded with stock postgres, dump + restore on the right image. |

### Restart everything safely

```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml restart
```

### Hard reset (last resort — DESTROYS DATA)

```bash
# DANGER — this deletes all volumes including postgres_data
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml down -v
```

Don't run this without a verified backup at hand.

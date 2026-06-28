#!/usr/bin/env bash
# =============================================================================
# TalentFlow — Postgres backup -> Cloudflare R2
# =============================================================================
# Runs from host crontab on the VPS. Streams pg_dump out of the postgres
# container, gzips it, and uploads to Cloudflare R2 with a date-prefixed key.
# Retention is enforced server-side via R2 lifecycle policy (30 days).
#
# Install (host crontab):
#   crontab -e
#   0 3 * * * /opt/talentflow/infra/backup.sh >> /var/log/talentflow-backup.log 2>&1
#
# Required env (read from /opt/talentflow/infra/.env.prod):
#   POSTGRES_USER
#   POSTGRES_DB
#   BACKUP_R2_ACCESS_KEY
#   BACKUP_R2_SECRET_KEY
#   BACKUP_R2_BUCKET
#   BACKUP_R2_ENDPOINT
#
# Optional — MinIO object backup (uploaded CVs), opt in with:
#   BACKUP_MINIO_ENABLED=true
#   BACKUP_MINIO_ENDPOINT   (host-reachable MinIO URL; defaults to STORAGE_S3_ENDPOINT)
#   (hergebruikt STORAGE_S3_BUCKET / STORAGE_S3_ACCESS_KEY / STORAGE_S3_SECRET_KEY)
#
# Dependencies on host:
#   - docker
#   - awscli  (apt install awscli  OR  curl -L … installer)
#
# R2 lifecycle policy (set once via Cloudflare dashboard or `aws s3api`):
#   - Delete objects older than 30 days under prefix `talentflow-backups/`
# =============================================================================

set -euo pipefail

# ── Locate env file ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.prod"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ERROR] Missing env file at $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

: "${POSTGRES_USER:?must be set}"
: "${POSTGRES_DB:?must be set}"
: "${BACKUP_R2_ACCESS_KEY:?must be set}"
: "${BACKUP_R2_SECRET_KEY:?must be set}"
: "${BACKUP_R2_BUCKET:?must be set}"
: "${BACKUP_R2_ENDPOINT:?must be set}"

# ── Compute backup path ─────────────────────────────────────────────────────
TIMESTAMP="$(date -u +%Y-%m-%d-%H%M)"
DATE_PREFIX="$(date -u +%Y-%m-%d-%H)"
TMPDIR="$(mktemp -d -t talentflow-backup-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

DUMP_FILE="$TMPDIR/postgres-${TIMESTAMP}.sql.gz"
R2_KEY="talentflow-backups/${DATE_PREFIX}/postgres-${TIMESTAMP}.sql.gz"

echo "[$(date -u +%FT%TZ)] Starting backup -> $R2_KEY"

# ── Dump + gzip in a single pipe (no temp uncompressed file) ────────────────
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  exec -T postgres \
  pg_dump --clean --if-exists --no-owner --no-privileges \
    -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip -9 > "$DUMP_FILE"

DUMP_SIZE="$(stat -c%s "$DUMP_FILE")"
echo "[$(date -u +%FT%TZ)] Dump complete: $DUMP_SIZE bytes"

if [[ "$DUMP_SIZE" -lt 1024 ]]; then
  echo "[ERROR] Dump suspiciously small (<1 KB) — aborting upload" >&2
  exit 1
fi

# ── Upload to R2 (S3-compatible) ────────────────────────────────────────────
AWS_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_KEY" \
aws s3 cp "$DUMP_FILE" "s3://${BACKUP_R2_BUCKET}/${R2_KEY}" \
  --endpoint-url "$BACKUP_R2_ENDPOINT" \
  --no-progress

echo "[$(date -u +%FT%TZ)] Upload complete: s3://${BACKUP_R2_BUCKET}/${R2_KEY}"

# ── Optional: MinIO object storage (uploaded CVs) -> R2 ──────────────────────
# Postgres alleen is niet genoeg: kandidaat-CV's staan in MinIO op één named
# volume. Zonder offsite-kopie verlies je bij een schijfcrash elk geüpload
# bestand. Opt in met BACKUP_MINIO_ENABLED=true zodra BACKUP_MINIO_ENDPOINT
# vanaf de host bereikbaar is. Best-effort: een fout hier wordt gelogd maar laat
# de (kritieke) Postgres-backup hierboven NIET falen.
if [[ "${BACKUP_MINIO_ENABLED:-false}" == "true" ]]; then
  : "${STORAGE_S3_BUCKET:?must be set for MinIO backup}"
  : "${STORAGE_S3_ACCESS_KEY:?must be set for MinIO backup}"
  : "${STORAGE_S3_SECRET_KEY:?must be set for MinIO backup}"
  MINIO_ENDPOINT="${BACKUP_MINIO_ENDPOINT:-${STORAGE_S3_ENDPOINT:-http://127.0.0.1:9000}}"
  FILES_DIR="$TMPDIR/minio-files"
  mkdir -p "$FILES_DIR"
  if AWS_ACCESS_KEY_ID="$STORAGE_S3_ACCESS_KEY" \
     AWS_SECRET_ACCESS_KEY="$STORAGE_S3_SECRET_KEY" \
     aws s3 sync "s3://${STORAGE_S3_BUCKET}" "$FILES_DIR" \
       --endpoint-url "$MINIO_ENDPOINT" --no-progress \
  && AWS_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY" \
     AWS_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_KEY" \
     aws s3 sync "$FILES_DIR" "s3://${BACKUP_R2_BUCKET}/talentflow-files/${DATE_PREFIX}/" \
       --endpoint-url "$BACKUP_R2_ENDPOINT" --no-progress; then
    echo "[$(date -u +%FT%TZ)] MinIO files mirrored to R2 under talentflow-files/${DATE_PREFIX}/"
  else
    echo "[WARN] MinIO -> R2 mirror failed (Postgres backup still OK)" >&2
  fi
fi

# ── Optional: notify on success/failure (Slack/Discord webhook) ────────────
if [[ -n "${DEPLOY_NOTIFY_WEBHOOK:-}" ]]; then
  curl -fsS -X POST -H 'Content-Type: application/json' \
    -d "{\"text\":\":floppy_disk: TalentFlow backup OK — ${R2_KEY} (${DUMP_SIZE} bytes)\"}" \
    "$DEPLOY_NOTIFY_WEBHOOK" >/dev/null || true
fi

echo "[$(date -u +%FT%TZ)] Backup finished successfully"

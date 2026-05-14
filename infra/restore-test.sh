#!/usr/bin/env bash
# =============================================================================
# TalentFlow — Backup restore verification
# =============================================================================
# Downloads the most recent postgres backup from R2, restores into a *staging*
# database (not production!), and runs a sanity check.
#
# Run weekly via crontab so we know our backups actually restore:
#   crontab -e
#   0 4 * * 0 /opt/talentflow/infra/restore-test.sh >> /var/log/talentflow-restore-test.log 2>&1
#
# This script:
#   1. Lists the newest object under talentflow-backups/
#   2. Downloads + decompresses
#   3. Creates a fresh staging DB (talentflow_restore_test)
#   4. Restores via psql
#   5. Runs `SELECT count(*) FROM tenants` as smoke check
#   6. Drops the staging DB
#
# A failure exits non-zero so cron / monitoring picks it up.
# =============================================================================

set -euo pipefail

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
: "${POSTGRES_PASSWORD:?must be set}"
: "${BACKUP_R2_ACCESS_KEY:?must be set}"
: "${BACKUP_R2_SECRET_KEY:?must be set}"
: "${BACKUP_R2_BUCKET:?must be set}"
: "${BACKUP_R2_ENDPOINT:?must be set}"

TEST_DB="talentflow_restore_test_$(date -u +%s)"
TMPDIR="$(mktemp -d -t talentflow-restore-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "[$(date -u +%FT%TZ)] Locating most recent backup..."

LATEST_KEY="$(
  AWS_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_KEY" \
  aws s3api list-objects-v2 \
    --bucket "$BACKUP_R2_BUCKET" \
    --prefix "talentflow-backups/" \
    --endpoint-url "$BACKUP_R2_ENDPOINT" \
    --query 'reverse(sort_by(Contents, &LastModified))[0].Key' \
    --output text
)"

if [[ -z "$LATEST_KEY" || "$LATEST_KEY" == "None" ]]; then
  echo "[ERROR] No backups found in s3://${BACKUP_R2_BUCKET}/talentflow-backups/" >&2
  exit 1
fi

echo "[$(date -u +%FT%TZ)] Latest backup: $LATEST_KEY"

DUMP_FILE="$TMPDIR/dump.sql.gz"
AWS_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_KEY" \
aws s3 cp "s3://${BACKUP_R2_BUCKET}/${LATEST_KEY}" "$DUMP_FILE" \
  --endpoint-url "$BACKUP_R2_ENDPOINT" \
  --no-progress

gunzip -t "$DUMP_FILE"
echo "[$(date -u +%FT%TZ)] Backup integrity OK"

# ── Create staging DB ───────────────────────────────────────────────────────
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE $TEST_DB;"

echo "[$(date -u +%FT%TZ)] Created $TEST_DB"

# ── Restore ─────────────────────────────────────────────────────────────────
gunzip -c "$DUMP_FILE" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  exec -T postgres psql -U "$POSTGRES_USER" -d "$TEST_DB" -v ON_ERROR_STOP=1

echo "[$(date -u +%FT%TZ)] Restore complete"

# ── Sanity check ────────────────────────────────────────────────────────────
TENANT_COUNT="$(
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$TEST_DB" -At -c "SELECT count(*) FROM tenants;"
)"

echo "[$(date -u +%FT%TZ)] tenants count = $TENANT_COUNT"

if [[ "$TENANT_COUNT" -lt 1 ]]; then
  echo "[ERROR] Sanity check failed: tenants table empty or missing" >&2
  # Drop test DB before exiting
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE $TEST_DB;" || true
  exit 1
fi

# ── Drop staging DB ─────────────────────────────────────────────────────────
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE $TEST_DB;"

echo "[$(date -u +%FT%TZ)] Restore test PASSED"

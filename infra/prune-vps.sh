#!/usr/bin/env bash
#
# prune-vps.sh — veilige opruiming van Docker-rommel op de VPS.
#
# Verwijdert ALLEEN:
#   - gestopte (exited) containers
#   - dangling images (untagged lagen van oude builds)
# Raakt NOOIT: draaiende containers, named volumes (postgres_data/redis_data/
# minio_data), of getagde images die in gebruik zijn.
#
# Aanleiding: `docker ps -a` toonde 7+ exited containers van oude buildpogingen
# (modest_shamir, agitated_hypatia, …) die nooit waren opgeruimd. Zie ROADMAP
# "Archief-containers opruimen op VPS".
#
# Gebruik (op de VPS, als root of een docker-gebruiker):
#   bash /opt/talentflow/infra/prune-vps.sh
#
set -euo pipefail

echo "=== Disk vóór (/var/lib/docker) ==="
df -h /var/lib/docker 2>/dev/null || df -h /

echo
echo "=== Gestopte containers die verwijderd worden ==="
docker ps -a --filter status=exited --filter status=created \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' || true

echo
echo "=== Draaiende containers (blijven met rust) ==="
docker ps --format 'table {{.Names}}\t{{.Status}}' || true

echo
read -r -p "Doorgaan met prunen van exited containers + dangling images? [y/N] " ans
case "$ans" in
  [yY]|[yY][eE][sS]) ;;
  *) echo "Geannuleerd."; exit 0 ;;
esac

echo
echo "--- docker container prune ---"
docker container prune -f

echo "--- docker image prune (alleen dangling) ---"
docker image prune -f

echo
echo "=== Disk ná ==="
df -h /var/lib/docker 2>/dev/null || df -h /

echo
echo "Klaar. (Voor een grondiger opruiming van ongebruikte getagde images:"
echo " 'docker image prune -a' — maar check eerst dat talentflow/api:latest en"
echo " talentflow/web:latest in gebruik blijven.)"

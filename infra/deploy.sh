#!/usr/bin/env bash
#
# deploy.sh — DE canonieke aanroep voor élke docker-compose-actie in productie.
#
# WAAROM DIT BESTAAT
# ------------------
# Op 2026-05-21 ging tweemaal op één dag dezelfde fout mis: een `docker compose`
# commando zonder `--env-file infra/.env.prod`. Gevolgen:
#   1. `up -d` zonder --env-file → alle ${VAR} werden lege strings → compose
#      "zag" een config-wijziging en recreëerde postgres/redis/minio/api met
#      blanke env-vars → API in restart-loop (`DATABASE_URL is required`).
#   2. `build web` zonder --env-file → ${NEXT_PUBLIC_API_URL} undefined → Next
#      bakte `http://localhost:4000/api` in alle bundles → dashboard 84×
#      ERR_CONNECTION_REFUSED in de browser.
#
# Deze wrapper injecteert ALTIJD `--env-file` voor zowel build als up/down/pull,
# zodat niemand de flag hoeft te onthouden. Gebruik DIT script, nooit `docker
# compose ...` rechtstreeks op de VPS.
#
# GEBRUIK
# -------
#   ./infra/deploy.sh build web
#   ./infra/deploy.sh up -d
#   ./infra/deploy.sh up -d --no-deps --force-recreate web
#   ./infra/deploy.sh ps
#   ./infra/deploy.sh logs -f api
#   ./infra/deploy.sh down
#
# Host-Nginx-modus is default (geen Caddy). Voor Caddy-modus geef je zelf
# `--profile caddy` mee: `./infra/deploy.sh --profile caddy up -d`.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$HERE/docker-compose.prod.yml"
ENV_FILE="$HERE/.env.prod"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "FOUT: env-file niet gevonden: $ENV_FILE" >&2
  echo "      Maak hem aan o.b.v. infra/.env.prod.example (chmod 600) voordat je deployt." >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "Gebruik: $0 <docker-compose-subcommando> [args...]" >&2
  echo "Bijv.:  $0 up -d   |   $0 build web   |   $0 logs -f api" >&2
  exit 64
fi

# Toon wat we draaien (handig in deploy-logs), voer dan exact dát uit.
set -x
exec docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"

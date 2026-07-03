#!/usr/bin/env bash
#
# TalentFlow uptime-monitor — draait elke 5 min via cron op de VPS.
#
# Checkt de publieke URL's (web + api) door de volledige keten heen
# (DNS → TLS → nginx → container). Bij een statuswissel (up↔down) stuurt
# hij één alertmail via Resend — geen spam bij aanhoudende storing, wél
# een herstelmelding.
#
# Beperking (bewust): draait op dezelfde VPS, dus een totale VPS-uitval
# wordt niet gemeld. Daarvoor is een externe monitor (bv. UptimeRobot)
# nodig — zie docs. Installatie:
#   crontab: */5 * * * * /opt/talentflow/infra/uptime-monitor.sh >/dev/null 2>&1
#
set -u

ENV_FILE=/opt/talentflow/infra/.env.prod
STATE_FILE=/var/tmp/talentflow-uptime.state
ALERT_TO="kaanduman76@icloud.com"
WEB_URL="https://talentflow.kdmn.nl/login"
API_URL="https://talentflow.kdmn.nl/api/health"

# Alleen de benodigde var lezen — nooit het hele env-bestand sourcen
# (RESEND_FROM bevat spaties/<> en breekt bash-source).
RESEND_API_KEY=$(grep -E '^RESEND_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)

check() { curl -fsS -m 10 -o /dev/null "$1" 2>/dev/null; }

probe() {
  local fails=""
  check "$WEB_URL" || fails="${fails}web "
  check "$API_URL" || fails="${fails}api "
  echo "$fails"
}

FAILS=$(probe)
# Eén retry na 20s tegen flapping (deploy-momenten, nginx-reload).
if [ -n "$FAILS" ]; then
  sleep 20
  FAILS=$(probe)
fi

if [ -z "$FAILS" ]; then NEW_STATE="up"; else NEW_STATE="down"; fi
OLD_STATE=$(cat "$STATE_FILE" 2>/dev/null || echo "up")
echo "$NEW_STATE" > "$STATE_FILE"

[ "$NEW_STATE" = "$OLD_STATE" ] && exit 0
[ -z "$RESEND_API_KEY" ] && exit 0

TS=$(date '+%Y-%m-%d %H:%M:%S %Z')
if [ "$NEW_STATE" = "down" ]; then
  SUBJECT="[ALERT] TalentFlow DOWN: ${FAILS}(${TS})"
  BODY="Uptime-monitor op de VPS meldt een storing.\n\nGefaalde checks: ${FAILS}\nTijdstip: ${TS}\n\nChecks:\n- ${WEB_URL}\n- ${API_URL}\n\nEerste stappen: ssh root@91.98.232.104, dan 'docker ps' en 'docker logs talentflow-api --tail 50'."
else
  SUBJECT="[OK] TalentFlow hersteld (${TS})"
  BODY="Alle checks zijn weer groen.\nTijdstip: ${TS}"
fi

# Key via stdin-config i.p.v. argv, zodat hij niet kortstondig in `ps aux`
# zichtbaar is op de VPS.
curl -fsS -m 15 --config - >/dev/null 2>&1 <<CURLCFG || true
url = "https://api.resend.com/emails"
header = "Authorization: Bearer ${RESEND_API_KEY}"
header = "Content-Type: application/json"
data = "{\"from\":\"TalentFlow Monitor <no-reply@send.kdmn.nl>\",\"to\":[\"${ALERT_TO}\"],\"subject\":\"${SUBJECT}\",\"text\":\"$(printf '%b' "$BODY" | sed ':a;N;$!ba;s/\n/\\n/g' | sed 's/"/\\\\"/g')\"}"
CURLCFG

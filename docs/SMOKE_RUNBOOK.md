# TalentFlow — Post-deploy Smoke Runbook

Run these checks after every production deploy. The CD workflow runs
checks 1 + 2 automatically; the rest are manual once-per-release sanity
checks an operator should walk through within ~10 minutes of a deploy.

If any check fails, **roll back** by running:
```bash
ssh talentflow-deploy@91.98.232.104 'cd /opt/talentflow && git reset --hard HEAD~1 && docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d --build api api-worker web'
```

---

## Automated (CD pipeline)

### 1. `/health` returns 200

```bash
curl -fsS https://api.talentflow.app/health
# Expect: {"status":"ok","timestamp":"..."}
```

### 2. Marketing site loads

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' https://talentflow.app
# Expect: 200 (or 301/302 to /login)
```

---

## Manual (operator)

### 3. Login

1. Open `https://talentflow.app/login`
2. Log in with the recruiter test account (`recruiter@talentflow-demo.app`).
3. Should land on the dashboard within 2 seconds.
4. Hard-refresh (Ctrl-Shift-R) — session should persist (refresh token cookie).

### 4. Create a candidate

1. Dashboard -> Kandidaten -> Nieuwe kandidaat.
2. Fill name + email + phone, save.
3. Candidate appears in the list.
4. Open the candidate detail page.

### 5. Upload CV + parser

1. On the candidate detail page, upload a PDF CV (~1–2 MB).
2. Toast: "CV geüpload".
3. Within 30 s the parsed sections (skills, education, work history) appear.
4. Verify in worker logs:
   ```bash
   docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml logs api-worker | grep resume-parser | tail -n 20
   ```
   Look for: `Job <id> completed successfully`.

### 6. Send email via ComposeEmailModal

1. Open candidate detail -> "Email" button.
2. Pick a template, edit body, hit "Verstuur".
3. Toast: "Email verstuurd".
4. Confirm in Resend dashboard the message appears.
5. Confirm activity-log row on the candidate shows "Email sent".

### 7. Pipeline drag-drop

1. Vacatures -> open a job -> Pipeline tab.
2. Drag a candidate card from "Sourced" to "Screened".
3. Drop succeeds visibly (card lands in new column).
4. Hard refresh — card stays in "Screened".
5. Worker logs show `workflow-events` job for the stage transition.

### 8. AI matching scores

1. On a job's pipeline, open "AI matches".
2. Within 30 s, scores (0–100) appear next to candidates.
3. Verify embeddings worker activity:
   ```bash
   docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml logs api-worker | grep embeddings | tail -n 20
   ```

### 9. Career page (public, SSR)

1. Visit `https://talentflow.app/careers/<demo-tenant-slug>` in incognito.
2. List of open roles renders server-side (view source -> jobs are in HTML, not JS-only).
3. Click a job -> detail page loads.
4. Fill the apply-form -> submit succeeds -> "Bedankt voor je sollicitatie".

### 10. Webhook ingest

1. From Resend dashboard, send a test webhook to `https://api.talentflow.app/api/webhooks/resend`.
2. Confirm 200 response.
3. Confirm activity log entry on the matching candidate.

### 11. Rate limiting

1. Hit `https://api.talentflow.app/api/auth/login` with bogus creds 20× quickly.
2. After ~10 attempts, get HTTP 429.
3. Confirms Redis-backed rate limit is working.

### 12. RLS isolation

1. Log in as Tenant A.
2. Note a candidate ID.
3. Open a private window, log in as Tenant B.
4. Try `GET /api/candidates/<tenant-A-id>` via DevTools — must return 404, not 200.

### 13. Background job durability

1. Upload a CV.
2. **Immediately** restart workers:
   ```bash
   docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml restart api-worker
   ```
3. The job should still complete after the worker restarts (BullMQ persists in Redis).

### 14. Backup script (manual trigger)

```bash
ssh talentflow-deploy@91.98.232.104 '/opt/talentflow/infra/backup.sh'
```
Should exit 0 and print "Backup finished successfully". Verify object
exists in R2 console.

### 15. CSV exports + bulk-actions (Q1.2)

1. **Export candidates** — Dashboard → Kandidaten → "Exporteer naar CSV".
   - Browser triggers download of `candidates-YYYY-MM-DD.csv`.
   - Open in Excel: NL-diacritics ("é", "ø", "€") render correct (BOM works).
   - Headers: `id, reference, name, ...`. First data row = matching kandidaat.
2. **Export jobs** — Dashboard → Vacatures → filter `status=open` → "Exporteer".
   - Server query log toont één INSERT INTO audit_events met
     `action='data.exported'` en `tenant_id` van de gebruiker.
3. **Bulk archive** — selecteer 3 kandidaten → "Archiveren".
   - Toast: "3 kandidaten gearchiveerd".
   - `SELECT * FROM audit_events WHERE action='bulk_action.performed'
     ORDER BY created_at DESC LIMIT 1` → toont de bulk-rij met de ids
     in `after.affected_ids`.
4. **DISABLE_INLINE_WORKERS guard** — controleer dat de api-container niet
   óók BullMQ-workers start:
   ```bash
   docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml \
     logs api | grep "inline worker disabled" | head -n 5
   ```
   Verwacht: één regel per worker
   (`[resumeParser] inline worker disabled`, etc.).

---

## Rollback

If anything is unrecoverable:

```bash
ssh talentflow-deploy@91.98.232.104 <<'EOF'
cd /opt/talentflow
git log --oneline -n 5            # find last good SHA
git reset --hard <good-sha>
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml build api web
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d --no-deps api api-worker web
EOF
```

If migrations need rollback, restore from the most recent backup
(`infra/README.md` → "Restore (manual disaster recovery)") — we don't
ship `down.sql` migrations.

---

## Post-cutover smoke (24h) — voor recruiter, dagelijks ochtendcheck

**Context:** in de eerste 24 uur na cutover (en daarna dagelijks tijdens hypercare-week) loopt
elke recruiter deze 12-item smoke door bij start van de werkdag. Doel: vroeg een regression
detecteren voordat een hele dag werk verloren gaat.
Zie ook [IT_Proposal_Cutover_Plan.md](IT_Proposal_Cutover_Plan.md) sectie 7 (cutover-dag) en
[Hypercare_Plan.md](Hypercare_Plan.md) voor escalatie.

### Recruiter ochtend-smoke (12 items, ~5 min)

1. [ ] **Login** — open `https://talentflow.app/login`, login met je account, dashboard laadt <2s.
2. [ ] **Kandidaten-lijst** — klik 'Kandidaten', volledige lijst (5.540) laadt <3s.
3. [ ] **Zoeken** — typ je eigen voornaam of een random kandidaat, resultaten verschijnen <1s.
4. [ ] **Kandidaat openen** — klik op een random kandidaat, detail-pagina laadt + alle tabs klikbaar.
5. [ ] **CV downloaden** — open CV's-tab op een kandidaat, klik download, PDF opent.
6. [ ] **Pipeline drag-drop** — open een random job -> Pipeline tab, sleep een kaart 1 stage verder, hard-refresh, kaart staat in nieuwe stage.
7. [ ] **E-mail versturen** — open een random kandidaat -> E-mail-knop -> kies template -> verstuur naar test-adres `smoke@itproposal.nl`. Toast 'verzonden' verschijnt. Check Resend dashboard binnen 1 min.
8. [ ] **AI Suite** — open een job -> AI Suite tab, top-matches laden binnen 5s + EU AI Act-banner zichtbaar onderaan.
9. [ ] **Activity-log** — open een random kandidaat -> Activiteit tab, events laden in chronologische volgorde.
10. [ ] **Bulk-actie** — Kandidaten-lijst -> selecteer 2 kandidaten -> Bulk -> 'Add tag' -> 'smoke-YYYY-MM-DD' -> bevestig. Tag verschijnt op beide.
11. [ ] **Saved search** — gebruik een eerder bewaarde search uit zijbalk, resultaten laden.
12. [ ] **Help / FAQ** — klik **?** rechtsboven, FAQ-modal opent + link naar Slack-channel werkt.

**Bij rood op enige check:** post in `#talentflow-support` met:
- Welke check rood
- Screenshot
- Browser + tijdstempel
- Wat je verwachtte vs wat je zag

Kaan reageert binnen 2u op werkdagen, escalatie volgens [Hypercare_Plan.md](Hypercare_Plan.md) sectie 4.

---

## Daily health-check — voor Kaan, dagelijks 08:30

5-item check vóór de daily standup, resultaat geplakt in `#talentflow-support` als thread.

### 1. `/health` retourneert 200

```bash
curl -fsS https://api.talentflow.app/health
# Expect: {"status":"ok","timestamp":"..."}
```

### 2. Sentry events afgelopen 24u <50

Open Sentry-dashboard (project: talentflow-prod) -> Events tab -> last 24h.
Threshold: <50 events totaal, <10 unieke fouten. Bij overschrijding: maak ticket per top-issue.

### 3. Better Uptime laatste 24u 100%

Open Better Uptime dashboard -> monitor 'TalentFlow API' -> 24h-window.
Threshold: 100% uptime; bij <100% review incident in detail.

### 4. Backup van afgelopen nacht aanwezig in R2

```bash
ssh talentflow-deploy@91.98.232.104 'ls -la /opt/talentflow/backups/ | head -3'
```
Verwacht: bestand met datestamp van vandaag (cron draait 03:00 UTC).
Verifieer ook in R2-console (bucket `talentflow-prod-backup`) dat object met dezelfde
datestamp aanwezig is.

### 5. PostgreSQL connections <80% van max

```bash
ssh talentflow-deploy@91.98.232.104 \
  'docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml exec -T db \
    psql -U talentflow -c "SELECT count(*) FROM pg_stat_activity"'
```
Threshold: <80 (van max 100). Bij overschrijding: check pool-leak in api-logs.

### Rapportage-template (Slack)

```
## Health-check YYYY-MM-DD 08:30

1. /health: ✅ 200
2. Sentry 24u: ✅ N events, M unique
3. Better Uptime 24u: ✅ 100%
4. Backup vannacht: ✅ aanwezig in R2
5. PG connections: ✅ N/100

Status: groen / oranje / rood
Notities: ...
```

---

## Wekelijkse pariteit-check — voor Kaan, vrijdag 16:00

Doel: detecteer regressies in feature-pariteit met Manatal voordat ze zich opstapelen.

### 1. Run het script

```bash
ssh talentflow-deploy@91.98.232.104 \
  'cd /opt/talentflow && node apps/api/scripts/parity-check.ts \
    --tenant=itproposal \
    --report=/tmp/parity-$(date +%F).json \
    --strict'
```

Het script (door Agent CC gemaakt) vergelijkt:
- TalentFlow-state vs. laatste Manatal-export-snapshot
- Verwachte counts per categorie (kandidaten, jobs, applications, communications)
- Sample-records met checksum

### 2. Interpreteer het JSON-rapport

Schema:
```json
{
  "generated_at": "...",
  "tenant": "itproposal",
  "summary": {
    "critical": 0,
    "major": 2,
    "minor": 8
  },
  "categories": {
    "candidates": {"manatal_count": 5540, "talentflow_count": 5540, "diff": []},
    "jobs": {...},
    "applications": {...},
    "communications": {...}
  },
  "issues": [
    {"id": "...", "severity": "major", "category": "...", "description": "...", "suggested_fix": "..."}
  ]
}
```

**Interpretatie-regels:**
- `critical > 0` -> P0-issue, escalatie naar [Rollback_Plan.md](Rollback_Plan.md) trigger T1
- `major > 5` -> review elke issue, fix in week +4
- `minor > 20` -> backlog naar Q2

### 3. Spot-check 10 random items uit Pariteit_Checklist.md

Naast het script: kies handmatig 10 items uit [Pariteit_Checklist.md](Pariteit_Checklist.md) (rouleer per week zodat over 6 weken alle 64 items 1x getest zijn). Documenteer in `docs/parity-spot-check-YYYY-MM-DD.md`:

```markdown
# Pariteit spot-check YYYY-MM-DD

| # | Item | Status | Notitie |
|---|---|---|---|
| 1 | A1 (RLS-isolatie) | ✅ groen | Test-tenant geeft 403 |
| 2 | B5 (consent veld) | ✅ groen | ... |
| ... |
```

### 4. Communicatie

Vrijdag 16:30: post samenvatting in `#talentflow-support`:

```
## Wekelijkse pariteit-check YYYY-MM-DD

Script-rapport: critical 0, major N, minor M
Handmatige spot-check: 10/10 ✅

Top issues:
- ...

Status: groen / oranje / rood
Volgende week-actie: ...
```

Bij rood: maak P1-ticket en plan fix in maandag-standup.

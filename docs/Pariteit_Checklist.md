# Pariteit-Checklist: Manatal -> TalentFlow

**Doel:** binaire (groen/rood) verificatie dat TalentFlow alle voor IT Proposal kritieke Manatal-features dekt vóór go-live.
**Gebruik:** loop deze lijst minimaal 3x door — week -2 (staging), week +1 (final pre-cutover), week +2 (post-cutover smoke).
**Score:** elke check is **groen** (werkt + verifieerbaar) of **rood** (werkt niet of niet verifieerbaar). Geen 'oranje'.

**Gerelateerde docs:**
- [IT_Proposal_Cutover_Plan.md](IT_Proposal_Cutover_Plan.md) — overall cutover-plan
- [SMOKE_RUNBOOK.md](SMOKE_RUNBOOK.md) — post-deploy smoke
- [Manatal_Feature_Pariteit.md](Manatal_Feature_Pariteit.md) — feature-overzicht

**Severity bij rood:**
- **Critical** = blokkeert go-live, geen workaround (auth, data-integriteit, multi-tenant lekken)
- **Major** = werkt niet maar workaround mogelijk; max 10 toegestaan voor GO
- **Minor** = polish, kan in week +3 of later

**Totaal items: 64** verdeeld over 12 categorieën.

---

## A. Authentication & Multi-tenancy (5 items)

### A1. Recruiter logt in en ziet alleen eigen tenant data — Critical
- **Verificatie:** maak 2e tenant `test-tenant-b`, login als IT-Proposal-recruiter, probeer URL met `tenant_id=<test-tenant-b>` als query/header — moet 403 of 404 retourneren, nooit 200 met data.
- [ ] Groen / [ ] Rood

### A2. JWT verloopt na 15 min en wordt vernieuwd via refresh-token — Major
- **Verificatie:** wacht 16 min met inactieve sessie, doe API-call (bv. `/api/candidates`), verwacht: auto-refresh via httpOnly cookie of 401-response die client opvangt.
- [ ] Groen / [ ] Rood

### A3. 9 recruiter-accounts aangemaakt met juiste rollen — Critical
- **Verificatie:** `SELECT email, role FROM users WHERE tenant_id='itproposal'` retourneert exact 9 rijen met de verwachte e-mailadressen + rol-kolom (recruiter/admin/manager waar van toepassing).
- [ ] Groen / [ ] Rood

### A4. Wachtwoord-reset werkt — Major
- **Verificatie:** klik 'Wachtwoord vergeten', voer recruiter-email in, check inbox (Resend dashboard ook), klik link, zet nieuw wachtwoord, login slaagt.
- [ ] Groen / [ ] Rood

### A5. Sessions overleven page-refresh — Major
- **Verificatie:** login, hard-refresh (Ctrl-Shift-R) op dashboard, geen redirect naar /login. Refresh-token cookie blijft, access-token wordt vernieuwd in achtergrond.
- [ ] Groen / [ ] Rood

---

## B. Kandidaatbeheer (10 items)

### B1. 5.540 kandidaten geïmporteerd — Critical
- **Verificatie:** `SELECT COUNT(*) FROM candidates WHERE tenant_id='itproposal'` = 5540 (of dichtbij; afwijking <0.1%).
- [ ] Groen / [ ] Rood

### B2. Per kandidaat zichtbaar: naam, email, telefoon, current position, source, tags — Critical
- **Verificatie:** open random 10 kandidaten in UI, alle 6 velden gevuld + corresponderen met Manatal-export-rij.
- [ ] Groen / [ ] Rood

### B3. CV-bestanden geupload + parsed — Major
- **Verificatie:** `SELECT COUNT(*) FROM cvs WHERE tenant_id='itproposal' AND parse_status IN ('done','pending')` >= 95% van candidates-count. Sample 10 CV's: skills/education/work_history zichtbaar in UI.
- [ ] Groen / [ ] Rood

### B4. candidate_reference uniek + niet-collision — Critical
- **Verificatie:** `SELECT reference, COUNT(*) FROM candidates WHERE tenant_id='itproposal' GROUP BY reference HAVING COUNT(*)>1` retourneert 0 rijen.
- [ ] Groen / [ ] Rood

### B5. GDPR-consent-veld aanwezig + bevestigd — Critical
- **Verificatie:** `SELECT consent_status, COUNT(*) FROM candidates WHERE tenant_id='itproposal' GROUP BY consent_status` toont alle records met `granted` of `inferred` of `pending_review`. Geen NULL.
- [ ] Groen / [ ] Rood

### B6. Skills 1-10 gescoord (van AI parser) — Minor
- **Verificatie:** sample 20 kandidaten met `parse_status='done'`: `skills` JSONB-veld bevat array met `{ name, score 0-10 }`-objects.
- [ ] Groen / [ ] Rood

### B7. Multi-CV per kandidaat zichtbaar — Major
- **Verificatie:** kandidaat met 2+ CV's in Manatal -> in TalentFlow UI 'CV's'-tab toont alle versies met datum.
- [ ] Groen / [ ] Rood

### B8. Sollicitaties zichtbaar per kandidaat — Critical
- **Verificatie:** open kandidaat met meerdere applications in Manatal, in TalentFlow 'Sollicitaties'-tab toont alle jobs met huidige stage + datum.
- [ ] Groen / [ ] Rood

### B9. Tijdlijn rendert per kandidaat — Major
- **Verificatie:** open kandidaat-detail, 'Activiteit'-tab toont chronologische events (created, stage_changed, email_sent, note_added) met user + timestamp.
- [ ] Groen / [ ] Rood

### B10. Zoeken op naam/email/skills werkt — Critical
- **Verificatie:** zoek op 'angelo', 'react', '@itproposal.nl' — relevante resultaten binnen 1s, fuzzy match op naam werkt (typo tolerant via pg_trgm).
- [ ] Groen / [ ] Rood

---

## C. Vacaturebeheer (8 items)

### C1. 24 jobs geïmporteerd — Critical
- **Verificatie:** `SELECT COUNT(*) FROM jobs WHERE tenant_id='itproposal'` = 24.
- [ ] Groen / [ ] Rood

### C2. Job-status correct gemapped (Manatal Active -> TalentFlow open, etc.) — Critical
- **Verificatie:** mapping-tabel: Active->open, On-Hold->paused, Filled->filled, Cancelled->cancelled. `SELECT status, COUNT(*) FROM jobs WHERE tenant_id='itproposal' GROUP BY status` matches Manatal-export verdeling.
- [ ] Groen / [ ] Rood

### C3. Job-detail toont: titel, client, locatie, salary range, owner, beschrijving — Critical
- **Verificatie:** open random 5 jobs, alle 6 velden gevuld en kloppen met Manatal-export.
- [ ] Groen / [ ] Rood

### C4. 6-tab job-detail rendert (Pipeline/Overzicht/AI Suite/Team/Activiteit/Performance) — Major
- **Verificatie:** open job, alle 6 tabs klikbaar, content laadt zonder error <2s.
- [ ] Groen / [ ] Rood

### C5. Health-score wordt berekend — Minor
- **Verificatie:** open job, 'Overzicht'-tab toont health-score 0-100 met uitleg-tooltip ('low candidates in pipeline', etc.).
- [ ] Groen / [ ] Rood

### C6. Predicted close-date verschijnt — Minor
- **Verificatie:** job met >5 candidates in pipeline toont voorspelde sluit-datum + confidence-interval.
- [ ] Groen / [ ] Rood

### C7. /jobs lijst met filters (status/recruiter/datum) werkt — Critical
- **Verificatie:** filter `status=open`, `owner=<recruiter-id>`, `created_after=2026-01-01` — resultaat correct + URL bevat query params (deelbaar).
- [ ] Groen / [ ] Rood

### C8. Vacature dupliceren werkt — Minor
- **Verificatie:** klik 'Dupliceer' op job, opens nieuwe job-form met velden voorgevuld, save -> nieuwe job met `(copy)`-suffix in titel.
- [ ] Groen / [ ] Rood

---

## D. Pipeline + Applications (6 items)

### D1. 9-staps bureau-pipeline op alle jobs aanwezig — Critical
- **Verificatie:** `SELECT job_id, COUNT(*) FROM job_stages WHERE tenant_id='itproposal' GROUP BY job_id` toont 9 stages per job. Stages = Sourced, Screened, Submitted, Interview-1, Interview-2, Offer, Placed, Rejected, On-hold.
- [ ] Groen / [ ] Rood

### D2. Applications aan juiste stages gemapped — Critical
- **Verificatie:** spot-check 10 applications: Manatal-stage matcht TalentFlow-stage (mapping-doc geverifieerd).
- [ ] Groen / [ ] Rood

### D3. Drag-drop verplaatsing werkt + audit-event geschreven — Critical
- **Verificatie:** sleep candidate-card van Sourced naar Screened; `SELECT * FROM audit_events WHERE action='application.stage_changed' ORDER BY created_at DESC LIMIT 1` toont nieuwe rij met before/after stage.
- [ ] Groen / [ ] Rood

### D4. Conversie-percentages tussen stages getoond — Minor
- **Verificatie:** pipeline-header toont 'Sourced->Screened: 60%, Screened->Submitted: 40%' etc.
- [ ] Groen / [ ] Rood

### D5. Time-in-stage badges per kandidaat — Minor
- **Verificatie:** elke candidate-card toont '3d', '12d', '>30d' badge met kleur (groen<7d, oranje 7-30d, rood >30d).
- [ ] Groen / [ ] Rood

### D6. Stage-overgang triggert workflow (als geconfigureerd) — Major
- **Verificatie:** activeer workflow 'send email on Sourced->Screened', sleep candidate, check `workflow_runs` tabel + Resend-log toont email.
- [ ] Groen / [ ] Rood

---

## E. AI Features (7 items)

### E1. Resume parser draait + skills/score/samenvatting in DB — Critical
- **Verificatie:** upload nieuwe CV; binnen 30s `SELECT skills, score, summary FROM cvs WHERE id=<new>` retourneert gevulde JSON-velden + `parse_status='done'`.
- [ ] Groen / [ ] Rood

### E2. AI matching cosine-score > 50% voor relevante kandidaten — Major
- **Verificatie:** open job 'React Developer', AI Suite-tab toont top-10 kandidaten met cosine-score; kandidaten met React-skills hebben score >50%.
- [ ] Groen / [ ] Rood

### E3. AI-explanation bij match toont sterke punten + gaps — Major
- **Verificatie:** klik op match, modal toont 'Strong: React, TypeScript' + 'Gap: Senior-niveau, GraphQL'. Tekst is NL.
- [ ] Groen / [ ] Rood

### E4. EU AI Act art. 13 disclosure zichtbaar bij elke AI-output — Critical
- **Verificatie:** open AI Suite-tab, footer-banner toont 'Deze score is generated door AI (Claude). Zie [link] voor uitleg.' Disclosure ook bij JD-generator + bias-checker.
- [ ] Groen / [ ] Rood

### E5. Talent reactivation alerts — Minor (placeholder OK voor Q1)
- **Verificatie:** UI-stub aanwezig met 'Coming Q2'-banner; geen blokkade voor cutover.
- [ ] Groen / [ ] Rood

### E6. JD bias-checker rendert flags + clarity score — Minor
- **Verificatie:** open job-detail -> AI Suite -> Bias check; toont flags ('rockstar', 'guru' flagged) + clarity-score 0-100.
- [ ] Groen / [ ] Rood

### E7. AI events log (ai_events) bevat rijen per AI-call — Major
- **Verificatie:** `SELECT COUNT(*) FROM ai_events WHERE tenant_id='itproposal' AND created_at > NOW() - INTERVAL '1 hour'` >0 na elke AI-actie. Bevat tokens + latency + provider.
- [ ] Groen / [ ] Rood

---

## F. Communicatie (5 items)

### F1. Email versturen via ComposeEmailModal werkt — Critical
- **Verificatie:** open kandidaat -> 'Email versturen' -> kies template -> verzend; Resend-dashboard toont message-id binnen 30s; activity-log op kandidaat toont 'Email sent'.
- [ ] Groen / [ ] Rood

### F2. Email-templates renderen + merge-vars werken — Major
- **Verificatie:** template met `{{candidate.first_name}}` en `{{job.title}}`; preview toont werkelijke waarden, niet de placeholder.
- [ ] Groen / [ ] Rood

### F3. Inbound webhook ontvangt replies (test met Resend dev-tool) — Major
- **Verificatie:** stuur test-reply via Resend dev-webhook; binnen 1 min verschijnt reply als activity-event op kandidaat met thread-id matching de outbound mail.
- [ ] Groen / [ ] Rood

### F4. Communications-rij wordt aangemaakt per verzonden mail — Critical
- **Verificatie:** `SELECT * FROM communications WHERE tenant_id='itproposal' ORDER BY created_at DESC LIMIT 1` retourneert rij met `direction='outbound'`, `channel='email'`, `subject`, `body`.
- [ ] Groen / [ ] Rood

### F5. Threading via plus-addressing werkt — Minor
- **Verificatie:** outbound mail bevat `From: noreply+<thread-id>@talentflow.app`; reply naar dat adres landt op juiste candidate-thread.
- [ ] Groen / [ ] Rood

---

## G. Workflows (4 items)

### G1. Workflow aanmaken + activeren werkt — Major
- **Verificatie:** Settings -> Workflows -> Nieuw -> kies trigger + action -> opslaan + activeren; `SELECT status FROM workflows WHERE id=<new>` = 'active'.
- [ ] Groen / [ ] Rood

### G2. Trigger 'candidate.stage_changed' fired correct — Critical
- **Verificatie:** sleep kandidaat tussen stages, BullMQ-log toont `workflow-events` job, `workflow_runs` rij toegevoegd binnen 5s.
- [ ] Groen / [ ] Rood

### G3. 7 action-types beschikbaar — Major
- **Verificatie:** in workflow-builder dropdown: send_email, add_tag, move_to_stage, create_task, trigger_webhook, send_whatsapp (parked-badge), send_sms (parked-badge). 5 werkend, 2 parked is OK.
- [ ] Groen / [ ] Rood

### G4. workflow_runs tabel logt elke executie — Critical
- **Verificatie:** `SELECT workflow_id, status, error FROM workflow_runs WHERE tenant_id='itproposal' ORDER BY created_at DESC LIMIT 10` toont successful + failed runs met error-message bij failure.
- [ ] Groen / [ ] Rood

---

## H. Compliance + Audit (5 items)

### H1. audit_events bevat alle write-acties met user/timestamp/before/after — Critical
- **Verificatie:** doe willekeurige write (update kandidaat-naam); `SELECT actor_id, action, before, after, created_at FROM audit_events ORDER BY created_at DESC LIMIT 1` toont volledige rij.
- [ ] Groen / [ ] Rood

### H2. WORM-trigger blokkeert UPDATE/DELETE op audit_events — Critical
- **Verificatie:** als superuser: `UPDATE audit_events SET action='hacked' WHERE id=<any>` -> ERROR door trigger; `DELETE FROM audit_events WHERE id=<any>` -> ERROR.
- [ ] Groen / [ ] Rood

### H3. Per kandidaat: consent-status zichtbaar — Critical
- **Verificatie:** kandidaat-detailpagina toont badge 'Consent: granted' / 'inferred' / 'pending'. GDPR-tab toont consent-history.
- [ ] Groen / [ ] Rood

### H4. AI events bevat tokens + latency + provider — Major
- **Verificatie:** `SELECT provider, model, prompt_tokens, completion_tokens, latency_ms FROM ai_events ORDER BY created_at DESC LIMIT 5` — alle velden gevuld.
- [ ] Groen / [ ] Rood

### H5. Sentry ontvangt errors — Major
- **Verificatie:** trigger bewust een 500 (test-endpoint of fout payload); Sentry-dashboard toont event binnen 30s met stack-trace + user-context (zonder PII).
- [ ] Groen / [ ] Rood

---

## I. CSV import + bulk-acties (4 items)

### I1. CSV bulk import-flow werkt: preview -> mapping -> start -> status -> result — Major
- **Verificatie:** upload CSV met 100 kandidaten; preview toont eerste 5 rijen; field-mapping UI verschijnt; start -> progress-bar; eind: `imported: 100, errors: 0`.
- [ ] Groen / [ ] Rood

### I2. Boolean search parser werkt: `react AND typescript NOT junior` — Major
- **Verificatie:** zoek-veld accepteert query, retourneert kandidaten met React+TS skills, exclueert junior-tagged. Filter-chips tonen geparseerde tokens.
- [ ] Groen / [ ] Rood

### I3. Saved searches: aanmaken, gebruiken, verwijderen — Minor
- **Verificatie:** zoek -> 'Bewaren als' -> naam -> opslaan; verschijnt in zijbalk; klik -> filters herladen; delete-knop werkt.
- [ ] Groen / [ ] Rood

### I4. Bulk-actions: archive, add_tag, change_source, move_to_stage werken op multi-select — Major
- **Verificatie:** select 5 kandidaten, klik 'Bulk' -> archive -> bevestig; `audit_events` rij met `action='bulk_action.performed'` en `after.affected_ids` array van 5 ids.
- [ ] Groen / [ ] Rood

---

## J. Custom fields + Scorecards (3 items)

### J1. Custom fields aanmaken in Settings -> renderen op kandidaat/job-form — Major
- **Verificatie:** Settings -> Custom Fields -> Nieuw -> entity=candidate, type=text, label='LinkedIn URL'; nieuwe kandidaat-form bevat veld; save -> waarde opgeslagen in `custom_fields` JSONB.
- [ ] Groen / [ ] Rood

### J2. Scorecard-formulier rendert + opslaat — Minor
- **Verificatie:** open kandidaat -> Scorecards-tab -> 'Nieuwe scorecard' -> vul in -> save; verschijnt in lijst met datum + recruiter.
- [ ] Groen / [ ] Rood

### J3. Agreement matrix verschijnt bij 2+ scorecards — Minor
- **Verificatie:** twee recruiters scoren dezelfde kandidaat; tab toont matrix met agreement-score (cohen's kappa of equivalent).
- [ ] Groen / [ ] Rood

---

## K. Performance + UX (3 items)

### K1. /candidates lijst van 5.540 records laadt < 3s (cold) — Critical
- **Verificatie:** clear browser cache, login, navigeer naar /candidates; Chrome DevTools Network-tab toont `DOMContentLoaded < 3000ms`. p95 over 10 metingen.
- [ ] Groen / [ ] Rood

### K2. Pipeline-kanban met 50+ kandidaten in 1 stage scrollt vloeiend — Major
- **Verificatie:** open job met >50 kandidaten in Sourced; scroll-FPS via DevTools Performance >= 50fps.
- [ ] Groen / [ ] Rood

### K3. Mobile responsivity (PWA komt Q2) — Minor
- **Verificatie:** open op iPhone Safari; menu klapt in, kandidaten-lijst scrollt, geen horizontale scroll.
- [ ] Groen / [ ] Rood

---

## L. Backup + restore (4 items)

### L1. Daily backup-cron draait en uploadt naar Cloudflare R2 — Critical
- **Verificatie:** `ls /opt/talentflow/backups/` toont bestand van vandaag; R2-console toont object met datum-suffix; cron-log: 'Backup finished successfully'.
- [ ] Groen / [ ] Rood

### L2. Restore-test slaagt (wekelijks via cron) — Critical
- **Verificatie:** spin staging-DB op uit gisteren-backup; `SELECT COUNT(*) FROM candidates` matches productie-count van gisteren.
- [ ] Groen / [ ] Rood

### L3. /health endpoint retourneert 200 — Critical
- **Verificatie:** `curl https://api.talentflow.app/health` -> `{"status":"ok"}`. Better Uptime dashboard toont 99.9% laatste 7 dagen.
- [ ] Groen / [ ] Rood

### L4. Better Uptime monitor geconfigureerd — Major
- **Verificatie:** Better Uptime project actief, monitor op /health + /api/auth/login (200 met geldige creds), alert-channel = Kaan's email + Slack `#talentflow-support`.
- [ ] Groen / [ ] Rood

---

## Samenvatting per categorie

| Cat | Items | Critical | Major | Minor |
|---|---|---|---|---|
| A. Auth & Multi-tenancy | 5 | 2 | 3 | 0 |
| B. Kandidaatbeheer | 10 | 5 | 4 | 1 |
| C. Vacaturebeheer | 8 | 4 | 1 | 3 |
| D. Pipeline | 6 | 3 | 1 | 2 |
| E. AI Features | 7 | 2 | 3 | 2 |
| F. Communicatie | 5 | 2 | 2 | 1 |
| G. Workflows | 4 | 2 | 2 | 0 |
| H. Compliance + Audit | 5 | 3 | 2 | 0 |
| I. CSV + Bulk | 4 | 0 | 3 | 1 |
| J. Custom fields | 3 | 0 | 1 | 2 |
| K. Performance | 3 | 1 | 1 | 1 |
| L. Backup | 4 | 3 | 1 | 0 |
| **Totaal** | **64** | **27** | **24** | **13** |

---

## Run-instructie

1. Print of open dit document op tweede scherm.
2. Loop top-down door, vink elk item.
3. Bij rood: noteer ticket-nummer + severity in opmerkingen-kolom (toe te voegen).
4. Aan einde: tel rode items per severity.
5. **GO-conditie:** 0 critical rood + <=10 major rood + onbeperkt minor.
6. Sla resultaat op als `docs/parity-results-YYYY-MM-DD.md`.

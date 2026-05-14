# IT Proposal Cutover-plan: Manatal -> TalentFlow

**Doel:** IT Proposal verlaat Manatal en werkt vanaf de cutover-datum uitsluitend in TalentFlow als ATS/CRM-platform.
**Stagebegeleider-deliverable:** Bewijst BIM-stage voltooid via succesvolle migratie van 5.540 kandidaten + 24 jobs + 9 recruiters, een week shadow-run, en een gecontroleerde go-live met meetbare pariteit op alle P0-features.

**Verwante documenten:**
- [Masterplan_2027.md](Masterplan_2027.md) — strategische roadmap
- [As_Is_Proces.md](As_Is_Proces.md) — IT Proposal huidige Manatal-flow
- [To_Be_Proces.md](To_Be_Proces.md) — TalentFlow doelflow
- [Manatal_Feature_Pariteit.md](Manatal_Feature_Pariteit.md) — feature-pariteit overview
- [Pariteit_Checklist.md](Pariteit_Checklist.md) — 64-item binaire checklist
- [Rollback_Plan.md](Rollback_Plan.md) — rollback-procedure
- [Hypercare_Plan.md](Hypercare_Plan.md) — week +3 ondersteuning
- [Go_NoGo_Template.md](Go_NoGo_Template.md) — beslissings-template
- [Training_Materiaal_IT_Proposal.md](Training_Materiaal_IT_Proposal.md) — recruiter-onboarding

---

## 0. Stakeholders en RACI

| Rol | Persoon | Verantwoordelijkheid |
|---|---|---|
| Owner / lead engineer | Kaan (BIM-stagiair) | Eindverantwoordelijk technisch + stage-deliverable |
| Recruiter-champion | Angelo (IT Proposal) | Veranderkundig draagvlak + recruiter-coach |
| Recruiters (eindgebruikers) | 9 personen IT Proposal | Shadow-run + acceptatie |
| Stagebegeleider | Hogeschool BIM | Go/No-go-beoordeling + cijfer |
| Technische fallback | Kaan (lokaal) + Manatal-support | Hotfix on-call tijdens hypercare |

RACI-key per fase:
- **Voorbereiding (week -4 t/m -2):** Kaan = R/A, Angelo = C, recruiters = I
- **Training (week -1):** Angelo = R, Kaan = A/C, recruiters = R
- **Shadow-run (week 0):** recruiters = R, Angelo = A, Kaan = C
- **Cutover (week +2):** Kaan = R/A, Angelo = C, recruiters = I (alleen verificatie)
- **Hypercare (week +3 t/m +4):** Kaan = R/A, Angelo = C, recruiters = R (op gebruik)

---

## 1. Tijdlijn (10 weken)

| Week | Fase | Wie | Deliverable |
|---|---|---|---|
| -4 | Voorbereiding | Kaan | Productie-VPS live, smoke-test groen, Manatal-export-procedure getest |
| -3 | Eerste migratie (test) | Kaan | Staging-tenant met volledige Manatal-data via `manatal-import.ts` |
| -2 | Pariteit-check (test) | Kaan + Angelo | `parity-check.ts` rapport met <5 critical issues |
| -1 | Trainings-week | Angelo + recruiters | 9 TalentFlow-accounts, 30 min walkthrough/recruiter, FAQ live |
| 0 | **Shadow-run** | Recruiters | 1 week parallel werk in Manatal + TalentFlow, dagelijkse mini-retro |
| +1 | Final pariteit-check | Kaan + Angelo | Final rapport: 0 critical, <10 major |
| +1 | **Go/No-go meeting** | Kaan + Angelo + stagebegeleider | Decision documented in [Go_NoGo_Template.md](Go_NoGo_Template.md) |
| +2 | Cutover dag | Kaan + Angelo | Manatal read-only, TalentFlow primary, banner aan |
| +3 | Hypercare week 1 | Kaan | Daily standup, snelle fixes, Slack-channel <2u response |
| +4 | Stabiliseren + retro | Kaan + Angelo | Hypercare -> BAU, retrospective + post-mortem |

### Tijdlijn-verdediging

10 weken is gekozen omdat:
- 4 weken voor migratie + pariteit geeft tijd voor twee dry-runs (week -3 staging, week 0 shadow);
- 1 week training is minimum voor 9 recruiters (30 min/persoon + ad-hoc support);
- 1 week shadow-run is minimum bewijs dat dagelijkse workflows werken zonder regression;
- 2 weken hypercare voorkomt dat onverwachte issues in week 1 onbeantwoord blijven.

Compressie naar 6 weken zou mogelijk zijn als we training overslaan (niet acceptabel) of shadow-run overslaan (te risicovol). Verlenging naar 12 weken voegt geen meetbare zekerheid toe.

---

## 2. Pre-flight checklist (week -4 t/m -1)

### Week -4: Infrastructuur ready
- [ ] Hetzner CCX23 VPS provisioned + backup-volume gemount
- [ ] Productie-domeinen DNS + SSL: `talentflow.app`, `api.talentflow.app`, `careers.itproposal.nl` (subdomain optioneel)
- [ ] PostgreSQL 16 met `pg_trgm`, `vector`, `unaccent` extensions
- [ ] Redis 7 + BullMQ workers up
- [ ] MinIO bucket `talentflow-prod-cv` + lifecycle 90 dagen
- [ ] Cloudflare R2 backup-bucket geconfigureerd
- [ ] Sentry + Better Uptime monitor live
- [ ] PM2 + Nginx + Let's Encrypt 4 weken stabiel groen

### Week -3: Eerste migratie (test, staging-tenant)
- [ ] Manatal-export aangevraagd via dashboard (CSV + attachments)
- [ ] Export-bundle ontvangen op encrypted USB + lokale schijf
- [ ] Hash van bundle vastgelegd (SHA-256 in `migrations/exports/checksums.txt`)
- [ ] `apps/api/scripts/manatal-import.ts --tenant=staging-itproposal --dry-run` slaagt
- [ ] Echte import naar staging: `--tenant=staging-itproposal --commit` slaagt zonder errors
- [ ] Audit-trail-rij per geimporteerde entiteit in `audit_events` (action='import.manatal')

### Week -2: Pariteit-check (test)
- [ ] `apps/api/scripts/parity-check.ts --tenant=staging-itproposal --report=docs/parity-test.json` draait
- [ ] Diff-rapport gereviewed: 0 missing kandidaten, 0 missing jobs, <10 missing CV-attachments
- [ ] Alle 64 items uit [Pariteit_Checklist.md](Pariteit_Checklist.md) handmatig nagelopen op staging
- [ ] Performance-test: `/api/candidates?limit=50` op tenant met 5.540 records < 800ms p95
- [ ] Load-test (k6) 50 concurrent users 5 min: 0 errors, p95 < 1.5s

### Week -1: Trainings-week
- [ ] 9 TalentFlow-recruiter-accounts aangemaakt (echte productie-tenant `itproposal`)
- [ ] Recruiters geactiveerd via uitnodigings-mail + temp wachtwoord (forced reset)
- [ ] 30-min 1-op-1 walkthrough per recruiter (door Angelo) — verplicht voor go-live
- [ ] [Training_Materiaal_IT_Proposal.md](Training_Materiaal_IT_Proposal.md) verstuurd als 1-pager NL
- [ ] FAQ-document live op interne wiki + linked in TalentFlow help-tooltip
- [ ] Optioneel: 5-min screencast per kernworkflow opgenomen

---

## 3. Communicatie naar IT Proposal

### Week -4: Kick-off mail
- **Onderwerp:** "TalentFlow gaat live — datum + wat dit voor jou betekent"
- **Inhoud:** waarom (€1.000/m kostenbesparing), wanneer (datum), wat verandert er, wie is contact
- **Verzender:** Kaan + Angelo
- **CC:** management IT Proposal, stagebegeleider

### Week -2: Trainings-uitnodiging
- **Onderwerp:** "Plan je TalentFlow-walkthrough deze week"
- **Inhoud:** 30 min slot inboeken via Calendly-link, voorbereiden = niets, het is laagdrempelig
- **Bijlage:** [Training_Materiaal_IT_Proposal.md](Training_Materiaal_IT_Proposal.md)

### Week 0: Shadow-run-instructies
- **Onderwerp:** "Shadow-run: hoe werk je deze week parallel?"
- **Inhoud:** elke nieuwe kandidaat/sollicitatie/email in *beide* systemen + dagelijkse 5-min retro 16:00 in Slack
- **Doel:** issues vroeg vangen voordat cutover lock erin gaat

### Week +1: Go-live-aankondiging
- **Onderwerp:** "TalentFlow is nu primair — Manatal staat in read-only"
- **Inhoud:** wat nu, hoe steun krijgen, wat als iets stuk is (Slack-channel)
- **Bijlage:** Hypercare-uren + escalatie-pad

### Doorlopend: Slack-channel `#talentflow-support`
- Live vanaf week -1, alle recruiters lid, Angelo + Kaan moderator
- SLA: <2u response op werkdagen tijdens hypercare

---

## 4. Trainings-materiaal

Zie [Training_Materiaal_IT_Proposal.md](Training_Materiaal_IT_Proposal.md) voor volledige inhoud.

### Componenten
1. **30-min walkthrough per recruiter** (1-op-1 met Angelo)
   - Login + tour van hoofdmenu (5 min)
   - Kandidaat aanmaken + CV uploaden + parser-resultaat (5 min)
   - Job openen + pipeline drag-drop + email versturen (5 min)
   - AI Suite tab + matching uitleg + EU AI Act disclosure (5 min)
   - Vragen + eigen workflow doorlopen (10 min)

2. **1-pager NL** met top 10 Manatal -> TalentFlow verschillen — afdrukken op A4

3. **5 video-screencasts** (5 min elk, optioneel)
   - Kandidaat sourcen + parsen
   - Pipeline + stage management
   - Email + templates
   - AI matching gebruiken
   - Bulk-acties + saved searches

4. **FAQ-document** — 20 meest gestelde vragen, live tijdens shadow-run gevoed

5. **Help-tooltip in app** — link naar FAQ vanuit elke pagina

---

## 5. Risico-matrix + mitigaties

| # | Risico | Kans | Impact | Mitigatie |
|---|---|---|---|---|
| R1 | Data-verlies bij import | Laag | Critical | Dry-run + backup + audit-trail + rollback-script + checksum-verificatie |
| R2 | Recruiter weerstand / boycot | Medium | Major | Vroege training + Angelo als champion + parallel-shadow-week + 'we luisteren'-Slack |
| R3 | Performance-issue bij 5.540 kandidaten | Medium | Major | Load-test in week -2 + Hetzner CCX23 plan ready + index-tuning op `candidates(tenant_id, status)` |
| R4 | Manatal API-restrictie tijdens export | Laag | Major | Manatal CSV-export werkt zonder API + back-up via screenscrape + handmatige export per object |
| R5 | Critical pariteit-issues in week +1 | Medium | Critical | Stop cutover, fix, opnieuw shadow-run — geen druk om GO te forceren |
| R6 | CV-parser faalt bij niet-Engelse CV's | Medium | Major | Fallback handmatige parse + tag `parse_status=manual_review` zichtbaar in UI |
| R7 | Email-deliverability (Resend reputatie nieuw) | Medium | Major | DKIM/SPF/DMARC al weken voor cutover ingericht + warm-up van 100 mails/dag in week -2 |
| R8 | VPS-storing tijdens cutover-dag | Laag | Critical | Hetzner status-page monitor + tweede regio backup + escalatie naar Hetzner support |
| R9 | Stage-deliverable timing (BIM-deadline) | Laag | Major | Cutover ruim voor stage-einddatum gepland + buffer van 2 weken |
| R10 | GDPR-issue: kandidaat zonder consent geimporteerd | Medium | Critical | Import zet default `consent_status='inferred'` + recruiters bevestigen consent in week 0 + DPO-review pre-cutover |
| R11 | Wachtwoord-reset werkt niet bij niet-tech-recruiter | Medium | Minor | Angelo doet inlog-assist 1-op-1, temp passwords in versleutelde 1Password vault |
| R12 | Shadow-run dubbel werk irriteert recruiters | Hoog | Major | Beperk shadow-werk tot 5 sleuteltaken + erken extra werk + max 1 week |
| R13 | AI matching geeft onverwachte ranking | Hoog | Minor | Disclosure + 'why this score'-uitleg + recruiter-feedback-loop in eerste week |
| R14 | Job-board posting niet gemigreerd (NL-boards) | Hoog | Minor | Accept gap voor cutover + roadmap-item Q2; gebruik Indeed organic via career-page |
| R15 | Custom fields uit Manatal worden niet 1:1 herkend | Medium | Major | Pre-import mapping-document + recruiter-review op staging in week -2 |

---

## 6. Go/No-go criteria

### GO als ALLE onderstaande criteria groen zijn

- [ ] **0 critical pariteit-issues** in laatste rapport (Pariteit_Checklist.md categorie A-L)
- [ ] **<10 major pariteit-issues** met workaround gedocumenteerd
- [ ] Stagebegeleider tevreden met BIM-deliverables (schriftelijke akkoord)
- [ ] Angelo tekent go/no-go-formulier ([Go_NoGo_Template.md](Go_NoGo_Template.md))
- [ ] Backup van Manatal-export op 3 plaatsen: lokaal SSD, Cloudflare R2, encrypted USB
- [ ] Rollback-procedure getest op staging (binnen 30 min freeze + Manatal heractiveer)
- [ ] Hypercare-recruiter (Kaan) beschikbaar voor +3 dagen full-time
- [ ] Shadow-run-feedback overwegend positief (>=7/9 recruiters: 'kan ermee werken')
- [ ] /health endpoint groen + Better Uptime 7 dagen 99.9%
- [ ] Performance op productie: kandidaten-lijst van 5.540 < 3s (cold), < 1s (warm)
- [ ] DKIM/SPF/DMARC live + warm-up afgerond, Resend reputatie groen
- [ ] DPO-review GDPR-flow akkoord (consent + retention + export)

### NO-GO triggers (1+ activeert besluit)

- 1+ critical pariteit-issue niet opgelost
- Recruiter-feedback overwegend negatief (>=4/9 zegt 'niet productie-rijp')
- Performance < target (page-load > 3s op kandidaten-lijst van 5.540) op meerdere meetmomenten
- VPS instabiel laatste 7 dagen (>1 onverwachte downtime)
- Backup-restore-test gefaald in week -2
- Email-deliverability onder 95% in warm-up week
- Stagebegeleider geeft tussenoordeel onvoldoende

---

## 7. Cutover-dag draaiboek (uur-per-uur)

**Datum:** zaterdag (gekozen om productieve werkweek niet te raken)
**Start:** 08:00 — eind: 16:00 — buffer: 16:00-20:00 voor ad-hoc fixes

| Tijd | Stap | Actor | Verificatie |
|---|---|---|---|
| 08:00 | T-0 communicatie: 'cutover begint' Slack + mail | Kaan | Bericht verzonden |
| 08:05 | Manatal in read-only zetten (admin -> account -> freeze writes) | Kaan | Test-write Manatal -> 403 |
| 08:15 | Final delta-export Manatal (alle wijzigingen sinds week -3-snapshot) | Kaan | CSV bestand ontvangen, SHA-256 OK |
| 08:30 | Backup van huidige TalentFlow productie-DB | Kaan | Dump-bestand op R2, restore-test slaagt |
| 08:45 | Run `manatal-import.ts --tenant=itproposal --delta --commit` | Kaan | Exit code 0, audit_events rijen +N |
| 09:30 | Run `parity-check.ts --tenant=itproposal --strict` | Kaan | 0 critical, rapport opgeslagen |
| 10:00 | Smoke-test post-cutover (zie SMOKE_RUNBOOK.md sectie 'Post-cutover smoke') | Kaan | 12/12 groen |
| 10:30 | Banner aan in TalentFlow: 'TalentFlow is nu primair' | Kaan | UI-check live |
| 10:45 | Banner aan in Manatal: 'Read-only, gebruik TalentFlow' | Kaan | UI-check Manatal |
| 11:00 | Email naar 9 recruiters: 'Cutover voltooid, login via..' | Angelo | Mail verzonden |
| 11:15 | Eerste recruiter-login + smoke (Angelo doet als eerste) | Angelo | Login OK, kandidaat zichtbaar |
| 11:30 | Watch-window — monitor Sentry + logs live | Kaan | Geen errors >1/min |
| 12:00 | Lunchpauze met telefonische bereikbaarheid | Kaan | Telefoon aan |
| 13:00 | Steekproef: Kaan logt in als 3 random recruiters, doet smoke | Kaan | 3/3 geslaagd |
| 13:30 | DNS-check: career-page subdomain naar productie | Kaan | Public URL 200 |
| 14:00 | Workflow-engine activeren voor itproposal-tenant | Kaan | `/api/workflows` lijst toont actieve workflows |
| 14:30 | Job-board re-publish: 24 jobs publiceren naar career-page | Kaan | Publieke jobs zichtbaar |
| 15:00 | Final go-live-check: 64 items uit Pariteit_Checklist.md spot-sample (10 random) | Kaan | 10/10 OK |
| 15:30 | Hypercare-handover briefing met Angelo | Kaan + Angelo | Briefing afgerond |
| 16:00 | Communicatie 'cutover voltooid' naar IT Proposal + stagebegeleider | Kaan | Mail + Slack verzonden |
| 16:00-20:00 | Buffer-uren voor ad-hoc | Kaan | On-call |

---

## 8. Hypercare (week +3 t/m +4)

Zie [Hypercare_Plan.md](Hypercare_Plan.md) voor volledige details.

### Quick-summary
- **Daily 15-min standup** met Angelo (09:30) — issues, fixes, blokkers
- **Slack-channel `#talentflow-support`** met **<2u response-tijd** op werkdagen 09:00-17:00
- **On-call rotatie:** Kaan 9-17, fallback = Angelo documenteert issue voor volgende ochtend
- **Burn-down chart**: open issues per dag, target = trend naar 0 in week +3
- **Daily-Sentry-review** + **dagelijkse health-check** (5 items, zie SMOKE_RUNBOOK.md)
- **Hypercare exit-criteria** (eind week +4):
  - 0 P0/P1 issues open
  - <5 P2 issues open
  - Recruiter-NPS >=7 in eind-survey
  - Geen onverwachte downtime laatste 7 dagen

### Werkwijze-keuze: daily standup synchroon (niet async)

Gekozen vanwege:
- 9 recruiters + Angelo + Kaan = klein team, synchroon is haalbaar
- Vroege detectie blockers belangrijker dan kalender-vrijheid
- Recruiter-comfort: Angelo's gezicht 's ochtends = veiligheid
- Async kanaal blijft beschikbaar via Slack 24/7

---

## 9. Post-mortem template

Zie [Hypercare_Plan.md](Hypercare_Plan.md) sectie 'Retrospective einde week 3'.

### Sectie-skelet
1. **Tijdlijn van de cutover** — feiten, geen interpretatie
2. **Wat ging goed** — minimaal 5 punten
3. **Wat ging niet goed** — minimaal 5 punten, met root-cause-niveau ('5x waarom')
4. **Verrassingen** — dingen die we niet voorspeld hadden
5. **Lessons learned** — actie-items met owner + deadline
6. **Metrics** — kandidaten gemigreerd, errors per dag, recruiter-tijd-besteed, Sentry-events
7. **Recommendaties voor volgende cutover** — als TalentFlow andere klant onboardt
8. **Stage-reflectie** — wat heeft Kaan persoonlijk geleerd, wat zou hij anders doen
9. **Stagebegeleider-input** — schriftelijke feedback met handtekening

Deadline: binnen 7 dagen na hypercare-einde.

---

## 10. Stage-deliverables (BIM-spoor)

| Deliverable | Wanneer | Bewijs |
|---|---|---|
| Cutover-plan (dit document) | Week -4 | Document opgeslagen + reviewed door stagebegeleider |
| Pariteit-rapport | Week -2 + Week +1 | JSON-rapporten in repo + samenvatting in Go/NoGo-doc |
| Migratie-script + audit-trail | Week -3 | `manatal-import.ts` werkt + audit_events bevat rijen |
| Trainings-materiaal | Week -1 | 1-pager + screencasts + FAQ |
| Shadow-run-bewijs | Week 0 | Dagelijkse retro-notes + recruiter-feedback-doc |
| Go/No-go-besluit | Week +1 | Getekend formulier |
| Hypercare-log | Week +3 t/m +4 | Issue-tracker export + burn-down |
| Post-mortem | Week +5 | Document + presentatie aan stagebegeleider |
| Eindpresentatie | Stage-einde | 30 min presentatie + Q&A |

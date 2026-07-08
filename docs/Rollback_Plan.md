# Rollback-plan: TalentFlow -> Manatal

**Doel:** als IT Proposal na cutover niet kan werken op TalentFlow, schakelen we binnen 30 minuten terug naar Manatal als bron-of-truth, zonder data-verlies van pre-cutover staat.

**Verwante docs:**
- [IT_Proposal_Cutover_Plan.md](IT_Proposal_Cutover_Plan.md) — overall cutover-plan
- [Hypercare_Plan.md](Hypercare_Plan.md) — hypercare-werkwijze waarin rollback besluit valt
- [SMOKE_RUNBOOK.md](SMOKE_RUNBOOK.md) — post-cutover smoke-tests

---

## 1. Wanneer rollback?

### Trigger-criteria (1+ activeert besluit-procedure)

| # | Trigger | Severity | Detectie |
|---|---|---|---|
| T1 | Critical pariteit-issue ontdekt na cutover | Critical | Smoke-test rood + reproducibel |
| T2 | Data-verlies of corruptie waarneembaar | Critical | DB-checksum mismatch, missende records, foutieve relations |
| T3 | Performance < accepteerbaar voor 4+ uur | Major | Page-load > 5s p95, Sentry errors > 50/uur |
| T4 | Recruiter-meerderheid (>5/9) kan niet werken | Major | Slack-channel meldingen + standup-feedback |
| T5 | Security-incident (data-leak, RLS-bypass) | Critical | Sentry alert + manuele verificatie |
| T6 | Email-deliverability < 80% in eerste 24u | Major | Resend dashboard + bounce-rate |
| T7 | VPS-instabiliteit (>2 onverwachte downtimes in 24u) | Major | Better Uptime + Hetzner status |

### Severity-driven respons

- **Critical-trigger:** rollback-besluit binnen 1 uur, executie binnen 30 min daarna
- **Major-trigger:** evalueer hotfix-mogelijkheid eerst (max 4 uur), pas daarna rollback-besluit
- **Minor:** geen rollback, hypercare-fix-flow

---

## 2. Beslissings-procedure

### Stap 1: Detectie + log
- Wie het opmerkt: post in `#talentflow-support` met severity-tag + screenshot + reproductie-stappen.
- Kaan triageert binnen 30 min werkdag, binnen 1 uur off-hours.

### Stap 2: Beslis-call (Kaan + Angelo, optioneel stagebegeleider)
- Binnen 1 uur na detectie van critical, binnen 4 uur major.
- Vraag-volgorde:
  1. **Reproduceerbaar?** Nee -> blijf monitoren, geen rollback. Ja -> verder.
  2. **Hotfix mogelijk in 2 uur?** Ja -> probeer hotfix, monitor; rollback-paraat. Nee -> verder.
  3. **Workaround mogelijk?** Ja -> document workaround, geen rollback. Nee -> verder.
  4. **Impact > 50% van recruiters?** Ja -> rollback. Nee -> evalueer per recruiter.

### Stap 3: Rollback-go
- Kaan en Angelo schriftelijk akkoord (Slack-thread of formulier).
- Stagebegeleider notificeren binnen 1 uur na go.
- Incident-ticket aanmaken in `docs/incidents/INC-YYYYMMDD-<slug>.md`.

### Stap 4: Communicatie pre-rollback
- Slack `#talentflow-support`: 'Rollback binnen 30 min, bewaar nu je open werk'.
- Mail naar 9 recruiters + management binnen 5 min na go-besluit.

---

## 3. Technische rollback-stappen (binnen 30 min uitvoerbaar)

### Stap 1: Freeze TalentFlow (mark read-only) — 0-5 min

```sql
-- via psql admin connection
UPDATE tenants SET is_readonly = true, readonly_reason = 'rollback-incident-INC-YYYYMMDD'
WHERE slug = 'itproposal';
```

- API-middleware `tenantReadonly.ts` blokkeert alle `POST/PUT/PATCH/DELETE` met **HTTP 503** + body `{"error":"maintenance","message":"TalentFlow is in onderhoud. Werk in Manatal."}`
- UI haalt `/api/tenants/me` op login en toont **rode banner** boven aan: 'TalentFlow is in onderhoud. Werk in Manatal.'
- BullMQ workers pauzeren outbound emails en webhooks voor deze tenant.

**Verificatie:** test-write via curl -> 503; UI toont banner.

### Stap 2: Backup huidige TalentFlow-staat — 5-10 min

```bash
ssh talentflow-deploy@91.98.232.104 '/opt/talentflow/infra/backup.sh --tenant=itproposal --suffix=pre-rollback'
```

- Reden: data uit shadow-run + cutover-window willen we *niet* verliezen — eventueel later mergen.
- Bestand opgeslagen in R2 + lokaal SSD met datestamp + `pre-rollback` suffix.

### Stap 3: Manatal heractiveren — 10-15 min

- Manatal-abonnement was 'paused' (niet 'cancelled') in week +2 cutover-stap.
- Login Manatal-admin -> Account -> Subscription -> Resume.
- 9 recruiters hebben Manatal-credentials nog (we hebben ze niet uitgeschakeld).
- Stuur reset-mail naar recruiters die wachtwoord vergeten zijn.

**Verificatie:** Angelo logt in op Manatal en kan write-actie doen (test-tag toevoegen aan kandidaat).

### Stap 4: Sync-back van shadow-run-data — 15-25 min

**Optie A (preferred):** gebruik laatste pre-cutover Manatal-export als bron-of-truth.
- Cutover was zaterdag, week +2; pre-cutover-export was zaterdag-ochtend.
- Recruiters werken vanaf maandag verder in Manatal alsof cutover nooit gebeurd is.
- Shadow-run-data uit week 0 is al in Manatal (parallel werken).
- Cutover-week-data (max 2-7 dagen) gaat verloren — accepteer dit als kost.

**Optie B (als verlies onacceptabel):** run reverse-import-script.
```bash
ssh talentflow-deploy@91.98.232.104 \
  'cd /opt/talentflow && node apps/api/scripts/manatal-import.ts \
    --rollback-tenant=itproposal \
    --since="<cutover-timestamp>" \
    --target=manatal-csv \
    --output=/tmp/talentflow-delta.csv'
```
- Dit genereert een CSV met alle TalentFlow-wijzigingen sinds cutover.
- Importeer CSV in Manatal via Manatal's bulk-import.
- **Risico:** Manatal's CSV-import dekt niet alle field-types (geen rich activity-log, geen workflow-runs). Accepteer gedeeltelijke restore.

**Beslissing-criterium:** als <3 dagen sinds cutover en <50 nieuwe events, kies optie A. Anders optie B.

### Stap 5: Communicatie post-rollback — 25-30 min

**Mail naar IT Proposal:**
> Onderwerp: TalentFlow tijdelijk offline — werk in Manatal
>
> Beste team,
> 
> We zijn vandaag tegen [issue X] aangelopen die we niet binnen onze SLA konden oplossen. We hebben TalentFlow in onderhoud-modus gezet en jullie kunnen weer normaal in Manatal werken.
> 
> Wat dit voor jou betekent:
> - Login Manatal: zelfde credentials als voor de cutover
> - Werk dat je in TalentFlow gedaan hebt sinds [datum] is bewaard maar nog niet teruggesyncd; we doen dat handmatig deze week
> 
> We bellen Angelo deze week voor een nieuw cutover-plan.
> 
> Sorry voor de overlast,
> Kaan & Angelo

**Slack-channel `#talentflow-support`:**
- Pin: 'TalentFlow ROLLBACK actief vanaf [tijdstip]. Werk in Manatal. Issue-tracker: INC-YYYYMMDD'
- Update: hourly tot post-mortem klaar

**Stagebegeleider:**
- Telefoon + mail binnen 1 uur na rollback-execute.
- Reframe: dit is geen falen, dit is hoe rollback hoort te werken (= bewijs van solide planning).

### Stap 6: Post-mortem — binnen 7 dagen

Schema voor `docs/incidents/INC-YYYYMMDD-<slug>.md`:

```markdown
# Incident INC-YYYYMMDD: <slug>

## Tijdlijn
- HH:MM detectie
- HH:MM beslis-call
- HH:MM rollback-go
- HH:MM freeze TalentFlow
- HH:MM Manatal heractiveer
- HH:MM communicatie

## Root cause (5x waarom)
1. Waarom faalde X? -> Y
2. Waarom Y? -> Z
... tot je echte oorzaak bereikt.

## Impact
- Recruiters geblokkeerd: N
- Tijd geblokkeerd: H uren
- Data-verlies: ja/nee + omvang
- Financieel: € verloren productiviteit

## Wat ging goed
- Detectie binnen X min
- Rollback in <30 min
- ...

## Wat ging niet goed
- ...

## Actie-items
| # | Actie | Owner | Deadline |
|---|---|---|---|
| 1 | Fix root cause | Kaan | datum |
| 2 | Aanvullende test toevoegen | Kaan | datum |
| 3 | Tweede cutover-poging plannen | Kaan + Angelo | datum |

## Lessons learned
- ...
```

---

## 4. Tweede cutover-poging

Na succesvolle root-cause-fix:
- **Niet eerder dan 2 weken na rollback** (cooling-off + recruiter-vertrouwen herwinnen)
- Volg verkort schema: week -2 staging-test + week -1 training-refresh + nieuw shadow-run + cutover
- Vereiste: rollback-trigger niet meer reproduceerbaar in staging
- Verzwaarde Go/No-go: geen majors openstaand

---

## 5. Rollback-test (verplicht in week -2)

**Doel:** voor cutover bewijzen dat rollback werkt.

### Procedure
1. In staging-omgeving: simuleer cutover (run import + smoke).
2. Activeer rollback-script: `manatal-import.ts --rollback-tenant=staging-itproposal --since=<dummy>`.
3. Verificeer:
   - Tenant in read-only modus binnen 5 min
   - Banner verschijnt
   - Backup-bestand op R2 met juiste suffix
   - Optie B reverse-import genereert geldige CSV
4. Documenteer doorlooptijd; moet < 30 min zijn.
5. Sla rapport op als `docs/rollback-test-YYYY-MM-DD.md`.

**GO-criterium:** rollback-test slaagt = mag cutover doorgaan.

---

## 6. Verantwoordelijkheden

| Wie | Wanneer rollback-paraat? |
|---|---|
| Kaan | Week +2 t/m +4 hypercare: 24/7 telefonisch bereikbaar |
| Angelo | Week +2 t/m +4: kantooruren bereikbaar voor recruiter-communicatie |
| Hetzner support | 24/7 (basisplan) — alleen voor VPS-issues |
| Manatal support | Werkdagen 9-17 Bangkok-tijd — voor heractiveer-vragen |

---

## 7. Acceptabele restcost van rollback

We accepteren dat een rollback betekent:
- Cutover-deliverable telt nog steeds als geslaagde stage-leeruitkomst (we documenteren beslissing + executie)
- Data uit cutover-week kan partial-loss hebben (max ~50 nieuwe events)
- IT Proposal blijft Manatal-licentie betalen tot 2e cutover (1 maand ≈€620 extra, zie TCO_ROI.md)
- TalentFlow productie-tenant blijft in read-only tot 2e cutover

Dit zijn **bewuste keuzes** om risico bij eindgebruikers te minimaliseren. Een rollback is geen falen — een rollback die te laat komt of niet werkt is wel falen.

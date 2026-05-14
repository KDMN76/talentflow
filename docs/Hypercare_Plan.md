# Hypercare-plan: TalentFlow IT Proposal — week +3 t/m +4

**Doel:** garanderen dat IT Proposal in de eerste 14 dagen na cutover stabiel productief is, snel-fixes voor blockers krijgt en geen onverwachte downtime ervaart.

**Verwante docs:**
- [IT_Proposal_Cutover_Plan.md](IT_Proposal_Cutover_Plan.md) — overall plan
- [Rollback_Plan.md](Rollback_Plan.md) — escalatie naar rollback indien nodig
- [SMOKE_RUNBOOK.md](SMOKE_RUNBOOK.md) — daily health-check (5 items)
- [Pariteit_Checklist.md](Pariteit_Checklist.md) — wekelijkse spot-check

---

## 1. Hypercare-kader

### Looptijd
- **Week +3:** dag 1-7 na cutover (intensief, daily standup)
- **Week +4:** dag 8-14 na cutover (gestabiliseerd, async)
- **Week +5+:** BAU (business-as-usual) — issue-tracker via Slack-channel, weekly check-in

### Beschikbaarheid
| Wie | Werkdagen 9-17 | Werkdagen 17-21 | Weekend |
|---|---|---|---|
| Kaan (lead) | Real-time op Slack | <2u response | <4u response (alleen P0) |
| Angelo (champion) | Real-time op Slack | Doorzetter naar Kaan | Niet beschikbaar |
| Hetzner support | 24/7 (basisplan) | 24/7 | 24/7 |

### Werkwijze-keuze: synchroon daily standup (niet async)

Synchroon (15-min Zoom of in-person) is **gekozen** boven async (Slack-update) vanwege:
- 9 recruiters + Angelo + Kaan = klein team, synchroon haalbaar
- Vroege detectie van blockers belangrijker dan kalender-vrijheid
- Recruiter-comfort: Angelo's gezicht 's ochtends = veiligheid + verminder weerstand
- Async kanaal blijft beschikbaar via Slack 24/7 voor on-the-fly issues
- Bovendien: synchroon dwingt ook Kaan om dagelijks aanwezig te zijn (geen drift)

Na week +3 wordt standup async (Slack-update door Angelo) tenzij P0-issue actief is.

---

## 2. Daily standup-template (15 min, 09:30)

**Locatie:** Zoom-link in Slack-channel `#talentflow-support`
**Aanwezig:** Kaan + Angelo + 2 random recruiters (rouleert)
**Format:** elke deelnemer 2 min — 'wat ging gisteren goed', 'waar liep ik tegenaan', 'wat heb ik vandaag nodig'.

### Standaard-agenda

```
09:30 — Welkom + standup-volgorde
09:32 — Recruiter-update (3-5 min)
   - Wat werkte gisteren in TalentFlow?
   - Wat blokkeerde je?
   - Hoeveel tijd kostte het vergeleken met Manatal?
09:37 — Angelo-update (2 min)
   - Top issues in Slack-channel afgelopen 24u
   - Recruiter-stemming
   - Trainings-needs
09:39 — Kaan-update (3 min)
   - Sentry events afgelopen 24u
   - Performance metrics
   - Fixes geshipped
   - Vandaag prioriteit
09:42 — Discussie + besluiten (3 min)
   - Issue prioritering
   - Eventuele escalatie naar rollback?
09:45 — Einde
```

### Standup-notulen template (Slack-thread per dag)

```
# Standup YYYY-MM-DD

## Aanwezig
- Kaan, Angelo, [recruiter-1], [recruiter-2]

## Yesterday
- ...

## Today
- ...

## Blockers
- ...

## Issues open (link naar tracker)
- P0: 0
- P1: 2
- P2: 4

## Sentry afgelopen 24u
- N events, M unieke fouten

## Decisions
- ...
```

---

## 3. Issue-tracker template (Slack-channel `#talentflow-support`)

### Severity-rubriek

| Severity | Definitie | Response-tijd | Resolution-target |
|---|---|---|---|
| **P0** | Recruiter-meerderheid kan niet werken; data-corruptie; security | Onmiddellijk | <4 uur of trigger rollback |
| **P1** | 1+ recruiter geblokkeerd; werkflow stuk | <2 uur op werkdagen | <24 uur |
| **P2** | Bug met workaround; cosmetic | <1 dag | <1 week |
| **P3** | Feature-request | <2 dagen | Backlog naar Q2 |

### Issue-template (post in Slack-channel)

```
[P-?] [Korte titel]

**Wie:** [recruiter-naam]
**Wat probeerde je:** [actie]
**Wat gebeurde:** [observatie]
**Wat verwachtte je:** [verwachting]
**Stappen om te reproduceren:**
1. ...
2. ...
**Browser:** Chrome/Firefox/Safari + versie
**Screenshot:** [bijgevoegd]
**Tijdstempel:** YYYY-MM-DD HH:MM
**Candidate/job ID indien relevant:** ...
```

### Issue-status-flow

```
new -> triaged -> in-progress -> in-review -> shipped -> verified -> closed
                                                                |
                                                            of -> rolled-back
```

Slack-thread per issue; emoji-status update:
- :eyes: triaged
- :hammer_and_wrench: in-progress
- :rocket: shipped
- :white_check_mark: verified

### Burn-down chart

Bijgehouden in `docs/hypercare-burndown-YYYYMMDD.md`:

| Dag | P0 open | P1 open | P2 open | P3 backlog | Notities |
|---|---|---|---|---|---|
| Dag 1 | 0 | 5 | 8 | 4 | Cutover-dag |
| Dag 2 | 0 | 4 | 9 | 4 | 1 P1 fixed, 1 nieuwe P2 |
| Dag 3 | 0 | 2 | 7 | 5 | ... |
| ... | ... | ... | ... | ... | ... |

Target: P0=0 elke dag, P1 trend naar 0 in week +3, P2 trend naar 0 in week +4.

---

## 4. Escalatie-pad

### Niveau 1: recruiter -> Angelo (in Slack-channel)
- Trigger: dagelijkse vragen, kleine issues
- SLA: <2 uur response op werkdagen

### Niveau 2: Angelo -> Kaan
- Trigger: technical issue Angelo niet kan oplossen, P1+ issue
- Channel: directe ping (`@Kaan` in Slack of telefoon bij P0)
- SLA: <30 min werkdagen, <2u off-hours, <4u weekend (P0 only)

### Niveau 3: Kaan -> rollback-besluit
- Trigger: P0-issue niet binnen 4u oplosbaar; data-loss; security-incident
- Procedure: zie [Rollback_Plan.md](Rollback_Plan.md) sectie 'Beslissings-procedure'
- Wie: Kaan + Angelo binnen 1u; stagebegeleider notify

### Niveau 4: Hetzner support
- Trigger: VPS-storing, network-issue, performance-issue niet door code/db verklaarbaar
- Channel: Hetzner ticket portal
- SLA: 4u reactietijd basisplan

### Niveau 5: Manatal heractiveren (= rollback)
- Trigger: niveau 3 escalatie, rollback-go besloten
- Procedure: zie [Rollback_Plan.md](Rollback_Plan.md) stap 3

---

## 5. Daily health-check (5 items, door Kaan elke ochtend 08:30)

(Deze sectie ook in [SMOKE_RUNBOOK.md](SMOKE_RUNBOOK.md) gerefereerd.)

1. **`/health` retourneert 200**
   ```bash
   curl -fsS https://api.talentflow.app/health
   ```
2. **Sentry events afgelopen 24u <50** — open Sentry-dashboard
3. **Better Uptime laatste 24u 100%** — open dashboard
4. **Backup van afgelopen nacht aanwezig in R2** — controleer object met datestamp van vandaag
5. **PostgreSQL connections <80% van max** — `psql -c "SELECT count(*) FROM pg_stat_activity"` < 80

Resultaat dagelijks geplakt in Slack-channel als thread.

---

## 6. Wekelijkse pariteit-spot-check

Elke vrijdag om 16:00 (week +3 + week +4):

1. Kies 10 random items uit [Pariteit_Checklist.md](Pariteit_Checklist.md)
2. Voer ze uit op productie-tenant
3. Documenteer in `docs/parity-spot-check-YYYY-MM-DD.md`
4. Bij 1+ regressie: maak P1-issue + Kaan fix in week +4

---

## 7. Recruiter-NPS survey (eind week +4)

Bij hypercare-exit (dag 14): stuur 2-min survey naar 9 recruiters.

### Survey-vragen

1. Op schaal 1-10: hoe waarschijnlijk raad je TalentFlow aan je collega-recruiter aan? (NPS-vraag)
2. Wat werkte beter dan Manatal? (open)
3. Wat werkte slechter dan Manatal? (open)
4. Top 3 feature-requests voor Q2: (open)
5. Wil je een 1-op-1 met Kaan voor diepere feedback? (ja/nee)

### Hypercare exit-criteria
- NPS gemiddelde >=7
- 0 P0/P1 issues open
- <5 P2 issues open
- Geen onverwachte downtime laatste 7 dagen
- Sentry-rate stabiel <10/dag

Als criteria niet gehaald: hypercare verlengen met week +5.

---

## 8. Retrospective einde week +3 (60 min)

**Aanwezig:** Kaan + Angelo + 3 recruiters + stagebegeleider (optioneel)

### Format: 4 L's

1. **Liked** (15 min) — wat ging goed
2. **Learned** (15 min) — wat hebben we ontdekt
3. **Lacked** (15 min) — wat misten we
4. **Longed for** (10 min) — wat wensen we voor volgende cutover
5. **Action items** (5 min) — wie pakt wat op

### Output: `docs/retro-hypercare-week3.md`

| Sectie | Top 3 |
|---|---|
| Liked | 1. ... 2. ... 3. ... |
| Learned | 1. ... 2. ... 3. ... |
| Lacked | 1. ... 2. ... 3. ... |
| Longed for | 1. ... 2. ... 3. ... |

| # | Actie | Owner | Deadline |
|---|---|---|---|
| 1 | _____ | _____ | _____ |

---

## 9. Post-mortem (einde week +4) — voor stage-deliverable

Format zie [IT_Proposal_Cutover_Plan.md](IT_Proposal_Cutover_Plan.md) sectie 9.

### Verplicht voor BIM-portfolio:
- Tijdlijn van cutover-week
- Wat ging goed (>=5 punten)
- Wat ging niet goed (>=5 punten met '5x waarom')
- Verrassingen
- Lessons learned met action items
- Metrics: kandidaten gemigreerd, errors per dag, recruiter-tijd-besteed
- Recommendaties voor 2e cutover (als TalentFlow andere klant onboardt)
- Stage-reflectie persoonlijk (Kaan)
- Stagebegeleider-input + handtekening

Deadline: 7 dagen na hypercare-einde -> presentatie aan stagebegeleider.

---

## 10. Hypercare-werkwijze samengevat

| Frequentie | Wie | Wat |
|---|---|---|
| Continu | Kaan, Angelo | Slack `#talentflow-support` monitoren |
| 08:30 dagelijks | Kaan | Daily health-check (5 items) |
| 09:30 dagelijks (week +3) | Kaan + Angelo + 2 recruiters | Daily standup 15 min |
| 16:00 dagelijks | Kaan | Sentry + burn-down update |
| Vrijdag 16:00 | Kaan | Wekelijkse pariteit-spot-check |
| Eind week +3 | Hele team | Retrospective 60 min |
| Eind week +4 | 9 recruiters | NPS-survey |
| Eind week +4 | Kaan | Post-mortem document |
| Eind week +4 + 7d | Kaan | Presentatie aan stagebegeleider |

---

## 11. Communicatie tijdens hypercare

### Recruiter-naar-team
- Slack `#talentflow-support` 24/7 open
- Issues volgens template in sectie 3

### Team-naar-recruiters
- **Dagelijks:** standup-notulen in Slack-channel
- **Wekelijks vrijdag:** weekoverzicht: 'deze week shipped X fixes, Y open issues, status groen/oranje'
- **Bij downtime:** real-time updates in Slack + status-page

### Team-naar-stagebegeleider
- **Wekelijks:** mail met burn-down chart + key metrics
- **Bij P0-incident:** telefoon + mail binnen 1u
- **Eind week +4:** post-mortem + presentatie

---

## 12. Hypercare-budget

Indien commercieel relevant (later):
- Kaan-uren week +3: full-time (40u)
- Kaan-uren week +4: half-time (20u)
- Angelo-uren: per recruiter-vraag, geschat 5u/week
- Hetzner-support: contract basisplan
- Communicatie-tools: Slack (al in gebruik), Better Uptime (al in gebruik)
- Geen extra subscription-kosten voor hypercare

Voor de stage-context is dit een leertijd-investering, geen externe factuur.

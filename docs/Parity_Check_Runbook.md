# Parity-Check Runbook — Q1.3 Cutover Shadow-Run

Status: Sprint Q1.3 — IT Proposal cutover-prep
Owner: TalentFlow Platform Team
Last updated: zie git log

## Doel

Bewijzen dat de TalentFlow-database 1-op-1 overeenkomt met Manatal aan het einde van de 1-week shadow-run. Pas dan kan IT Proposal de cutover groen geven.

De parity-checker leest geëxporteerde Manatal-CSVs, vergelijkt ze met de live TalentFlow-tenant, en levert een diff-rapport (JSON, Markdown, CSV). Critical mismatches blokkeren cutover; majors zijn besluitpunten; minors documenteren we.

## Wanneer draaien?

| Moment                              | Doel                                                                              |
|-------------------------------------|-----------------------------------------------------------------------------------|
| T-7 dagen (start shadow-run)        | Baseline-rapport — bevestig dat initiele import compleet was.                     |
| Dagelijks tijdens shadow-run        | `--watch 1440` (24u) of cron — vang nieuwe drift vroeg af.                        |
| T-1 dag (vooravond cutover)         | Verse Manatal-export + finale check — go/no-go input voor stuurgroep.             |
| T+0 (cutover-dag, ochtend)          | Final-final check vlak voor afsluiten Manatal-account.                            |
| T+7 (eerste week na cutover)        | Sanity-check op "verloren" mutaties.                                              |

## Vereisten

1. Toegang tot de TalentFlow-database (DATABASE_URL in `.env`).
2. IT Proposal Manatal-account → handmatig CSV-export van candidates / jobs / applications. Sla op in `./manatal-export-week-N/`.
3. `npm install` heeft gedraaid; `tsx` is beschikbaar (`devDependencies`).
4. De tenant-UUID van IT Proposal in TalentFlow (zoek via `SELECT id FROM tenants WHERE name = 'IT Proposal'`).

## Stap 1 — Verse Manatal-export

In Manatal: Reports → Export → kies CSV per entiteit. Verifieer:

- `candidates.csv` bevat header `Candidate Reference` (anders fallback-matching nodig).
- `jobs.csv` bevat `Job Reference` of in elk geval `Job Title` + `Location`.
- `applications.csv` bevat `Candidate Reference` + `Job Reference`.

Zet de drie bestanden in een verse map: `./manatal-export-week-2/`.

## Stap 2 — Run de parity-check

```bash
cd apps/api

npx tsx scripts/parity-check.ts \
  --tenant-id <IT-Proposal-UUID> \
  --manatal-candidates ./manatal-export-week-2/candidates.csv \
  --manatal-jobs ./manatal-export-week-2/jobs.csv \
  --manatal-applications ./manatal-export-week-2/applications.csv \
  --output-dir ./parity-reports/ \
  --tolerance datetime=60s,whitespace=ignore,accents=fold
```

Optionele flags:

- `--strict` — process exit-code 1 bij critical mismatches. Voor CI/CD-pipelines.
- `--watch 60` — re-run elke 60 minuten. Notify-only-on-NEW-criticals via webhook.
- `--webhook https://hooks.slack.com/...` — POST een samenvatting bij elk run / nieuwe critical.

Output landt in `./parity-reports/`:
- `parity-report-<timestamp>.json` — machine-readable, full detail.
- `parity-report-<timestamp>.md` — human-readable, recruiter-friendly.
- `mismatches-<timestamp>.csv` — per-veld diff voor handmatige review in Excel.

## Stap 3 — Lees het rapport

Open de Markdown. Volg de volgorde:

1. **Samenvatting-tabel** — totalen per entity (Manatal / TalentFlow / matched / partial / only).
   - Totalen moeten exact overeenkomen.
   - Partials = records die matchen maar 1+ veld verschillend hebben.
2. **Critical issues** — STOP-criterium. Toegestane waarde: 0.
3. **Major issues** — Bespreek met IT Proposal. Acceptabel mits gedocumenteerd.
4. **Minor issues** — Doorgaans acceptabel. Documenteren in changelog.
5. **Cutover-aanbeveling** — onderaan. READY / BESPREEK / STOP.

## Stap 4 — Severity-handelingsplan

### Critical (blokkeert cutover)

- **Missend record (only_in_manatal)**: kandidaat/vacature die in Manatal staat maar niet in TalentFlow. Onderzoek of een import-fout, of een Manatal-record dat na de import is aangemaakt. Re-run import met `--skip-duplicates`.
- **Missend record (only_in_talentflow)**: Onmogelijk tenzij iemand handmatig in TalentFlow heeft aangemaakt tijdens shadow-run. Verifieer met recruiter en archiveer of voeg toe aan Manatal.
- **email/name/candidate_reference/status mismatch**: Mogelijk in Manatal aangepast tijdens shadow-run en niet in TalentFlow. Update TalentFlow handmatig of via re-import.

Procedure:
1. Identificeer betrokken record uit `mismatches-<timestamp>.csv`.
2. Check audit-log van TalentFlow: `SELECT * FROM audit_events WHERE entity_id = '<id>'`.
3. Vergelijk met Manatal-activity log.
4. Beslis: corrigeer in TalentFlow, of escaleer naar IT Proposal.
5. Re-run parity-check ter bevestiging.

### Major (besluitpunt met IT Proposal)

`current_position`, `current_company`, `salary`, `years_of_experience`, `tags`, `phone`, `skills`, `industry`. Vaak verschillen deze door:

- Type-foutjes in oudere Manatal-records die TalentFlow heeft "schoongemaakt".
- Recruiter-mutaties die alleen in 1 systeem landden.
- Tag-naamgeving die per recruiter verschilt.

Verzamel ze in een Excel-sheet. Recruiter beslist per regel: TalentFlow → Manatal of vice versa, of "negeer". Documenteer beslissing in `docs/Cutover_Beslissingen.md`.

### Minor (documenteer)

`notes`, `description`, `created_at` binnen tolerance, custom fields. Geen actie vereist; meld in cutover-rapport.

### Tolerance (zicht-only)

Verschillen die binnen geconfigureerde tolerance vallen (datetime ±60s, whitespace, accent-folding). Geen actie vereist.

## Stap 5 — Cutover go/no-go

```
critical = 0  ?  YES → ga door naar major-review
              NO  → STOP, herstel, re-run

major    = 0  ?  YES → READY, plan cutover-window
              NO  → bespreek lijst met recruiter; teken acceptatie
```

Bewaar het `parity-report-*.md` als bewijs in de cutover-pakket.

## Smart-matching: hoe records aan elkaar gehangen worden

Niet alle records hebben een schoon `candidate_reference`. Het script probeert in deze volgorde:

1. **`candidate_reference` exact** — meest betrouwbaar, primair voor recente Manatal-records.
2. **`email` (lowercased)** — werkt voor 80%+ van de niet-referenced records.
3. **`phone` (digits-only)** — laatste contactgegevens-fallback.
4. **`name + birthdate` fuzzy** (Levenshtein < 3) — voor records zonder reference/email/phone.
5. **Anders** → `only_in_manatal` of `only_in_talentflow`.

Voor jobs: `job_reference` → `title + location` (case-/accent-insensitive).
Voor applications: `(candidate_reference, job_reference)` → `(email, job_title)`.

## Tolerance-flag specificatie

Default: `datetime=60s,whitespace=ignore,accents=fold,case=fold,number=0,arrayOrder=ignore`.

Elke key kan via `--tolerance` overschreven worden:

| Key          | Waarden                | Effect                                                   |
|--------------|------------------------|----------------------------------------------------------|
| `datetime`   | `60s`, `2m`, `1h`      | Absolute datetime-tolerance bij vergelijken.             |
| `whitespace` | `ignore` / `strict`    | `"a  b"` == `"a b"` als ignore.                          |
| `accents`    | `fold` / `strict`      | `"café"` == `"cafe"` als fold.                           |
| `case`       | `fold` / `strict`      | `"Foo"` == `"foo"` als fold.                             |
| `number`     | `0`, `1`, `100`        | Absolute numerieke tolerance.                            |
| `arrayOrder` | `ignore` / `matter`    | `[a,b]` == `[b,a]` als ignore (default).                  |

Voorbeeld voor strict-mode (geen tolerance toegestaan):
```bash
--tolerance datetime=0s,whitespace=strict,accents=strict,case=strict
```

## Continuous mode (shadow-run automation)

Voor de 1-week shadow-run kun je het script in watch-mode draaien:

```bash
nohup npx tsx scripts/parity-check.ts \
  --tenant-id <UUID> \
  --manatal-candidates ./manatal-export/candidates.csv \
  --manatal-jobs ./manatal-export/jobs.csv \
  --manatal-applications ./manatal-export/applications.csv \
  --output-dir ./parity-reports/ \
  --watch 60 \
  --webhook $SLACK_PARITY_WEBHOOK \
  > parity-watch.log 2>&1 &
```

Het script:
- Schrijft elk uur een fresh rapport.
- Stuurt de webhook ALLEEN bij nieuwe critical-records (niet bij elke run).
- Houdt de prev-set criticals in geheugen — restart triggert dus weer notificatie van bestaande.

Voor productie: zet onder een PM2-proces of systemd-unit.

## CI/CD-integratie

Voor regression-tests (na elke deploy):

```yaml
- name: Parity check
  run: |
    npx tsx apps/api/scripts/parity-check.ts \
      --tenant-id ${{ secrets.IT_PROPOSAL_TENANT_ID }} \
      --manatal-candidates ./fixtures/manatal/candidates.csv \
      --manatal-jobs ./fixtures/manatal/jobs.csv \
      --manatal-applications ./fixtures/manatal/applications.csv \
      --output-dir ./reports/ \
      --strict
```

`--strict` → exit-code 1 bij critical → CI fails. Geen criticals → exit 0.

## Troubleshooting

| Symptoom                                      | Oorzaak / oplossing                                       |
|-----------------------------------------------|-----------------------------------------------------------|
| `Manatal CSV niet gevonden`                   | Pad incorrect of bestand ontbreekt — check `ls`.           |
| 100% only_in_manatal                          | Tenant-UUID fout, of tenant heeft 0 records — verifieer.   |
| Veel email-mismatches                         | Manatal heeft accent-encoding van email-domein → check.    |
| Tolerance_count zeer hoog                     | Manatal-export is in EU-locale, TalentFlow in ISO → ok.    |
| Phone-match faalt                             | Manatal exporteert "+31 (0)6..." — onze regex strip ` ()`. |
| `Cannot find module manatal-mapping`          | Agent BB-mapping ontbreekt — fallback alias-table werkt.   |

## Bestanden

- `apps/api/scripts/parity-check.ts` — orchestrator + diff-engine + matching.
- `apps/api/scripts/parity-tolerance.ts` — pure comparison helpers.
- `apps/api/scripts/manatal-mapping.ts` — Agent BB's field-mapping (eigen tool).
- `apps/api/__tests__/scripts/parity-check.test.ts` — unit-tests.
- `docs/Parity_Check_Runbook.md` — dit bestand.

## Contact

Bij twijfel: laat de tool een rapport draaien en deel de Markdown. Bij critical issues: stop cutover, escaleer naar Kaan.

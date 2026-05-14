# TalentFlow API — Scripts

Deze map bevat operationele scripts. Geen runtime-code (die hoort in `src/`).

## ESCO-skills import (Sprint Q3.6)

`import-esco.ts` vult de `esco_skills` taxonomie-tabel met een hardcoded
seed-set (top-300 most-relevant recruitment-tech skills, zie
`apps/api/data/esco-seed.json`).

### Run-instructies

```bash
# 1) Migratie 020 moet eerst gedraaid zijn:
npm --workspace apps/api run migrate

# 2) Seed importeren (idempotent — re-runs werken labels bij):
tsx apps/api/scripts/import-esco.ts --source seed

# Subset (snel valideren in dev):
tsx apps/api/scripts/import-esco.ts --source seed --limit 50

# Eigen CSV:
tsx apps/api/scripts/import-esco.ts --source csv --file ./esco.csv
```

CSV-kolommen: `id,preferred_label,alt_labels,description,skill_type,category,parent_id`
(alt_labels = pipe-separated, bv. `JS|EcmaScript`).

### Seed vervangen door volledige ESCO-API-data

De seed dekt ~300 skills. Voor productie kun je de volledige ESCO-classificatie
(>13.000 skills) importeren:

1. Download de ESCO classificatie via het [ESCO Distribution Portal](https://esco.ec.europa.eu/en/use-esco/download).
   Kies de CSV-distributie (`skills_<lang>.csv`).
2. Map de ESCO-kolommen naar het CSV-formaat hierboven:
   - `conceptUri` → `id` (URI fungeert als stabiele PK)
   - `preferredLabel` → `preferred_label`
   - `altLabels` (newline-separated) → `alt_labels` (pipe-separated)
   - `description` → `description`
   - `skillType` → `skill_type` (waarden: `skill/competence`, `knowledge`, etc.)
   - eigen mapping → `category` (ESCO heeft geen vlakke category-as; gebruik
     `broaderConceptPT[0]` of een lookup-tabel op je eigen taxonomy).
3. Run `--source csv --file <pad>`. Dezelfde `id` ⇒ ON CONFLICT UPDATE, dus
   je kunt de seed eerst importeren en daarna de full-export overheen draaien.

`--source api` is gereserveerd voor toekomstige directe ESCO-API-integratie
(SPARQL-endpoint). Niet productie-klaar in MVP.

### Embeddings

Het script genereert geen embeddings. De `mapper`-laag (`lib/skills/mapper.ts`)
vult per call lazy één ontbrekende embedding in via OpenAI
`text-embedding-3-small`. Bij ~300 skills + ~1c per call kost de eerste
volledige run ~$0.30 totaal — verspreid over de eerste paar weken aan
mapping-requests.



## Manatal → TalentFlow import

`manatal-import.ts` migreert een complete Manatal-export naar TalentFlow:
candidates, jobs, applications, notes, en optioneel resume-bestanden.

### Manatal-export aanvragen

1. Log in op Manatal als workspace-admin.
2. Settings → Data Export → Request Export.
3. Selecteer alle entiteiten: Candidates, Jobs, Applications, Notes.
4. Vink "Include resume files" aan voor de complete CV-bundle.
5. Wacht tot Manatal de export-mail stuurt (~10-30 min voor large workspaces).
6. Download de zip + pak uit naar bv. `./manatal-export/`.

Verwachte directorystructuur:

```
manatal-export/
├── candidates.csv
├── jobs.csv
├── applications.csv
├── notes.csv
└── resumes/
    ├── ABC234567.pdf
    ├── DEF456789.docx
    └── ...
```

Resume-bestandsnaam = `<candidate_reference>.<ext>` (Manatal-default).

### Verwachte CSV-kolommen

Zie `manatal-mapping.ts` voor de complete lookup-tabel. Ontbrekende kolommen
in de input zijn geen probleem — TalentFlow-DB-defaults nemen het over.
Onbekende kolommen (Manatal-toegevoegd, niet gemapped) worden gerapporteerd
in `unknown_columns` van het migratie-rapport.

Kerntopics:

| Manatal CSV kolom              | TalentFlow target            |
|--------------------------------|------------------------------|
| `Candidate Email Address`      | `candidates.email`           |
| `Candidate Reference`          | `candidates.candidate_reference` |
| `Current Position`             | `candidates.current_position` |
| `Tags`                         | `candidates.tags` (array)    |
| `Job Title`                    | `jobs.title`                 |
| `Job Reference`                | `jobs.job_reference`         |
| `Status` (job)                 | `jobs.status` (gemapped)     |

Job-status mapping:

| Manatal       | TalentFlow |
|---------------|------------|
| `Planning`    | `draft`    |
| `Active`      | `open`     |
| `On Hold`     | `on_hold`  |
| `Completed`   | `filled`   |
| `Cancelled`   | `closed`   |

### Pre-flight checklist

1. Controleer dat **migrations 001–009** zijn toegepast op de target-DB.
2. **Maak een DB-backup** voordat je een live-import draait. Rollback is
   destructief en heeft een snapshot nodig om naar terug te keren als er
   iets misgaat tijdens de cutover.
3. Draai eerst `--dry-run` — dat parseert + valideert zonder DB-writes.
   Het rapport toont je hoeveel rijen geïmporteerd zouden worden.
4. Controleer het `unknown_columns` blok in het dry-run-rapport. Als
   Manatal nieuwe kolommen heeft toegevoegd die je wél wilt importeren,
   voeg ze dan toe aan `MANATAL_TO_TALENTFLOW_CANDIDATE` of
   `MANATAL_TO_TALENTFLOW_JOB` in `manatal-mapping.ts`.

### Run-instructies

**Dry-run (verplicht eerst):**

```bash
tsx apps/api/scripts/manatal-import.ts \
  --tenant-id 12345678-1234-1234-1234-123456789012 \
  --candidates ./manatal-export/candidates.csv \
  --jobs ./manatal-export/jobs.csv \
  --applications ./manatal-export/applications.csv \
  --notes ./manatal-export/notes.csv \
  --resumes-dir ./manatal-export/resumes \
  --dry-run
```

**Live import:**

```bash
tsx apps/api/scripts/manatal-import.ts \
  --tenant-id 12345678-1234-1234-1234-123456789012 \
  --candidates ./manatal-export/candidates.csv \
  --jobs ./manatal-export/jobs.csv \
  --applications ./manatal-export/applications.csv \
  --notes ./manatal-export/notes.csv \
  --resumes-dir ./manatal-export/resumes \
  --batch-size 100
```

### Idempotency

Het script is veilig om opnieuw te draaien. Bestaande rijen worden
herkend op:

- `candidates.candidate_reference` — UNIQUE per tenant
- `jobs.job_reference` — UNIQUE per tenant
- `applications.(candidate_id, job_id)` — UNIQUE

Bij een collision wordt de rij overgeslagen en als `skipped` geteld.
Met `--no-skip-duplicates` (debug) crasht het script bij elke collision —
gebruik alleen voor lokale ontwikkeling.

### Rollback

```bash
tsx apps/api/scripts/manatal-import.ts \
  --rollback-tenant 12345678-1234-1234-1234-123456789012
```

Dit verwijdert ALLE rijen getagged `source='manatal_migration'`:

- candidates → CASCADE → applications, candidate_resumes
- jobs (gevonden via audit-trail) → CASCADE → pipeline_stages
- activities (notes met action='note_imported')
- audit_events met action ∈ {candidate.imported, job.imported,
  application.imported, migration.completed}

Het script vraagt om bevestiging (`yes`) voordat het doorgaat. Skip met `-y`.

**Werp eerst een blik op de DB voordat je rollback gebruikt** — als
recruiters al een `source='manatal_migration'` candidate handmatig hebben
bewerkt, gaat dat werk verloren. Voor zo'n scenario is een DB-restore uit
de backup veiliger dan deze rollback-flag.

### Output

- Stdout: gekleurde samenvatting (totals, errors, unknown columns).
- Disk: `migration-report-<timestamp>.json` in de cwd. Bevat het complete
  rapport inclusief `id_map` (Manatal-id → TalentFlow-id) voor diagnostics.
- DB: per geïmporteerde rij een `audit_events` row (`candidate.imported`,
  `job.imported`, etc.) plus een eind-rij `migration.completed` met het
  hele rapport in `after`.

### Veelgemaakte fouten

- **"Tenant bestaat niet"** — controleer dat de tenant-UUID exact klopt en
  dat de DATABASE_URL naar de juiste DB wijst.
- **"Candidate zonder naam"** — Manatal-row heeft geen `Candidate Name`,
  `First Name`, of `Last Name`. Open de CSV, vul de velden in, hervat.
- **"Kon candidate ... niet vinden in id-map"** — applications.csv refereert
  een candidate of job die niet in de candidates/jobs CSV stond. Vaak
  doordat Manatal-export niet alle entiteiten op gelijk moment dumpt.
  Re-export de hele set in één keer.
- **Datums verkeerd geparsed** — Manatal-tenants met US-locale exporteren
  MM/DD/YYYY. De parser detecteert dit alleen als het eerste deel > 12.
  Voor tenants zonder zo'n disambiguator kun je in `parseManatalDate` de
  fallback aanpassen of de CSV pre-processen.
- **Resumes niet gevonden** — bestandsnaam moet exact `<candidate_reference>.<ext>`
  zijn (case-insensitive). Manatal nummer-references zijn altijd uppercase.

### Debugging

Het rapport JSON heeft een `errors` array met per row de raw input. Open
die in een editor en zoek de problematische cellen.

Bij een vastgelopen migratie (proces gekilled): re-run met dezelfde
argumenten — de idempotency-checks slaan al-geïmporteerde rijen over.

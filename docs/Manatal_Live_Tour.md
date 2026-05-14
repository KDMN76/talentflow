# Manatal Live Tour — Field Mapping & Module Inventaris

**Datum:** 5 mei 2026
**Tenant:** IT Proposal (recruitmentbureau, ~5.540 kandidaten)
**Bron:** Live walkthrough van Angelo's account
**Doel:** Exacte field-pariteit + module-vereisten voor TalentFlow

---

## 1. Sidebar — Module Inventaris (definitief)

```
┌─ Top ─────────────────┐
│ Home                  │
│ Clients               │
│ Jobs                  │
│ Candidates            │
└───────────────────────┘

┌─ Recruitment Center ──┐
│ Matches               │  ← AI matching als first-class
│ Placements            │  ← Post-hire onboarding/probation
│ Contacts and Guests   │  ← Externe stakeholders
│ Activities            │  ← Agenda/taken
│ Inbox                 │  ← Unified email
└───────────────────────┘

┌─ Settings & Analytics ┐
│ Reports               │
│ Career Page           │  ← Externe app (careers-page.com)
│ Sourcing Hub          │
│ Settings              │
│ Administration        │
└───────────────────────┘
```

**Verschil met TalentFlow:**
- TalentFlow heeft géén Matches, Placements, Activities, Contacts and Guests, Sourcing Hub als aparte modules
- Manatal scheidt Settings vs. Administration (TalentFlow heeft alleen Settings)

---

## 2. Dashboard (Home) — Layout

**Top performers leaderboard** (per metric, per recruiter, datumbereik):
- PLACEMENTS
- CANDIDATES (count)
- JOBS (count)
- ACTIONS TAKEN

**My Performance** widgets:
- MY CANDIDATES bar chart: Created / Owned / Added to a job / Dropped / Placed
- MY JOBS pie chart: Planning / Active / On Hold / Completed / Cancelled

**Andere blokken:**
- Notifications (last 5)
- Recent Actions: Candidates (recent geopend) + Jobs (recent geopend)
- My Activities (taken/agenda)

---

## 3. Kandidaat-Detail — Complete Field-Lijst

### Tabbladen
- Summary
- Resume (count, kan meerdere CV's hebben — voorbeeld toonde "2")
- Inbox (e-mailcommunicatie)
- Social (count, social profielen)
- Jobs (count, gekoppelde vacatures)
- Recommendation (AI Recommendations specifiek voor deze kandidaat)
- Activities
- Notes
- Attachments
- History (audit log)

### Header
- Avatar/foto
- Naam
- Eigenaar (`Candidate Owner` — recruiter)
- Huidige positie + bedrijf
- Locatie
- Tags
- Edit-knop

### Candidate Details (basis)
| Manatal field | TalentFlow status | Note |
|---|---|---|
| Candidate Name | ✅ | Volledige naam |
| Candidate First Name | ❌ | Apart veld nodig |
| Candidate Last Name | ❌ | Apart veld nodig |
| **Candidate Reference** | ❌ | Bijv. `Y5694WY99` — uniek alphanumeriek ID, **toevoegen** |
| Gender | ❌ | None/Male/Female/Other (DEI-rapportage) |
| Diploma | ❌ | Bijv. "Master of Science" |
| University | ❌ | Vrije tekst |
| Current Company | ✅ | |
| Current Position | ✅ | |
| Candidate Location | ✅ | |
| Birthdate | ❌ | Optioneel |
| Candidate Address | ❌ | Multi-line |
| Candidate Email Address | ✅ | |
| Candidate Phone Number | ✅ | |
| Skype | ❌ | |
| Other Contact | ❌ | Vrij contactveld |

### Log Book (audit-meta)
- **Source** — bijv. "Applied via Career Page" (Source-of-Hire is verplicht)
- Created date
- Date Resume added
- Last updated

### Subsecties (allemaal 0..N)
- Recent History (audit)
- Recent Notes
- **Addresses** — multi (huidig + thuisadres)
- **Dependents** — familieleden voor placements/HR
- **Emergency Contacts**
- Skills (met **score 1-10 per skill** — semantische match)
- Folders (kandidaat in 0..N folders)

### Additional Information
| Manatal field | TalentFlow status | Note |
|---|---|---|
| Current Department | ❌ | |
| Candidate Industry | ❌ | Sector-tag |
| Years of Experience | ❌ | Numeriek |
| Graduation Date | ❌ | |
| Current Salary | ❌ | + currency + period |
| Current Benefits | ❌ | Vrije tekst |
| **Notice Period** | ❌ | Bijv. "1 maand" |
| Expected Salary | ❌ | + currency |
| Expected Benefits | ❌ | |
| **Nationalities** | ❌ | Multi (NL-markt: belangrijk voor visa) |
| **Languages** | ❌ | Multi |
| Candidate Reference Name | ❌ | Referenties (mensen) |
| **GDPR Consent** | ❌ | Given/Pending/Withdrawn — verplicht NL |
| **GDPR Consent Date** | ❌ | timestamp |
| Candidate Description | ❌ | Vrije tekst (cover letter) |
| **Email Consent** | ❌ | Apart van GDPR |

### Experience (multi)
- Title, Company, Start/End date, Location, Description (rich text/bullets)

### Education (multi)
- School, Degree

---

## 4. Job-Detail + Pipeline

### Job Header
- **Status**: Planning / Active / On Hold / Completed / Cancelled (5 statussen — TalentFlow heeft alleen 4)
- Title + ID (bijv. `JP053994` — auto-gegenereerd)
- PUBLISHED toggle + NEW CANDIDATES toggle
- Job Owner (recruiter)
- **Client** (bedrijfslink, niet "company")
- Location
- Currency + Salary Range (Negotiable — Negotiable mogelijk)
- Tags

### Pipeline statistieken (top)
- Hired (count)
- In pipeline (count)
- Dropped (count)

### Pipeline Stages (IT Proposal config — bureau-pipeline)
1. **New Candidates**
2. **Interested**
3. **Shortlisted**
4. **Client Submission** ← hier wordt CV naar klant gestuurd
5. **Client Interview**
6. **Offered**
7. **Hired**
8. **Started** ← post-hire
9. **Probation passed** ← post-hire

**Belangrijk:** dit is een **bureau-pipeline** (TalentFlow's huidige default is een interne HR-pipeline). Stage 7-9 zijn placement/onboarding-fases — gekoppeld aan de Placements module.

### Pipeline view
- Per kandidaat-kaart toont **AI match score in %** (bijv. 50%, 20%, 60%)
- "6d" / "5d" / "4d" — dagen in stage
- LOAD MORE per kolom

### Job Tabs
- Candidates (count)
- Summary (job description)
- Team (count) — meerdere recruiters per job
- AI Recommendations
- Activities
- Notes (count)
- Attachments
- Sourcing
- Reports (per job!)

---

## 5. Reports — 5 Categorieën

| Categorie | URL | Doel |
|---|---|---|
| Candidates | `/reports/candidates` | Per kandidaat-attribuut (skills, source, etc.) |
| **Hiring Performance** | `/reports/hiring-performance` | Time-to-hire, conversion, drop-off |
| Jobs | `/reports/jobs` | Per vacature: tijd open, kandidaten/stage |
| **Leaderboard** | `/reports/leaderboard` | Recruiter-prestaties |
| **Sales** | `/reports/sales` | Revenue/forecasting (bureau!) |

Plus: **Advanced Reports** feature voor custom-reports (recent gelaunched).

---

## 6. Skills-Scoring

Belangrijke ontdekking: **Manatal toont skills met een score 1–10** per kandidaat per skill (bijv. "Requirements Analysis: 10"). Dit is geen self-rating — het is **AI-gegenereerd** uit het CV. TalentFlow's huidige resume parser haalt alleen skill-namen — de scoring ontbreekt.

---

## 7. Source-Tracking

Manatal logt automatisch waar elke kandidaat vandaan komt:
- "Applied via Career Page"
- "LinkedIn" (bijv. uit notifications: "added to the job (LinkedIn)")
- Imported manually

Dit voedt de "Source-of-Hire" rapportage (P0 KPI).

---

## 8. Multi-tenant / Multi-recruiter Patterns

- Elke kandidaat heeft een **Owner** (recruiter)
- Jobs hebben **Job Owner** + **Team** (count)
- Top performers leaderboard rangschikt op metric × datumbereik
- Recruiter-namen in screenshots: Laura Mpiana (468 candidates), Lorraine (182), Kasaday (165), Angelo (36), Bellinah, Reavin, Zanda, Angel Ha, Jerome

---

## 9. Critical Gaps t.o.v. TalentFlow Huidige State

### Velden die ontbreken in TalentFlow datamodel
1. **Candidate Reference** (uniek alphanumeriek ID, niet UUID)
2. **GDPR Consent + Date** + **Email Consent** (NL wettelijk)
3. **Skills met score 1-10** (AI-gegenereerd)
4. **First Name / Last Name** apart (TalentFlow heeft alleen `name`)
5. **Notice Period**, **Current Salary**, **Expected Salary**
6. **Nationalities** + **Languages** (multi)
7. **Dependents** + **Emergency Contacts** (voor placements)
8. **Birthdate** + **Address** (multi)

### Pipeline-stages aanpassen
Default pipeline moet bureau-stages worden, niet HR-stages:
```
New Candidates → Interested → Shortlisted → Client Submission
→ Client Interview → Offered → Hired → Started → Probation passed
```

### Modules die ontbreken in TalentFlow
- **Matches** als aparte module (AI matching dashboard)
- **Placements** als aparte module (post-hire onboarding tracking)
- **Activities** als aparte module (agenda/taken — verschillend van Workflows)
- **Contacts and Guests** (externe niet-recruiter stakeholders)
- **Sourcing Hub** (job board posting workflow)

### Functionaliteit die ontbreekt
- **AI match score** zichtbaar in pipeline-card (Manatal toont % per kandidaat)
- **Multi-CV per kandidaat** (Manatal: count "2" zichtbaar)
- **Folders** voor kandidaat-organisatie
- **Per-job Team** (meerdere recruiters per job)
- **Source automatisch loggen** ("Applied via Career Page")
- **AI Recommendations** tab op job-detail én op kandidaat-detail

---

## 10. Prioriteringsadvies voor TalentFlow datamodel-update

### P0 (verplicht voor stage-pariteit)
1. Candidate Reference ID generator
2. First/Last name split
3. GDPR + Email Consent fields + dates
4. Bureau-pipeline als default
5. Source field op kandidaat
6. Skills met numeric score
7. AI match score in pipeline-card

### P1 (verhoogt feature-pariteit serieus)
8. Notice Period / Current Salary / Expected Salary
9. Languages + Nationalities (multi)
10. Multi-CV per kandidaat
11. Activities module (agenda + taken)
12. Folders voor kandidaten
13. Job Team (meerdere recruiters)

### P2 (later)
14. Dependents / Emergency Contacts (alleen bij echte placements)
15. Matches als aparte module
16. Sourcing Hub
17. Contacts and Guests

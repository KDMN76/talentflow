# To-Be Procesbeschrijving — IT Proposal

**Stagiair:** Kaan
**Stagebedrijf:** IT Proposal — recruitmentbureau, Belgie
**BIM-deliverable:** To-Be procesbeschrijving (versie 1.0)
**Datum:** 5 mei 2026

---

## 1. Inleiding & scope

Dit document beschrijft de **toekomstige werkwijze (to-be)** waarmee IT Proposal recruitment uitvoert nadat **TalentFlow** in productie is genomen. Het is de spiegel van [`As_Is_Proces.md`](As_Is_Proces.md): zelfde bedrijf, zelfde stakeholders, zelfde zes kernprocessen, dezelfde negen-stappen-pipeline van *New Candidates* tot *Probation passed* — maar gedragen door een eigen platform in plaats van een externe SaaS-licentie.

De aanleiding voor de overstap is **niet** ontevredenheid met Manatal. IT Proposal is tevreden over Manatal en de recruiters werken er productief mee. De zakelijke driver is **kostenbesparing bij gelijkblijvende functionaliteit**: de jaarlijkse Manatal-licentie van ~€12.000 kan worden vervangen door een eigen platform met een geschatte run-rate van ~€1.450/jaar (zie sectie 8). TalentFlow positioneert zich uitdrukkelijk als "feature-pariteit met Manatal, lagere TCO" — niet als magisch beter alternatief.

Voor de negen recruiters (**Angelo**, **Laura Mpiana**, **Lorraine**, **Kasaday**, **Bellinah**, **Reavin**, **Zanda**, **Angel Ha** en **Jerome**) verandert de dagelijkse werkstroom op detailniveau (UI-elementen, sneltoetsen, exacte schermposities), maar de procesvolgorde en de begrippen blijven identiek. De scope blijft bewust beperkt tot de operationele recruitmentstroom; financiele administratie en HR-zaken van IT Proposal zelf vallen erbuiten.

---

## 2. Stakeholders na implementatie

| Stakeholder | Type | Rol in het proces (to-be) | Wijziging t.o.v. as-is |
|---|---|---|---|
| Recruiter | Intern (primair gebruiker) | Maakt vacatures, sourcet kandidaten, screent en schuift door pipeline. Krijgt **AI-assistance**: skills met score 1–10 + 3-regel samenvatting automatisch + match% per kandidaat per job. Beheert **multi-CV per kandidaat**. | UI is direct vergelijkbaar; AI-output vooraf ingevuld in plaats van handmatig bevestigd |
| Sales / accountmanager | Intern | Onderhoudt klantrelatie, brengt opdrachten binnen, monitort funnel via dashboards die nu voor iedereen toegankelijk zijn. | Custom rapportages zonder paywall — geen Excel-export-omweg meer |
| Hiring Manager bij klant | Extern | Geeft feedback op shortlist en beoordeelt kandidaten. Krijgt een **mobiele PWA-interface** (Hiring Manager-module) waarmee feedback geven in twee tikken kan. | Voorheen e-mailthread; nu eigen mobiel scherm in TalentFlow |
| Klant (organisatie) | Extern | Bekijkt voorgestelde shortlist en beslist via een **white-label klantportaal** met eigen branding van IT Proposal. | Voorheen e-mailbijlagen + soms losse PDF-anonimisatie; nu portal-link met audit-trail |
| Kandidaat | Extern | Solliciteert, levert CV, gaat in gesprek, accepteert/wijst aanbod af. | Onveranderd qua touchpoints; sollicitatie loopt via TalentFlow's eigen career page met IT Proposal-branding |
| Bedrijfseigenaar | Intern | Stuurt op KPI's, omzet en conversie. Heeft volledige Reports inclusief Time-to-Hire, Source-of-Hire, funnel en recruiter-leaderboard zonder Enterprise-Plus tier. | Geen handmatige Excel-export meer voor klantspecifieke views |
| Intern beheer (was: IT) | Intern | Tenant-instellingen, gebruikersbeheer, integratie-OAuth, GDPR-retentie. Geen externe vendor meer; beheer is intern (Kaan / aangewezen senior recruiter). | Geen externe Manatal-account, geen licentievernieuwing; wel zelf-onderhoudsverantwoordelijkheid |

---

## 3. Nieuw systeem-landschap

Het hart van de operatie wordt **TalentFlow**, gehost op de **bestaande Hetzner-VPS** (`91.98.232.104`) die ook KDMN bedient. TalentFlow levert dezelfde centrale kandidaten- en vacaturedatabase, kanban-pipeline, AI-matching, rapportage en career-page-builder die Manatal vandaag levert — maar dan onder eigen beheer en zonder per-gebruiker-licentie.

Daaromheen draait een kleine ring van diensten met expliciet **lage marginale kosten**: **PostgreSQL** met Row-Level Security (multi-tenant binnen IT Proposal: data per recruiter geisoleerd), **Cloudflare R2** voor file storage (CV's, attachments, contracten — S3-compatible, geen egress-kosten), **Resend** voor transactionele e-mail plus **Gmail/Outlook OAuth** voor 2-way sync met de mailbox van de recruiter, en de **Claude API (Anthropic)** als primaire AI-laag met **OpenAI** als fallback. **LinkedIn** blijft de belangrijkste sourcingbron — net als nu — maar via een eigen Chrome-extensie die People-Match vervangt.

```
                    ┌──────────────────────────┐
                    │   Career Page (custom    │
                    │   domein van IT Proposal)│
                    └───────────┬──────────────┘
                                │ auto-parse
                                │ + AI extract
                                ▼
   ┌──────────┐         ┌──────────────────┐         ┌────────────┐
   │ LinkedIn │ ──────▶│    TalentFlow    │◀──────▶│  Gmail /   │
   │ (bron)   │  AI    │  (eigen hosting   │  2-way │  Outlook   │
   └──────────┘ matching│    Hetzner VPS)  │  sync  │   OAuth    │
                  + %  └────┬─────────┬────┘        └────────────┘
                            │         │
              ┌─────────────┘         └────────────┐
              ▼                                    ▼
     ┌──────────────────┐                  ┌──────────────────┐
     │  PostgreSQL+RLS  │                  │  Resend (e-mail) │
     │  Cloudflare R2   │                  │  Claude / OpenAI │
     │  Redis + BullMQ  │                  │   (AI providers) │
     └──────────────────┘                  └──────────────────┘
                            │
                            ▼
                    ┌──────────────────┐
                    │    Recruiter     │
                    │  Hiring Manager  │
                    │  Klant (portal)  │
                    └──────────────────┘
```

**Vergelijking met as-is:** De externe SaaS-doos (Manatal) wordt vervangen door een eigen instantie met identieke buitenkant. LinkedIn en Gmail/Outlook blijven onveranderd; career page verhuist naar een eigen (sub)domein in plaats van `app.careers-page.com`. AI-functionaliteit wordt niet langer geleverd door een vendor maar door directe API-calls naar Claude, met expliciete kostenbeheersing en caching.

---

## 4. Kernprocessen to-be

### Proces 1 — Vacature aanmaken & publiceren

**Beschrijving.** Wanneer een klant (bijvoorbeeld Pro-Unity) een opdracht plaatst, vertaalt de verantwoordelijke recruiter dit naar een vacature in TalentFlow en zet hij/zij die live op career page + de relevante NL/BE-job boards.

**Stappen:**
1. Sales/recruiter ontvangt de opdracht (mail, telefoon, klantportaal).
2. Recruiter opent TalentFlow → Jobs → Nieuwe Vacature en vult titel, klant, locatie, salarisrange (mag "Negotiable"), tags en job description in. TalentFlow genereert automatisch een Job-ID (zelfde stijl als Manatal: bijv. `JP053994`).
3. Optioneel: AI Job-Description-generator vult de beschrijving op basis van titel + bullet points.
4. Status wordt op **Active** gezet (statussen: Planning / Active / On Hold / Completed / Cancelled — exacte pariteit met Manatal).
5. Toggle **Published** aanzetten → vacature gaat live op de eigen career page (custom domein, IT Proposal branding).
6. Sourcing Hub: één-klik publiceren naar LinkedIn, Indeed.nl, Indeed.be en NationaleVacaturebank.
7. Job Owner wordt vastgelegd; eventueel worden extra recruiters aan het Team van de job toegevoegd.

**Ondersteunende systemen:** TalentFlow (Jobs + Sourcing Hub + Career Page), LinkedIn, Indeed, NationaleVacaturebank.

**Verbeteringen t.o.v. as-is:**
- Eén-klik publish naar de specifieke NL/BE-mix die IT Proposal nodig heeft (Manatal mist NationaleVacaturebank-integratie).
- AI-JD-generator standaard beschikbaar, niet achter tier.
- Career page op eigen domein (`carrieres.itproposal.be`) versus Manatal's `app.careers-page.com`.

---

### Proces 2 — Sourcing & screening

**Beschrijving.** Kandidaten komen binnen via dezelfde twee hoofdroutes: organisch via career page en proactief via LinkedIn. TalentFlow voegt een derde route toe: **CSV-import** voor migratie en bulk-import.

**Stappen:**
1. Career-page-applicaties: kandidaat uploadt CV → BullMQ resume-parser extraheert tekst → Claude API genereert (a) skills met **score 1–10**, (b) een **3-regel samenvatting**, (c) ingevulde velden (naam, locatie, ervaring, opleiding) → kandidaat verschijnt automatisch in Job → New Candidates met `source = "Applied via Career Page"`.
2. LinkedIn-sourcing: recruiter zoekt op profielen, gebruikt de TalentFlow Chrome-extensie (vervangt Manatal's People-Match), importeert profiel → Claude API vult velden in.
3. Recruiter screent: bekijkt CV-tabblad (**multi-CV per kandidaat** zoals in Manatal), Skills (met AI-gegenereerde score), Experience, Education en Additional Information.
4. Recruiter geeft eigen oordeel met tags, notities en/of skill-aanpassingen — handmatige correctie van AI-output is altijd mogelijk.
5. Boolean search **plus** semantische search via pgvector zijn combineerbaar (Manatal kan ze niet combineren).
6. Match-percentage van TalentFlow AI wordt op de pipeline-card getoond. AI-score is uit te leggen: tooltip met top-3 matchende skills + reden.
7. Goedgekeurde kandidaat wordt naar de volgende stage gesleept.

**Ondersteunende systemen:** TalentFlow (Candidates + Matches + AI Recommendations), LinkedIn, Career Page, Cloudflare R2 (file storage).

**Verbeteringen t.o.v. as-is:**
- Boolean + AI-search combineerbaar.
- AI-score is geen black box meer — uitleg per kandidaat.
- LinkedIn-import via eigen extensie ipv schakelen tussen tabs en Manatal's People-Match.

---

### Proces 3 — Kandidaat door de pipeline bewegen

**Beschrijving.** Elke vacature heeft de **identieke negen-stappen-bureau-pipeline** als in Manatal, geseed door TalentFlow's "Bureau Pipeline" systeem-template bij tenant-aanmaak. Recruiter beweegt een kandidaat per kaart van links naar rechts.

**Pipeline IT Proposal (9 stages — ongewijzigd):**

```
[New Candidates] → [Interested] → [Shortlisted] → [Client Submission]
   → [Client Interview] → [Offered] → [Hired] → [Started] → [Probation passed]
```

**Stappen:** drag-and-drop op de kanban, of bulk-move via mass actions. Per kandidaatkaart toont TalentFlow de **AI match score (%)**, het aantal **dagen in stage** (bijv. "6d") en de eigenaar — exact zoals Manatal.

**Aanvullend in to-be:**
- **SLA-bewaking automatisch:** kaart kleurt amber bij >7 dagen in dezelfde stage, rood bij >14 dagen.
- **Stage-changes triggeren workflows:** bij Move-to-Interested wordt automatisch een follow-up-task aangemaakt voor de Job Owner; bij Move-to-Client-Submission verstuurt de workflow-engine de submission-mail (zie Proces 4).
- **Probation-tracking** zit in dezelfde kanban — geen losse Placements-module nodig.

**Ondersteunende systemen:** TalentFlow (Pipeline + Workflow-engine + Activities).

**Verbeteringen t.o.v. as-is:**
- SLA-monitoring zit ingebouwd ipv handmatig.
- Stage-changes triggeren mails/taken (in Manatal Enterprise tier; in TalentFlow standaard).
- Probation-tracking blijft binnen het kanbanbeeld.

---

### Proces 4 — Klantcommunicatie (CV doorsturen)

**Beschrijving.** Op het moment dat een kandidaat naar **Client Submission** wordt geschoven, triggert TalentFlow's workflow-engine **automatisch** een submission: de klant ontvangt een e-mail én een link naar het white-label klantportaal waar IT Proposal-branding op staat.

**Stappen:**
1. Recruiter sleept kandidaat naar Client Submission stage.
2. **Workflow-engine** trigger fired: "stage_change → Client Submission".
3. Sjabloon "Client Submission" wordt automatisch gevuld; merge fields vullen kandidaatnaam, vacature en match-score in.
4. CV wordt automatisch geanonimiseerd (achternaam + contactgegevens vervangen door initialen / placeholder, configureerbaar per klant).
5. Mail gaat via Resend (transactioneel) plus Gmail/Outlook 2-way sync zodat antwoord van de klant in dezelfde thread in TalentFlow verschijnt.
6. Klant ontvangt portal-link → opent white-label portaal → ziet shortlist met match%, samenvatting, geanonimiseerde CV.
7. Klant beoordeelt met "Approve / Request Interview / Decline" — beslissing wordt direct in TalentFlow geregistreerd.
8. Goedkeuring → kandidaat naar Client Interview. Afwijzing → drop reason kiezen (verplichte dropdown).

**Ondersteunende systemen:** TalentFlow (Workflow-engine + Templates + Klantportaal), Resend, Gmail/Outlook.

**Verbeteringen t.o.v. as-is:**
- Anonimisering automatisch ipv handwerk → minder GDPR-risico.
- Centraal template-beheer (per tenant) — geen per-recruiter-templates meer.
- Klant ziet shortlist in eigen portal (audit-trail) ipv losse e-mailthread.
- Mass-versturen van shortlist standaard, geen Enterprise-tier-blokker.

---

### Proces 5 — Plaatsing & onboarding

**Beschrijving.** Als de klant het aanbod accepteert, gaat de kandidaat van **Offered** naar **Hired**, vervolgens **Started** (eerste werkdag) en uiteindelijk **Probation passed**. Dit blijft binnen de kanban-pipeline (geen aparte module nodig), met de relevante metadata (startdatum, fee, contractduur) op het kandidaat-record.

**Stappen:**
1. Recruiter zet kandidaat op **Offered** → workflow-engine genereert offer letter uit template + verstuurt → wacht op handtekening.
2. Bij ondertekening: stage **Hired**. TalentFlow legt fee + startdatum + contractduur vast op het kandidaat-record (geen aparte Placements-module nodig).
3. Op startdatum: stage **Started**. Workflow-engine maakt automatisch reminder-taken voor 1 maand, 3 maanden en proeftijd-einde.
4. Tijdens proeftijd: recruiter krijgt automatische pings (geen handmatige Activities-planning meer nodig).
5. Na proeftijd: stage **Probation passed** → revenue erkend in Reports/Sales-dashboard.

**Ondersteunende systemen:** TalentFlow (Pipeline + Workflows + Activities + Reports), Resend, Gmail/Outlook, externe e-signature (Adobe Sign indien klant dat eist; integratie via webhook).

**Verbeteringen t.o.v. as-is:**
- Proeftijd-mijlpalen zijn automatisch ingepland bij Move-to-Started ipv handmatig.
- Offer letters worden in TalentFlow gegenereerd én version-beheerd (R2 storage).
- Fee-tracking in Reports/Sales — koppeling met boekhouding via webhook (KDMN-stack hergebruikt).

---

### Proces 6 — Rapportage

**Beschrijving.** De bedrijfseigenaar en senior recruiters gebruiken TalentFlow's Reports-module om performance te bewaken. Vijf categorieen blijven beschikbaar: Candidates, Hiring Performance, Jobs, Leaderboard en Sales — pariteit met Manatal.

**Stappen:**
1. Eigenaar opent dashboard → Top performers leaderboard (placements / candidates / jobs / actions) — identieke layout als Manatal.
2. Per recruiter: My Performance (kandidaten created/owned/added/dropped/placed; jobs per status).
3. Dieper: Hiring Performance (Time-to-Hire, Time-to-Fill, Source-of-Hire, drop-off per stage), Sales (forecast, gerealiseerde fees).
4. **Custom Report Builder** standaard beschikbaar (in Manatal achter Enterprise-Plus paywall): eigenaar kan klantspecifieke views direct in de UI bouwen — geen Excel-export-omweg meer.
5. Export naar Excel beschikbaar voor wie het toch wil.

**Ondersteunende systemen:** TalentFlow (Reports + Dashboard + Custom Report Builder), Excel (optioneel).

**Verbeteringen t.o.v. as-is:**
- Custom report builder zonder paywall.
- Sales-forecast koppelt aan boekhouding via webhook ipv handmatige export.
- 20+ standaard-KPI's beschikbaar dag-1.

---

## 5. Procesvergelijking — As-Is vs. To-Be

| Proces / handeling | As-Is tooling (Manatal) | To-Be tooling (TalentFlow) | Verbetering |
|---|---|---|---|
| Job-aanmaken | Manatal Jobs + handmatige JD | TalentFlow Jobs + AI-JD-generator | Minuten gewonnen per vacature |
| Publiceren naar NL job boards | Per board bevestigen, geen NationaleVacaturebank | Sourcing Hub: één-klik naar LinkedIn + Indeed.nl/be + NationaleVacaturebank | NL-markt-dekking compleet |
| CV-parsing | Manatal AI parser (skills zonder uitleg) | Claude API parser (skills + score 1–10 + 3-regel samenvatting) | AI-output transparant + bruikbaar |
| Multi-CV per kandidaat | Beschikbaar (count "2") | Beschikbaar — pariteit | Geen regressie |
| AI scoring per skill | AI-gegenereerd in Manatal (1–10) | AI-gegenereerd via Claude (1–10) | Pariteit; bespaart ~5 min/kandidaat |
| Match% in pipeline-card | Aanwezig | Aanwezig + uitleg-tooltip | Black-box-klacht weggenomen |
| Boolean + semantisch zoeken | Niet combineerbaar | Combineerbaar via pgvector | Krachtigere search |
| Stage-change triggert mail/taak | Workflow-automation = Enterprise tier | Workflow-engine standaard | Automation zonder extra licentiekosten |
| CV-anonimisatie naar klant | Handwerk (GDPR-risico) | Automatisch met regels per klant | Minder fouten, audit-trail |
| Klant-feedback op shortlist | E-mailthread | White-label klantportaal met audit | Centraler + branded |
| Custom rapportage | Enterprise Plus tier | Standaard beschikbaar | Geen paywall |
| Hiring Manager interface | Beperkte mobiele view | Mobiele PWA (Hiring Manager-module) | Mobiel-first feedbacken |
| GDPR consent + retentie | Deels handmatig | Velden + retentie-cron standaard | Compliance-by-design |
| Licentiekosten | €1.000/mnd × 12 = €12.000/jr | ~€121/mnd ≈ €1.450/jr | ~€10.550/jr besparing |
| Open API-toegang | Enterprise Plus only | Standaard vanaf dag 1 | Eigen integraties mogelijk |
| Probation-tracking | Verspreid over Pipeline + Placements | Binnen kanban + Activities | Eén beeld voor recruiter |

---

## 6. Architectuur op hoofdlijn

TalentFlow draait als **Node.js/Express API** (port 4000) plus **Next.js 14 webapp** (port 3000) op de bestaande Hetzner-VPS, achter Nginx-reverse-proxy met Let's-Encrypt-SSL — identieke deploy-pattern als de KDMN-projecten. **PostgreSQL 16** levert de centrale database; alle tabellen hebben een verplicht `tenant_id` en zijn beschermd met **Row-Level Security policies** zodat data per recruiter / per klanttenant volledig geisoleerd is, zonder dat de applicatiecode dat hoeft af te dwingen.

**Authenticatie** via JWT met refresh tokens (bcrypt-gehasht) en `requireAuth` + `tenantMiddleware` op iedere beschermde route. Async werk loopt via **BullMQ-workers** op Redis: resume-parsing (PDF/DOCX → Claude → skills+score+samenvatting), e-mail-verzending (Resend), workflow-acties bij stage-changes, en nightly Talent-Reactivation (matchen van archief-kandidaten aan nieuwe jobs).

**File storage** in Cloudflare R2 (S3-compatible, geen egress-kosten) voor CV's, attachments en gegenereerde offer letters. **AI-laag:** Claude API als primair, OpenAI als fallback bij rate-limits of uitval. **GDPR-by-design:** consent-velden (`gdpr_consent`, `gdpr_consent_date`, `email_consent`) staan standaard op iedere kandidaat, retentie-cron verwijdert kandidaten waarvan de consent verlopen of ingetrokken is, en iedere data-export is auditeerbaar.

---

## 7. Migratiepad

De overstap gebeurt **niet big-bang**. Het migratiepad bestaat uit drie fases:

**Fase 1 — Data-export & import (week 1).** IT Proposal levert een CSV-export uit Manatal (alle ~5.540 kandidaten + 24 actieve vacatures + open placements). TalentFlow heeft een import-script dat de Manatal-velden mapt naar het TalentFlow-datamodel: `Candidate Reference` blijft behouden, skills met score worden hergebruikt, source-tags worden over­genomen, GDPR-consent-velden worden ingevuld op basis van Manatal's consent-tracking. Dry-run op een subset (bijvoorbeeld 50 kandidaten) bevestigt veld-mapping voordat de volle migratie draait.

**Fase 2 — Pilotperiode (weken 2–4).** Eén actieve vacature draait **parallel** in Manatal én TalentFlow. Eén recruiter (Angelo, als ervaren key-user) werkt de hele pipeline van die vacature in TalentFlow door; de overige acht recruiters blijven in Manatal. Dagelijkse stand-up over verschillen, bugs en UX-frictie. Doel: bevestigen dat *time-to-hire*, *aantal contactmomenten* en *kwaliteit shortlist* in TalentFlow ten minste gelijk zijn aan Manatal.

**Fase 3 — Cutover (week 5).** Cutover gebeurt zodra: (a) alle ~5.540 kandidaten succesvol gemigreerd zijn, (b) alle 24 actieve vacatures live staan in TalentFlow, (c) alle negen recruiters één training-sessie hebben gehad, (d) e-mail 2-way-sync werkt, (e) GDPR-velden gevuld zijn, en (f) backups draaien. Manatal-licentie wordt opgezegd na 30 dagen schaduw-overlap waarin Manatal alleen-lezen blijft als referentie.

---

## 8. Verwachte voordelen

| Voordeel | Kwantificering | Toelichting |
|---|---|---|
| Kostenbesparing op licentie | **~€10.550/jaar** | Manatal €12.000/jr → TalentFlow ~€1.450/jr (Anthropic API ~€1.200, Resend ~€216, domein ~€25, hosting gedeeld met KDMN) |
| Data-soevereiniteit | Kwalitatief | Alle kandidaat- en klantdata op eigen Hetzner-VPS in EU; geen externe vendor met ongelimiteerde dataretentie |
| Aanpasbaarheid | Kwalitatief | Eigen UI, eigen workflows, eigen rapporten zonder paywall — stage-changes, custom fields en nieuwe modules zijn directe code-wijzigingen |
| Geen vendor lock-in | Kwalitatief | CSV-export en database-export op elk moment; geen afhankelijkheid van Manatal API V3-schema |
| Pariteit met Manatal-features | P0 + P1 dekking | Kandidaten, jobs, pipeline, career page, e-mail, GDPR, AI-scoring, CRM-data, basis-rapportage |
| GDPR-compliance | Compliance-by-design | Consent-velden + retentie-cron + audit-trail standaard, niet handwerk |
| AI zonder paywall | Kwalitatief | AI-scoring + JD-generator + semantische search standaard; in Manatal deels Enterprise tier |
| Open API vanaf dag 1 | Kwalitatief | Eigen integraties met boekhouding, KDMN Planning of toekomstige tools mogelijk; in Manatal Enterprise-Plus only |

---

## 9. Verwachte nadelen / risico's

Eerlijkheid is hier op zijn plaats — TalentFlow is geen gratis lunch.

| Risico | Inschatting | Mitigatie |
|---|---|---|
| **Bus-factor 1** — Kaan is enige ontwikkelaar | Hoog | Documentatie als first-class deliverable; codebase volgt KDMN-patterns die door derden begrepen kunnen worden; runbook voor restore-from-backup |
| **Eigen onderhouds­verantwoordelijkheid** — security patches, OS-updates, dependency-upgrades | Middel | PM2 + Docker + automated backups (idem KDMN); maandelijks 2u onderhoudsslot; uptime-monitoring via Better Uptime gratis tier |
| **Migratierisico** — fouten in CSV-import, verloren skills/notities | Middel | Dry-run op subset; 30-dagen schaduw-overlap met Manatal alleen-lezen; rollback-pad blijft mogelijk binnen die 30 dagen |
| **Geen 24/7 vendor-support** — bij Manatal heeft IT Proposal chat+e-mail support | Middel | Afspraak: response-tijd <4u in werkuren via Kaan; escalatie-pad gedocumenteerd; niet-kritieke meldingen async |
| **AI-API-kostenexplosie** — bij groei naar >10k kandidaten | Laag–middel | Caching op tenant-niveau, per-tenant kostenlimieten, OpenAI-fallback bij Claude rate-limits |
| **Vendor-dichtheid op tweede lijn** — Cloudflare R2, Resend, Anthropic | Laag | Alle drie hebben directe migratiepaden (S3, SendGrid, OpenAI) |
| **Adoptie-curve recruiters** — 9 mensen moeten omschakelen | Laag | UI is bewust Manatal-vergelijkbaar; pilotperiode met één key-user voor cutover |

---

## 10. Conclusie

TalentFlow vervangt Manatal niet **omdat** Manatal slecht is, maar **omdat** dezelfde operatie binnen IT Proposal jaarlijks ~€10.550 goedkoper kan draaien zonder functionele regressie. De negen-stappen-pipeline blijft, de stakeholders blijven, de werkstroom blijft herkenbaar voor de negen recruiters. Wat verandert is de leverancier, het kostenmodel, en de mate waarin IT Proposal eigen aanpassingen kan doen zonder vendor-paywall.

De business-case staat of valt met drie randvoorwaarden: (1) feature-pariteit op P0 (kandidaten, jobs, pipeline, career page, e-mail, GDPR, AI-scoring, semantisch zoeken) moet aantoonbaar geleverd zijn voor cutover, (2) het migratiepad moet zonder verlies van kandidaten, skills of consent-status verlopen, en (3) bus-factor-mitigatie (documentatie, runbooks, backup-restore-procedure) moet er staan voordat Manatal wordt opgezegd.

De financiele en strategische onderbouwing is uitgewerkt in **[`Masterplan_Stage.md`](Masterplan_Stage.md)** (sectie 6: TCO/ROI) en in de TCO/SWOT-deliverables van de stage. Voor de exacte feature-pariteit-matrix per categorie zie **[`Manatal_Feature_Pariteit.md`](Manatal_Feature_Pariteit.md)**.

---

**Gerelateerde documenten:**
- [`As_Is_Proces.md`](As_Is_Proces.md) — huidige werkwijze in Manatal
- [`Manatal_Live_Tour.md`](Manatal_Live_Tour.md) — module-inventaris en field-mapping
- [`Manatal_Feature_Pariteit.md`](Manatal_Feature_Pariteit.md) — feature-overzicht en P0/P1/P2 prioritering
- [`Masterplan_Stage.md`](Masterplan_Stage.md) — strategische context, roadmap, TCO/ROI

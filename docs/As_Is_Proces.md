# As-Is Procesbeschrijving — IT Proposal

**Stagiair:** Kaan
**Stagebedrijf:** IT Proposal — recruitmentbureau, België
**BIM-deliverable:** As-Is procesanalyse (versie 1.0)
**Datum:** 5 mei 2026

---

## 1. Inleiding & scope

IT Proposal is een Belgisch recruitmentbureau dat IT- en kennisprofielen plaatst bij eindklanten in de Benelux. Een typische klantopdracht is bijvoorbeeld de invulling van een ontwikkelaarsrol bij Pro-Unity in Brussel: IT Proposal zoekt, screent en bemiddelt de kandidaat, en verdient een fee bij plaatsing en/of bij het halen van de proeftijd.

Het bureau werkt met een hechte recruiter-pool waarin negen actieve recruiters dagelijks vacatures, kandidaten en klantcommunicatie beheren: **Angelo**, **Laura Mpiana**, **Lorraine**, **Kasaday**, **Bellinah**, **Reavin**, **Zanda**, **Angel Ha** en **Jerome**. Hoewel iedereen onder dezelfde merknaam werkt, opereert elke recruiter relatief zelfstandig op een eigen kandidaat- en klantportefeuille. Dat geeft het systeem een "multi-tenant binnen één bedrijf"-karakter: gedeelde data, maar individueel eigenaarschap per kandidaat en per vacature.

Dit document beschrijft de **huidige werkwijze (as-is)** waarmee IT Proposal recruitment uitvoert. Het richt zich op de zes kernprocessen — van vacature-intake tot rapportage — en de ondersteunende systemen daaromheen. Het document is bedoeld als referentie voor zowel de stagebegeleider als IT-onkundige stakeholders binnen IT Proposal, en vormt de basis waartegen het toekomstige TalentFlow-platform (zie het bijbehorende `To_Be_Proces.md`) wordt afgezet. De scope beperkt zich tot de operationele recruitmentstroom; financiële administratie en HR-zaken van IT Proposal zelf vallen erbuiten.

---

## 2. Stakeholders

| Stakeholder | Type | Rol in het proces | Frequentie van interactie |
|---|---|---|---|
| Recruiter | Intern (primair gebruiker) | Maakt vacatures aan, sourcet kandidaten, voert screening, schuift door pipeline, communiceert met klant en kandidaat. | Dagelijks, gehele werkdag |
| Sales / accountmanager | Intern | Onderhoudt commerciële relatie met klant, brengt opdrachten binnen, onderhandelt fee. | Wekelijks per klant |
| Hiring Manager bij klant | Extern | Geeft inhoudelijke feedback op shortlist, voert sollicitatiegesprekken, maakt go/no-go beslissing. | Per vacature, meerdere keren |
| Kandidaat | Extern | Solliciteert, levert CV, gaat in gesprek, accepteert/wijst aanbod af. | Per traject, 5–15 contactmomenten |
| Bedrijfseigenaar | Intern | Stuurt op cijfers (KPI's, omzet, conversie), bewaakt licentiekosten, neemt strategische beslissingen. | Wekelijks/maandelijks |
| IT (impliciet) | Intern | Manatal-account-beheer, gebruikersbeheer, integratie-instellingen. Geen eigen IT-afdeling — taak ligt bij eigenaar of senior recruiter. | Ad hoc |

---

## 3. Huidig systeem-landschap

Het hart van de operatie is **Manatal**, een SaaS-ATS (Applicant Tracking System) waarvoor IT Proposal momenteel **≈€620/maand** betaalt (werkelijke factuur $674/mnd: 16 Enterprise-seats × $39 + $50 add-on, zie `TCO_ROI.md`). Manatal levert de centrale kandidaten- en vacaturedatabase, de pipeline (kanban), AI-matching, rapportage en de career-page-builder. Daaromheen draait een kleine ring van externe diensten: de publieke career page wordt door Manatal gehost op `app.careers-page.com`, **LinkedIn** wordt gebruikt als sourcingbron (organisch zoeken, profielen importeren), en **Gmail/Outlook** is via two-way-sync gekoppeld aan Manatal voor e-mailcommunicatie met kandidaten en klanten.

IT Proposal heeft géén eigen interne tooling: er is geen custom CRM, geen eigen database en geen integraties met boekhouding of HRIS. Alles wat een recruiter nodig heeft loopt via Manatal of via één van de gekoppelde apps. Bestanden (CV's, contracten) worden door Manatal opgeslagen; e-mailthreads blijven primair in de mailbox van de recruiter staan, met een gespiegelde kopie in Manatal.

```
                    ┌─────────────────────────┐
                    │       Career Page       │
                    │ (app.careers-page.com)  │
                    └──────────┬──────────────┘
                               │ auto-parse
                               ▼
   ┌──────────┐         ┌──────────────┐         ┌──────────┐
   │ LinkedIn │ ──────▶ │   Manatal    │ ◀──────▶│  Gmail / │
   │ (bron)   │  AI     │   (centraal  │  2-way  │  Outlook │
   └──────────┘  Smart- │      ATS)    │   sync  └──────────┘
                 fill   └──────┬───────┘
                               │
                               ▼
                       ┌───────────────┐
                       │   Recruiter   │
                       └───────────────┘
```

---

## 4. Kernprocessen as-is

### Proces 1 — Vacature aanmaken & publiceren

**Beschrijving.** Wanneer een klant (bijvoorbeeld Pro-Unity) een opdracht plaatst, vertaalt de verantwoordelijke recruiter dit naar een vacature in Manatal en zet hij/zij die live op de relevante kanalen.

**Stappen:**
1. Sales/recruiter ontvangt de opdracht (mail, telefoon, klantportaal).
2. Recruiter opent Manatal → Jobs → New Job en vult titel, klant, locatie, salarisrange (mag "Negotiable"), tags en job description in. Manatal genereert automatisch een Job-ID (bijv. `JP053994`).
3. Status wordt op **Active** gezet (statussen: Planning / Active / On Hold / Completed / Cancelled).
4. Toggle **Published** aanzetten → vacature gaat live op de eigen career page.
5. Optioneel: vanuit Sourcing Hub posten naar LinkedIn / Indeed / overige boards.
6. Job Owner wordt vastgelegd; eventueel worden extra recruiters aan het Team van de job toegevoegd.

**Ondersteunende systemen:** Manatal (Jobs + Sourcing Hub + Career Page), LinkedIn.

**Pijnpunten:**
- Job descriptions worden grotendeels handmatig geschreven; AI-generator is wel beschikbaar maar wordt wisselend gebruikt.
- Posten naar meerdere boards moet per board worden bevestigd; geen één-klik publish naar de specifieke NL/BE-mix.
- Geen geautomatiseerde sync met de website van de klant zelf.

---

### Proces 2 — Sourcing & screening

**Beschrijving.** Kandidaten komen binnen via twee hoofdroutes: **organisch via de career page** (sollicitatie wordt automatisch geparsed) en **proactief via LinkedIn** (recruiter zoekt en importeert profielen handmatig, vaak ondersteund door Manatal's AI Smartfill om velden in te vullen).

**Stappen:**
1. Career-page-applicaties: kandidaat uploadt CV → Manatal parsert PDF/DOCX → kandidaat verschijnt automatisch in Job → New Candidates met source-tag "Applied via Career Page".
2. LinkedIn-sourcing: recruiter zoekt op profielen, gebruikt eventueel de People-Match Chrome-extensie, importeert handmatig → Manatal AI Smartfill vult velden in.
3. Recruiter screent: bekijkt CV-tabblad (kan meerdere CV's bevatten), Skills (met AI-gegenereerde score 1–10), Experience, Education en Additional Information.
4. Recruiter geeft eigen oordeel met tags, notities en/of skill-aanpassingen.
5. Match-percentage van Manatal AI (bijv. 50%, 60%) wordt op de pipeline-card getoond ter ondersteuning.
6. Goedgekeurde kandidaat wordt naar de volgende stage gesleept.

**Ondersteunende systemen:** Manatal (Candidates + AI Recommendations), LinkedIn, Career Page.

**Pijnpunten:**
- Recruiter moet voor LinkedIn-imports herhaaldelijk schakelen tussen browser, extensie en Manatal.
- AI-scoring wordt soms als black box ervaren — geen line-by-line uitleg op het lagere abonnement.
- Boolean search en AI Advanced Search kunnen niet gecombineerd worden.

---

### Proces 3 — Kandidaat door de pipeline bewegen

**Beschrijving.** Elke vacature heeft een kanban-pipeline met negen stages, ingericht voor een agency-werkstroom (niet voor interne HR). Recruiter beweegt een kandidaat per kaart van links naar rechts.

**Pipeline IT Proposal (9 stages):**

```
[New Candidates] → [Interested] → [Shortlisted] → [Client Submission]
   → [Client Interview] → [Offered] → [Hired] → [Started] → [Probation passed]
```

**Stappen:** drag-and-drop op de kanban, of bulk-move via mass actions. Per kandidaatkaart toont Manatal de **AI match score (%)**, het aantal **dagen in stage** (bijv. "6d") en de eigenaar.

**Ondersteunende systemen:** Manatal (Pipeline + Activities).

**Pijnpunten:**
- Geen automatische SLA-bewaking: een kandidaat kan onbedoeld lang in dezelfde stage blijven.
- Stage-changes triggeren niet altijd een notificatie naar Sales of de Hiring Manager.
- Probation-tracking valt buiten het kanbanbeeld dat recruiters dagelijks gebruiken — informatie vermengt zich met de Placements-module.

---

### Proces 4 — Klantcommunicatie (CV doorsturen)

**Beschrijving.** Op het moment dat een kandidaat naar **Client Submission** wordt geschoven, stuurt de recruiter de (vaak geanonimiseerde) CV en een korte motivatie naar de Hiring Manager bij de klant.

**Stappen:**
1. Recruiter klikt op de kaart → opent kandidaat-profiel → tabblad Inbox of E-mail-actie.
2. Sjabloon "Client Submission" wordt geselecteerd; merge fields vullen kandidaatnaam, vacature en match-score in.
3. CV wordt bijgevoegd; eventueel anonimiseert de recruiter handmatig (achternaam/contactgegevens verwijderen).
4. Mail gaat via Gmail/Outlook two-way-sync; antwoord van de klant verschijnt in dezelfde thread in Manatal.
5. Goedkeuring → kandidaat naar Client Interview. Afwijzing → drop reason kiezen.

**Ondersteunende systemen:** Manatal (Inbox + Templates), Gmail/Outlook, soms een handmatige PDF-anonimiseringsstap.

**Pijnpunten:**
- Anonimisering is handwerk en foutgevoelig (GDPR-risico).
- E-mailtemplates moeten per recruiter worden onderhouden — geen centraal template-beheer in lagere tier.
- Mass-versturen van shortlists naar klanten is beperkt zonder workflow-automation (Enterprise tier).

---

### Proces 5 — Plaatsing & onboarding

**Beschrijving.** Als de klant het aanbod accepteert, gaat de kandidaat van **Offered** naar **Hired**, vervolgens **Started** (eerste werkdag) en uiteindelijk **Probation passed** (proeftijd doorstaan, fee definitief). Dit wordt parallel vastgelegd in Manatal's **Placements**-module, die de plaatsing koppelt aan kandidaat, vacature, klant en fee.

**Stappen:**
1. Recruiter zet kandidaat op **Offered** → mailt offer brief → wacht op handtekening.
2. Bij ondertekening: stage **Hired** + record in Placements (startdatum, fee, contractduur).
3. Op startdatum: stage **Started**.
4. Tijdens proeftijd: recruiter monitort via Activities (taken, follow-up calls met kandidaat en klant).
5. Na proeftijd: stage **Probation passed** → revenue erkend in Sales-rapportage.

**Ondersteunende systemen:** Manatal (Placements + Activities + Reports/Sales), Gmail/Outlook, externe e-signature (Adobe Sign indien klant dat eist).

**Pijnpunten:**
- Geen automatische herinneringen voor proeftijd-mijlpalen; staat in Activities maar moet handmatig worden ingepland.
- Offer letters zijn losse documenten in mail, niet versionbeheerd in het ATS.
- Koppeling met facturatie ontbreekt — fees moeten apart in een spreadsheet of boekhoudpakket worden bijgehouden.

---

### Proces 6 — Rapportage

**Beschrijving.** De bedrijfseigenaar en senior recruiters gebruiken het Reports-onderdeel van Manatal om performance te bewaken. Vijf categorieën zijn beschikbaar: Candidates, Hiring Performance, Jobs, Leaderboard en Sales.

**Stappen:**
1. Eigenaar opent dashboard → Top performers leaderboard (placements / candidates / jobs / actions).
2. Per recruiter: My Performance (kandidaten created/owned/added/dropped/placed; jobs per status).
3. Dieper: Hiring Performance (time-to-hire, drop-off), Sales (forecast, gerealiseerde fees).
4. Export naar Excel voor klantspecifieke of fee-specifieke views.

**Ondersteunende systemen:** Manatal (Reports + dashboard), Excel.

**Pijnpunten:**
- Custom report builder zit achter de duurste tier (Enterprise Plus); IT Proposal heeft die niet.
- Bekende klacht in reviews: standaardrapporten zijn relatief "surface-level".
- Sales-forecast koppelt niet automatisch aan boekhouding — eigenaar exporteert handmatig.

---

## 5. Datavolumes & key cijfers

| Indicator | Waarde | Bron |
|---|---|---|
| Totaal kandidaten in database | ~5.540 | Manatal-tenant IT Proposal |
| Actieve vacatures | 24 | Live tour 5 mei 2026 |
| Cancelled vacatures (lopend zichtbaar) | 4 | Live tour 5 mei 2026 |
| Aantal actieve recruiters | 9 | Manatal Users |
| Top recruiter — kandidaten | Laura Mpiana — 468 kandidaten | Leaderboard |
| Sterkste activiteit | Lorraine — ~1.300 actions | Leaderboard |
| Kerncijfers ondersteunende recruiters | Kasaday 165, Angelo 36 | Leaderboard |
| Manatal-licentiekosten | ≈€620 / maand (~€7.440 / jaar; factuur GORR5CHG-0006: $674/mnd) | Boekhouding IT Proposal |
| Pipeline-stages per vacature | 9 (incl. Started + Probation passed) | IT Proposal config |

---

## 6. Pijnpunten & beperkingen as-is

Manatal levert IT Proposal vandaag een werkbare en gewaardeerde oplossing — recruiters zijn productief en de leercurve is laag. De beperkingen die hieronder zijn samengebracht zijn dus **niet** "Manatal werkt niet"; ze beschrijven structurele rand­voorwaarden waarbinnen IT Proposal momenteel opereert en die ruimte laten voor verbetering en kostenbesparing.

| Categorie | Beperking | Effect voor IT Proposal |
|---|---|---|
| Kosten | ≈€620/maand recurring licentie (per-seat), lineair schalend met gebruikers | Vaste kostenpost van ~€7,4k/jaar; groeit mee bij uitbreiding van het team |
| API-toegang | Open API alleen op tier Enterprise Plus ($55/user/mnd) | Geen eigen integraties met boekhouding, eigen klantportaal of Excel-export op maat zonder upgrade |
| Custom rapportage | Advanced Report Builder alleen op Enterprise Plus | Eigenaar moet exporteren naar Excel voor klantspecifieke of fee-specifieke views |
| Workflow-automation | Beschikbaar vanaf Enterprise tier; niet altijd actief op huidig abonnement | Stage-changes triggeren handwerk in plaats van mails of taken |
| Datalokatie & vendor lock-in | Data staat bij Manatal (SaaS); export beperkt tot CSV per module | Migreren of integreren vraagt scripting en handmatige verrijking |
| UI-/workflow-aanpasbaarheid | Custom fields aanwezig, maar grotere UI- of stage-aanpassingen niet zonder vendor | Geen mogelijkheid om bureau-specifieke schermen of dashboards exact in te richten |
| Eigen interne tools | Geen integratie met IT Proposal-specifieke spreadsheets, contractgenerator of boekhouding | Recruiters voeren dezelfde data deels dubbel in |
| GDPR-comfort | Manatal ondersteunt GDPR, maar consent-tracking en retentie zijn deels handmatig | Risico op fouten bij anonimisering en bij verlopen toestemmingen |

---

## 7. Conclusie

IT Proposal draait een gezonde, compacte recruitment-operatie op een centrale ATS-stack die werkt: ~5.540 kandidaten, 24 actieve vacatures, negen recruiters en een duidelijke negen-stappen-pipeline van *New Candidates* tot *Probation passed*. Manatal is daarbij geen probleem — het is de motor onder een tevreden gebruikersbestand. De kanttekeningen zitten elders: in de jaarlijks terugkerende licentiekosten van ~€7.440, in een aantal premium features die achter de duurste tier zitten (open API, custom rapportages, full workflow-automation), en in het ontbreken van koppelingen met IT Proposal-eigen tools en administratie.

Daarmee is de zakelijke aanleiding voor het TalentFlow-traject helder: niet een vlucht weg van Manatal, maar een gerichte zoektocht naar **lagere TCO bij gelijkblijvende of betere functionaliteit**, plus de vrijheid om eigen integraties en aanpassingen te bouwen zonder vendor-paywall.

Het toekomstige procesmodel — inclusief beoogde geautomatiseerde stage-acties, geïntegreerde GDPR-tracking, AI-matching met uitleg, native job-board-publicatie naar de Belgisch/Nederlandse markt en een lagere kostenstructuur — wordt uitgewerkt in het bijbehorende document **[`To_Be_Proces.md`](To_Be_Proces.md)**.

---

**Gerelateerde documenten:**
- [`Manatal_Live_Tour.md`](Manatal_Live_Tour.md) — module-inventaris en field-mapping
- [`Manatal_Feature_Pariteit.md`](Manatal_Feature_Pariteit.md) — feature-overzicht
- [`Masterplan_Stage.md`](Masterplan_Stage.md) — stage-context en roadmap
- [`To_Be_Proces.md`](To_Be_Proces.md) — toekomstige werkwijze in TalentFlow *(volgt)*

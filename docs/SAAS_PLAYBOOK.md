# SaaS Playbook — verkoop & onboarding vanaf klant #2

**Doel:** het draaiboek voor het binnenhalen en live zetten van betalende TalentFlow-tenants,
vanaf de tweede klant. ITProposal BV is design partner #1 en blijft op een gratis plan in ruil
voor feedback, real-world data en een referentie/case study — dit playbook geldt dus voor
klant #2 en verder.

**Status:** voorstel. Alle bedragen zijn voorstellen tot Kaan ze bevestigt; expliciete
aannames zijn gemarkeerd met **AANNAME**. Sluit aan op `docs/MONETISATIE_FASE1.md`
(provider-keuze + tier-detail) en `docs/STRIPE_PLAN.md` (implementatie).

**Doelklant:** kleine NL/BE recruitment- en detacheringsbureaus, 1–15 recruiters, eerste wig
IT-detachering (zie ROADMAP.md Sectie 5). Doelstelling: 10–20 klanten × €200–400/mnd.

---

## 1. Pricing

### 1.1 Per-seat vs per-job-slot — de afweging

| Criterium | Per-seat (per recruiter) | Per-job-slot (per actieve vacature) |
|---|---|---|
| Mentaal model doelklant | ✅ Bekend — Manatal, Carerix, OTYS rekenen per gebruiker | ⚠️ Bekend van Recruitee/Teamtailor, maar dat zijn corporate-tools |
| Voorspelbaarheid klant | ✅ Seats wijzigen zelden | ❌ Vacature-aantal fluctueert per maand → factuur-verrassingen |
| Fit met detachering | ✅ Detacheringsbureaus hebben weinig recruiters, veel lopende plaatsingen | ❌ Veel gelijktijdige aanvragen = straf op precies hun werkmodel |
| Meting/afdwinging | ✅ Actieve users tellen is triviaal en al aanwezig | ⚠️ "Actieve vacature" vergt definitie + gating op job-publicatie |
| Stripe-implementatie | ✅ Native `quantity` op subscription | ⚠️ Usage-based/metered billing, meer bouwwerk |
| Groeivriendelijkheid | ⚠️ Groeiend team = hogere factuur (zoals bij Manatal) | ✅ Onbeperkte users voelt genereus |

**Aanbeveling: per-seat.** De doelklant komt van per-seat-tools en snapt het model direct;
het beloont precies het gedrag dat wij willen (veel vacatures en kandidaten in het systeem);
en het is de goedkoopste variant om te bouwen en te onderhouden (Stripe `quantity`, geen
metering-infrastructuur). Per-job-slot is het model van corporate-ATS'en met unlimited
hiring-managers — dat is niet onze niche. Het groei-nadeel vangen we af doordat onze
seat-prijs onder Manatal Enterprise ligt en álles inbegrepen is.

### 1.2 Tiers (voorstel — consistent met MONETISATIE_FASE1.md)

Prijzen per seat per maand; jaarprijs = maandprijs met ~20% korting bij jaarlijkse
vooruitbetaling. **AANNAME:** bedragen staan vast zodra Kaan MONETISATIE_FASE1.md §5 beslist.

| | **Starter** | **Professional** ⭐ | **Enterprise** |
|---|---|---|---|
| Jaarlijks gefactureerd | **€19**/seat/mnd | **€29**/seat/mnd | **€39**/seat/mnd |
| Maandelijks gefactureerd | €23/seat/mnd | €35/seat/mnd | €47/seat/mnd |
| Kern | ATS-pipeline, kandidaten/vacatures, career page, e-mail, AVG-dashboard, API (read) | + AI-matching & sourcing-agent, agency-CRM + plaatsingen, interviews, white-label portaal, WhatsApp, SSO, API (read+write) | + SCIM, AI-Act-compliance-pakket, pay-equity, forecasting, SLA-plus, custom webhooks |
| Voorbeeldbureau (8 seats, jaar) | €152/mnd | €232/mnd | €312/mnd |

- **Professional is de te verkopen tier.** Referentie-anker in elk gesprek: ITProposal
  betaalde Manatal **≈€625/mnd voor 16 seats** (echte factuur: 16 × $39 + $50 add-on).
  Op Professional-jaar betaalt datzelfde bureau €464/mnd (~26% goedkoper) en krijgt
  SSO/API/white-label die bij Manatal pas op het duurste niveau zitten.
- Een bureau van 7–14 seats op Professional levert €200–400/mnd — precies de doelband.

### 1.3 Wat is all-in (de anti-add-on-tax-belofte)

Concurrenten verkopen matching, marketing-automation en support als losse add-ons
(Carerix/OTYS) of rekenen per module. TalentFlow belooft expliciet:

**Binnen de tierprijs, zonder opslag:**
- Alle AI-features van de tier (parsing, matching, sourcing, JD-generator) — inclusief de
  AI-API-kosten. **AANNAME:** met een fair-use-plafond per tenant (per-tenant metering op
  `ai_events` bestaat al); bij structurele uitschieters eerst gesprek, geen automatische naheffing.
- Support (kanaal + responstijden uit §3), onboarding-basis (§2) en alle product-updates.
- Hosting, backups, SSL, security-patches.

**Níet inbegrepen (eerlijk benoemen in het gesprek):**
- Datamigratie boven de standaard-import (§2, stap 3): maatwerk-mapping uit exotische
  ATS'en tegen uurtarief. **AANNAME:** €85/uur, vooraf gemaximeerd.
- Eigen verzenddomein-registratie (kosten domein liggen bij klant).
- Development van klantspecifieke integraties.

### 1.4 Trial en jaarkorting

- **Trial:** 14 dagen op Professional-niveau, **zonder creditcard vooraf** (NL/BE-bureaus
  zijn kaart-afkerig). Daarna plan kiezen; geen harde lock-out, data blijft staan (§4).
- **Jaarkorting:** ~20% bij jaarlijkse vooruitbetaling. Argument voor de klant: prijszekerheid;
  argument voor KDMN: cashflow + lagere churn. Facturatie via Stripe met iDEAL/SEPA
  (zie `docs/STRIPE_PLAN.md`).
- **Prijsgarantie:** **AANNAME:** prijs vast gedurende de contractperiode; wijzigingen
  aangekondigd ≥60 dagen voor verlenging.

---

## 2. Onboarding — stap voor stap

Totaal per klant: **±10–15 uur werk**, doorlooptijd 1–2 weken (DNS-propagatie en
klant-agenda's zijn de wachttijd, niet het werk). Gebaseerd op de ITProposal-cutover
(`docs/IT_Proposal_Cutover_Plan.md`, `docs/Hypercare_Plan.md`,
`docs/Training_Materiaal_IT_Proposal.md` als herbruikbare basis).

| # | Stap | Wat er gebeurt | Uren |
|---|---|---|---|
| 1 | **Intake & contract** | Kick-off-gesprek: seats, huidig ATS, datavolume, gewenste go-live. Verwerkersovereenkomst tekenen (`docs/VERWERKERSOVEREENKOMST_TEMPLATE.md` — eerst juridisch laten toetsen) + orderbevestiging met tier/seats. | 1,5 |
| 2 | **Tenant aanmaken** | Nieuwe tenant + eerste admin-user aanmaken (tenants-module), branding instellen (logo/kleuren via branding-endpoints), subscription-plan zetten. RLS-isolatie is standaard; het `load-test`-tenant bewijst dat een 50k-kandidaten-tenant naast anderen draait. | 1 |
| 3 | **Data-import uit vorig ATS** | Voor Manatal-klanten bestaat een productie-getest CLI (`apps/api/scripts/manatal-import.ts`): idempotent, `--dry-run`, `--rollback-tenant`, audit-trail; plus parity-check (`apps/api/scripts/parity-check.ts`, runbook `docs/Parity_Check_Runbook.md`). Flow: klant levert export → dry-run → import → parity-rapport naar klant. Ander bron-ATS = maatwerk-mapping (zie §1.3). | 3–6 |
| 4 | **DNS & e-mail** | Verzenddomein van de klant in Resend registreren; klant zet SPF/DKIM/DMARC-records; verificatie afwachten. Optioneel: career page op eigen subdomein (CNAME). **Let op:** `RESEND_API_KEY` moet in prod actief zijn — nu nog leeg (zie memory/ROADMAP); activeren is randvoorwaarde vóór klant #2. | 1–2 |
| 5 | **Users & invite-flow** | Seats aanmaken via de invite-flow (vereist werkende mail, stap 4), rollen toewijzen (RBAC), eventueel SSO configureren (Professional+). | 0,5–1 |
| 6 | **Training** | Eén sessie van 2 uur (remote) voor alle recruiters, o.b.v. het bestaande trainingsmateriaal, aangepast op de branding/flow van de klant. Opname delen als naslagwerk. | 2–3 |
| 7 | **Hypercare** | Twee weken verhoogde alertheid na go-live: dagelijkse check van error-monitoring voor die tenant, snelle respons op vragen (model: `docs/Hypercare_Plan.md`). Afsluiten met evaluatiegesprek. | 1–2 (verspreid) |

**Go/no-go vóór go-live:** parity-check groen, mail-verzending getest (testmail naar klant),
smoke-test op tenant (login, kandidaat aanmaken, CV-upload, zoeken), backup-run geverifieerd.

---

## 3. SLA-kader

Eerlijk kader voor wat één VPS + één beheerder (solo-founder) waar kan maken. Géén
99,99%-beloftes — dat vereist redundante infrastructuur die er niet is en die de prijs
zou verdubbelen.

### 3.1 Beschikbaarheid

- **Uptime-doel: 99,5% per kalendermaand**, gemeten op de app-URL, exclusief aangekondigde
  maintenance-windows. (99,5% = max ±3,6 uur ongepland verlies/maand — realistisch voor
  een enkele Hetzner-VPS met Docker-stack en monitoring.)
- **Geen financiële uptime-penalty in de standaard-tiers.** **AANNAME:** op Enterprise
  desgewenst service-credits (bv. 5% maandfactuur per 0,5%-punt onder doel, cap 25%) —
  alleen aanbieden als een deal erop hangt.
- Continuïteitsmaatregelen die dit doel dragen: dagelijkse backups 03:00 naar Cloudflare R2
  (30 dagen retentie, `infra/backup.sh`), uptime-monitoring met alerting, herstelprocedure
  gedocumenteerd (`docs/Rollback_Plan.md`, `docs/SMOKE_RUNBOOK.md`).

### 3.2 Support

- **Kanaal:** e-mail (support@-adres) als primair kanaal. **AANNAME:** support@kdmn.nl of
  support@talentflow-domein — inrichten vóór klant #2. Geen telefonische 24/7-lijn beloven.
- **Venster:** werkdagen 09:00–18:00 (CET). Buiten venster: best effort bij P1.
- **Responstijden (eerste reactie, binnen venster):**

| Prio | Definitie | Eerste reactie | Streefoplossing |
|---|---|---|---|
| P1 | Applicatie down of dataverlies voor hele tenant | 4 kantooruren | Workaround < 1 werkdag |
| P2 | Kernfunctie stuk, workaround bestaat | 1 werkdag | < 5 werkdagen |
| P3 | Overige bugs, vragen, feature-verzoeken | 3 werkdagen | Roadmap-afhankelijk |

- "Streefoplossing" is een inspanningsverplichting, geen resultaatverplichting — zo in het
  contract formuleren.

### 3.3 Maintenance-windows

- **Standaard-window:** dinsdag en donderdag 22:00–00:00 CET; grote migraties in het weekend.
  **AANNAME:** dagen/tijden definitief te kiezen door Kaan.
- Aangekondigd onderhoud met verwachte downtime: ≥48 uur vooraf per e-mail.
- Noodpatches (security): mogen buiten window, melding achteraf.

---

## 4. Churn & exit

### 4.1 Opzegtermijn

- **Maandabonnement:** opzegbaar per maand, tegen einde van de lopende factuurperiode.
- **Jaarabonnement:** loopt tot einde contractjaar; geen tussentijdse restitutie
  (**AANNAME** — coulance-optie bij bijzondere omstandigheden ter beoordeling Kaan).
  Verlenging stilzwijgend per jaar met opzegtermijn van 1 maand vóór verlengdatum.
- Bij wanbetaling: géén dataverwijdering; tenant gaat naar read-only (zie
  `docs/STRIPE_PLAN.md` §7) — data blijft exporteerbaar.

### 4.2 Data-export bij vertrek (AVG art. 28 lid 3 sub g)

- Klant krijgt bij opzegging een **volledige export in machine-leesbaar formaat**:
  kandidaten, vacatures, sollicitaties, notities, documenten/CV's (ZIP). Bouwstenen
  bestaan al: exports-module + DSAR-export (ZIP) in de compliance-module; een
  volledige-tenant-export-runbook is onderdeel van offboarding.
- **Export-window: 30 dagen** na einddatum. Daarna wordt de tenant-data verwijderd
  (anonimisatie-/verwijderingstooling bestaat in de compliance-module) en verlopen
  backups automatisch door de 30-dagen-lifecycle op R2 — na uiterlijk ~60 dagen is er
  dus niets meer, ook niet in backups. Dit exact zo vastleggen in de
  verwerkersovereenkomst.
- Verwijdering wordt schriftelijk bevestigd aan de klant.

### 4.3 Churn voorkomen (goedkoper dan werven)

- Hypercare-evaluatie (§2 stap 7) + kwartaal-check-in per mail: gebruik per tenant bekijken
  (actieve users, aangemaakte vacatures) en bij dalend gebruik proactief contact.
- Exit-interview bij elke opzegging; reden vastleggen. Bij 10–20 klanten is elke churn ±5–10%
  van de omzet — dit is chefsache, geen automatisering.

---

## 5. Openstaande beslissingen voor Kaan

1. Tier-bedragen en jaarkorting definitief (samen met MONETISATIE_FASE1.md §5).
2. Per-seat bevestigen (aanbeveling §1.1) — raakt ook ROADMAP Sectie 5.9.4.
3. Supportadres + maintenance-window kiezen (§3).
4. Resend-key activeren in prod (randvoorwaarde onboarding stap 4/5).
5. Verwerkersovereenkomst-template juridisch laten toetsen vóór eerste ondertekening.
6. Meerprijs-uurtarief datamigratie-maatwerk bevestigen (§1.3, AANNAME €85/uur).

---

**Gerelateerde documenten:** `docs/MONETISATIE_FASE1.md` (provider + tiers),
`docs/STRIPE_PLAN.md` (billing-implementatie), `docs/VERWERKERSOVEREENKOMST_TEMPLATE.md`
(AVG), `docs/TCO_ROI.md` (benchmark-cijfers), `docs/IT_Proposal_Cutover_Plan.md` +
`docs/Hypercare_Plan.md` + `docs/Training_Materiaal_IT_Proposal.md` (onboarding-basis).

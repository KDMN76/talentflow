# TCO & ROI Analyse — TalentFlow vs. Manatal

**Stagiair:** Kaan
**Stagebedrijf:** IT Proposal — recruitmentbureau, België
**BIM-deliverable:** TCO/ROI-onderbouwing met break-even (versie 1.0)
**Datum:** 5 mei 2026
**Tijdshorizon:** 3 jaar (mei 2026 — mei 2029)

---

## 1. Inleiding & methodologie

### 1.1 Wat is TCO?

**Total Cost of Ownership (TCO)** is de som van *alle* kosten die over de levensduur van een systeem gemaakt worden — niet alleen de licentiefactuur, maar ook hosting, beheer, integraties, onderhoud, training en migratie. Voor een SaaS-product als Manatal is de TCO grotendeels gelijk aan de zichtbare licentiekosten, omdat de leverancier hosting, onderhoud en upgrades op zich neemt. Voor een zelfgebouwd systeem als TalentFlow ligt het zwaartepunt elders: licenties verdwijnen, maar er komen infrastructuur-, AI-API- en onderhoudskosten voor terug.

Dit document zet beide kostenstructuren naast elkaar over een tijdshorizon van **drie jaar** en berekent het break-even-punt en de meerjarige besparing voor IT Proposal.

### 1.2 Scope en aannames

**Wat is meegenomen:**
- Recurring softwarekosten (licenties, hosting, AI-API, e-mail, opslag, domein)
- Eenmalige migratie- en post-stage onderhoudskosten
- Risk-buffers en gevoeligheidsanalyse op de twee grootste variabelen (AI-prijs, teamgroei)

**Wat is buiten scope gelaten:**
- **Stage-uren van Kaan** — dit zijn geen externe kosten voor IT Proposal. De BIM-stage is onbetaald vanuit het bedrijf en wordt door de opleiding gedekt. Het zou de vergelijking kunstmatig vertekenen om deze uren in te boeken alsof het inkoopfacturen waren.
- **Indirecte kosten** zoals productiviteitswinst van recruiters door betere UX of automatisering — moeilijk te kwantificeren binnen de stage-scope.
- **Belastingvoordelen** (WBSO/innovatieaftrek) die mogelijk van toepassing zijn als IT Proposal eigen software laat ontwikkelen.

**Bronnen voor cijfers:**
- Manatal pricing: [manatal.com/pricing](https://www.manatal.com/pricing) (publiek, gecheckt mei 2026)
- Hetzner pricing: [hetzner.com/cloud](https://www.hetzner.com/cloud) (CX22 €5,80/maand)
- Anthropic Claude API pricing: [anthropic.com/pricing](https://www.anthropic.com/pricing) (Sonnet input ~€2,50/M tokens, output ~€12,50/M tokens, mei 2026)
- Resend pricing: [resend.com/pricing](https://resend.com/pricing) (3.000 mails/maand gratis, Pro $20/maand)
- Cloudflare R2 pricing: [cloudflare.com/products/r2](https://www.cloudflare.com/developer-platform/products/r2/) (10 GB gratis, daarna $0,015/GB/maand)
- Werkelijke Manatal-factuur IT Proposal, GORR5CHG-0006 d.d. 8 juni 2026: **$674,00/maand** — 16× Enterprise-seat à $39 (maandtarief) + add-on "MyOwnContracts" $50 flat. Vervangt de eerdere aanname van €1.000/maand.

### 1.3 Wisselkoersen en prijsindexatie

Alle bedragen worden in **euro's** gepresenteerd. Voor USD-prijzen wordt een conservatieve koers van 1 USD = 0,92 EUR gehanteerd (gemiddelde Q1 2026). Voor TalentFlow wordt **geen** prijsindexatie ingerekend; voor Manatal wordt eveneens geen prijsindexatie ingerekend (conservatieve aanname die in het voordeel van Manatal werkt — in de praktijk verhogen SaaS-aanbieders prijzen vaak met 5–10% per jaar).

---

## 2. As-Is — Manatal kosten over 3 jaar

### 2.1 Tier-analyse

Manatal hanteert vier tiers (per gebruiker per maand, jaarlijks gefactureerd):

| Tier | $/user/maand (jaarlijks gefactureerd) | EUR/user/maand | × 16 seats/maand | × 12 maanden/jaar |
|---|---|---|---|---|
| Professional | $15 | €13,80 | €221 | €2.650 |
| Enterprise | $35 | €32,20 | €515 | €6.182 |
| Enterprise Plus | $55 | €50,60 | €810 | €9.715 |
| Custom | op aanvraag | — | — | — |

IT Proposal betaalt feitelijk (factuur GORR5CHG-0006, juni 2026):
**16 Enterprise-seats × $39** (het hogere máándtarief i.p.v. $35 jaarlijks)
**+ add-on "MyOwnContracts" $50 flat = $674,00/maand ≈ €620/maand ≈ €7.440/jaar.**

NB: door maandfacturering betaalt IT Proposal ~$64/maand meer dan de
jaarlijks-gefactureerde lijstprijs; overstappen op jaarfacturering bij Manatal
zou hun kosten al ~€700/jaar drukken. We vergelijken eerlijk met wat er
daadwerkelijk uit de boekhouding stroomt.

### 2.2 3-jaars TCO Manatal

| Jaar | Kosten | Toelichting |
|---|---|---|
| Jaar 1 | €7.440 | 12 × €620 (factuurbedrag, koers 0,92) |
| Jaar 2 | €7.440 | conservatief geen indexatie |
| Jaar 3 | €7.440 | conservatief geen indexatie |
| **Totaal** | **€22.320** | |

**Realistischer scenario (5% indexatie per jaar):** €7.440 + €7.812 + €8.203 = **€23.455**. We rekenen verder met de conservatieve €22.320.

---

## 3. To-Be — TalentFlow kosten over 3 jaar

### 3.1 Hosting (Hetzner VPS)

TalentFlow draait op de bestaande Hetzner-VPS die ook KDMN Financieel en KDMN Planning host. De marginale kosten zijn dus theoretisch **€0**, maar voor een eerlijke TCO alloceren we een deel van de VPS-kosten aan TalentFlow:

- Hetzner CX22 (4 vCPU, 8 GB RAM, 80 GB SSD): €5,80/maand = €70/jaar
- Conservatieve allocatie inclusief eventuele upschaling naar CX32 bij groei: **€10/maand = €120/jaar**

### 3.2 Database & object-storage

- **PostgreSQL**: draait op dezelfde VPS, geen extra licentie- of hostingkosten (€0).
- **Object-storage voor CV's**: Cloudflare R2 (S3-compatible, gratis tier 10 GB).
  - 5.540 kandidaten × ~1 MB CV = ~6 GB → past binnen gratis tier.
  - Buffer voor groei + duplicaten + bijlagen: **€5/maand = €60/jaar**

### 3.3 E-mail (Resend)

- Gratis tier: 3.000 mails/maand (volume IT Proposal geschat op ~2.000/maand).
- Pro tier: $20/maand = €18/maand = €216/jaar — nodig zodra volume groeit boven 3.000/maand of wanneer dedicated IPs gewenst zijn.
- **Aanname:** jaar 1 op gratis tier (€0), vanaf jaar 2 op Pro (€216/jaar).

### 3.4 AI (Claude API)

Dit is de grootste variabele. Kosten worden gedreven door tokenverbruik:

**Claude Sonnet (mei 2026):**
- Input: ~€2,50 per miljoen tokens
- Output: ~€12,50 per miljoen tokens

**Use case 1 — Initial bulk parse + AI-verrijking van bestaande database:**
- Per kandidaat: ~5.000 input tokens (CV-tekst) + ~1.000 output tokens (skills + samenvatting)
- Kosten per kandidaat: (5.000 × €2,50/M) + (1.000 × €12,50/M) = €0,0125 + €0,0125 = **~€0,025**
- 5.540 kandidaten × €0,025 = **€138 eenmalig** (jaar 1)

**Use case 2 — Recurring nieuwe kandidaten:**
- Geschat 200 nieuwe kandidaten/maand × €0,025 = **€5/maand = €60/jaar**

**Use case 3 — AI match scoring per job:**
- Per actieve job × top 100 kandidaten × ~€0,01 per match = €1/job
- ~24 actieve jobs continu, met cycling = **~€24/maand = €288/jaar**

**Use case 4 — Job description generator + AI advanced search:**
- Geschat **€10/maand = €120/jaar**

**Use case 5 — Talent reactivation (nightly cron, hele archief tegen actieve jobs):**
- Embeddings worden gecached, alleen delta-werk = **~€10/maand = €120/jaar**

**Subtotaal AI per jaar:**
- Jaar 1: €138 (eenmalig) + €60 + €288 + €120 + €120 = **€726**
- Jaar 2: €60 + €288 + €120 + €120 = **€588**, maar groei + extra modellen → conservatief **€720**
- Jaar 3: groei naar **€840** (extra AI-features bij 50% meer kandidaten)

**Caching-effect (prompt caching):** Anthropic biedt prompt caching aan met ~90% korting op gecachte tokens. Voor herhaalde JD-templates en system prompts levert dit naar verwachting 20–30% besparing op — al meegenomen in de schattingen.

### 3.5 Domein + SSL

- `.io`-domein of `.eu` via Cloudflare: ~€25/jaar
- SSL via Let's Encrypt: gratis

### 3.6 Monitoring

- Sentry (gratis tier 5k events/maand): €0
- Better Uptime (gratis tier 10 monitors): €0
- Eventuele upgrade bij groei: budget €0/jaar in jaar 1, €60/jaar in jaar 3

### 3.7 Totaal TalentFlow per jaar

| Component | Jaar 1 | Jaar 2 | Jaar 3 |
|---|---|---|---|
| Hosting (VPS-allocatie) | €120 | €120 | €120 |
| Object-storage (R2) | €60 | €60 | €60 |
| E-mail (Resend) | €0 | €216 | €216 |
| AI (Claude API) | €726 | €720 | €840 |
| Domein + SSL | €25 | €25 | €25 |
| Monitoring | €0 | €0 | €60 |
| **Totaal per jaar** | **€931** | **€1.141** | **€1.321** |

**3-jaars totaal TalentFlow: €3.393**

---

## 4. Vergelijkingstabel

| Periode | Manatal | TalentFlow | Besparing | Besparing % |
|---|---|---|---|---|
| Jaar 1 | €7.440 | €931 | **€6.509** | 87% |
| Jaar 2 | €7.440 | €1.141 | **€6.299** | 85% |
| Jaar 3 | €7.440 | €1.321 | **€6.119** | 82% |
| **3-jaars totaal** | **€22.320** | **€3.393** | **€18.927** | **85%** |

Op het ruwe operationele kostenniveau elimineert TalentFlow ~85% van de Manatal-uitgaven. De volgende sectie corrigeert dit beeld voor onderhoud en risico.

---

## 5. Eenmalige investering en post-stage onderhoud

### 5.1 Stage-investering (geen externe kost)

Kaan ontwikkelt TalentFlow als BIM-stage van zes maanden. Voor IT Proposal zijn dit **geen externe uitgaven** — er wordt geen ontwikkelaar ingehuurd. We boeken deze uren dus expliciet *niet* in als kostenpost in de TCO. Wel is het eerlijk om de *vervangingswaarde* te benoemen: indien IT Proposal hetzelfde resultaat extern zou inkopen tegen €60–80/uur × ~700 stage-uren, ligt de marktwaarde op €42.000–€56.000. Dit cijfer is informatief, niet onderdeel van de TCO.

### 5.2 Post-stage onderhoud

Na afloop van de stage moet IT Proposal kiezen tussen:

**Optie A — Externe ontwikkelaar inhuren voor onderhoud:**
- Geschat 4 uur/maand × €70/uur (gemiddeld senior NL/BE-tarief) = €280/maand = **€3.360/jaar**
- 3-jaars onderhoud (start na stage in maand 7): 30 maanden × €280 = **€8.400**

**Optie B — Kaan in dienst nemen (parttime):**
- Niet gemodelleerd in deze TCO-vergelijking; afhankelijk van arbeidsovereenkomst en niet vergelijkbaar met Manatal-licentie

**Optie C — Beheer zelf doen (bus-factor risico):**
- €0 directe kosten, maar verhoogd uitvalrisico

We rekenen verder met **Optie A** als conservatieve aanname.

### 5.3 Risk-buffer

Onverwachte issues (data-recovery, security-incident, infrastructuur-uitbreiding):
- Eenmalige buffer jaar 1: **€2.000**
- Recurring buffer jaar 2 en 3: **€500/jaar**

---

## 6. Break-even analyse

### 6.1 Break-even zonder onderhoud (operationeel)

- Gemiddelde besparing per maand: ~€526 (€18.927 / 36 maanden)
- Eenmalige investering vanuit IT Proposal: €0 (stage)
- **Break-even:** vanaf maand 1 na go-live — elke maand levert direct besparing op

### 6.2 Break-even mét post-stage onderhoud (Optie A)

| Component | 3-jaars bedrag |
|---|---|
| TalentFlow operationeel | €3.393 |
| Post-stage onderhoud (€280/maand × 30 mnd) | €8.400 |
| Risk-buffer (€2.000 + 2 × €500) | €3.000 |
| **Totaal TCO TalentFlow** | **€14.793** |
| Totaal TCO Manatal | €22.320 |
| **Netto besparing 3 jaar** | **€7.527** |

Per maand komt dit neer op een netto-besparing van **~€209**, ofwel **~34% reductie** van de huidige TCO. Break-even blijft direct vanaf go-live, omdat de stage-investering geen cashout vraagt.

**Belangrijke nuance bij de echte factuurcijfers:** de onderhoudsaanname
(€280/maand extern) is nu de dominante kostenpost — groter dan de volledige
operationele stack. Elke euro die het onderhoud goedkoper uitvalt (bijv. KDMN
als design-partner-arrangement, of lagere werkelijke onderhoudsbehoefte door de
hoge testdekking) vertaalt zich 1-op-1 in extra besparing; bij onderhoud ≤
€130/maand stijgt de netto-besparing weer boven €12.000 over 3 jaar.

### 6.3 Visualisatie cumulatieve kasstroom

```
Cumulatieve kosten over 36 maanden (vereenvoudigd):

€36k │                                      ●  Manatal (€22.320)
     │                              ●
€30k │                      ●
     │              ●
€24k │      ●
     │ ●
€18k │
     │
€12k │
     │
 €6k │                                      ●  TalentFlow met onderhoud (€14.793)
     │                              ●
 €0k │ ●────●──────●──────●──────●
     └─────────────────────────────────────
       M1   M6    M12   M18   M24   M30   M36

Verschil M36 = €7.527 in voordeel TalentFlow (Manatal-lijn eindigt op €22.320)
```

---

## 7. Risico's & gevoeligheidsanalyse

### 7.1 Wat als Claude-API 50% duurder wordt?

- AI-kosten jaar 2: €720 → €1.080 (+€360)
- 3-jaars meerkost: ~€1.000
- Impact op netto besparing: €7.527 → €6.527. **Conclusie: besparing blijft overeind, maar de marge is dunner — AI-kosten bewaken hoort bij het onderhoud.**

### 7.2 Wat als IT Proposal naar 20 recruiters groeit?

- Manatal (per-seat-pricing, $39/seat maandtarief + add-on): 20 × $39 + $50 = $830/maand ≈ €764/maand → **~€27.500 over 3 jaar**
- TalentFlow: kosten stijgen marginaal (meer e-mail volume + iets meer AI). Conservatief +€500/jaar = €1.500 extra over 3 jaar
- **Netto besparing groeit dan naar ~€11.200 over 3 jaar** (€27.500 − €14.793 − €1.500). Per-seat-pricing bij Manatal maakt groei daar lineair duurder; bij TalentFlow nagenoeg gratis. Dit is het bull-case.

### 7.3 Wat als migratie naar nieuwe stack na 3 jaar nodig is?

- Aanname herinvestering: €15.000–€25.000 voor major upgrade
- In worst-case (€25.000 in jaar 4) verdwijnt de cashbesparing over 4 jaar tegen het huidige seat-aantal (Manatal jaar 1–4 = ~€29.800). De rechtvaardiging zit dan in de strategische waarde (eigen product, commerciële uitrol), niet in pure kostenbesparing — eerlijk benoemen in het eindgesprek.

### 7.4 Wat als bus-factor 1 ontspoort?

Dit is het zwaarste niet-financiële risico. Mitigatie via:
- First-class documentatie (architectuur-doc, runbook, deploy-guide)
- Code in eigendom van IT Proposal (Git-repository)
- Optie om externe partij in te huren — kosten gemodelleerd in 5.2
- Geen vendor lock-in: data zit in standaard PostgreSQL en kan altijd geëxporteerd worden

### 7.5 Risico-impact-tabel

| Risico | Kans | Financiële impact 3 jaar | Mitigatie |
|---|---|---|---|
| Claude-API +50% prijs | Midden | ~€1.000 | Multi-LLM fallback (OpenAI/Gemini) |
| Hetzner downtime > 24u | Laag | reputatieschade | Daily backups + Better Uptime alerting |
| Onverwachte security-incident | Laag | €5–15k | RLS by default, audit log, security review |
| GDPR-boete | Laag | €10k–€20M (extreme) | Consent management + data-retention by design |
| Bus-factor 1 (uitval Kaan) | Midden | €5–10k externe inhuur | Documentatie + code-eigendom + standaard stack |
| Concurrent (Manatal) drukt prijs | Midden | -€2.000–€5.000 op besparing | Niet beïnvloedbaar; nog steeds netto positief |

---

## 8. Conclusie & aanbeveling

### 8.1 De cijfers

- **TalentFlow elimineert ~85% van de operationele Manatal-kosten** (€18.927 besparing over 3 jaar op rauw kostenniveau; gebaseerd op de werkelijke factuur van $674/maand voor 16 seats).
- **Inclusief realistisch post-stage onderhoud bedraagt de netto besparing €7.527 over 3 jaar** — ongeveer **€209/maand (~34% TCO-reductie)**.
- **Break-even ligt feitelijk op dag 1** na go-live, omdat de stage-investering geen cashout vergt voor IT Proposal.
- De onderhoudsaanname (€280/maand extern) is de dominante post; elke verlaging daarvan (design-partner-arrangement, lagere werkelijke behoefte) vloeit 1-op-1 naar de besparing. Bij groei naar 20 seats stijgt de besparing naar ~€11.200 (per-seat-pricing raakt Manatal, niet TalentFlow).
- De grootste waarde zit naast de besparing in de **strategische optionaliteit**: een eigen, commercieel uitrolbaar product i.p.v. een kostenpost.

### 8.2 Wat de cijfers *niet* meten

- Productiviteitswinst van recruiters door betere automatisering en AI-matching (positief, maar niet gekwantificeerd)
- Strategische optionaliteit: TalentFlow kan in de toekomst commercieel uitgerold worden naar andere bureaus, wat het project van kostenpost naar inkomstenbron transformeert
- Risico van onderschatting: een eerste eigen ATS-bouw bevat altijd onzekerheden in onderhoud en doorontwikkeling

### 8.3 Aanbeveling

Het financiële plaatje is overtuigend, ook na conservatieve correcties voor onderhoud, risk-buffer en gevoeligheid. **De zwakste schakel is niet de TCO maar de bus-factor en onderhoudsverantwoordelijkheid na de stage.** De aanbeveling is daarom:

1. **Doorgaan met de migratie** van Manatal naar TalentFlow.
2. **Vooraf besluiten** over post-stage onderhoud — Optie A (externe ontwikkelaar) of Optie B (Kaan parttime in dienst). Niet uitstellen tot de stage afloopt.
3. **Documentatie als first-class deliverable** behandelen, niet als bijproduct.
4. **Manatal-account 3 maanden parallel laten draaien** als safety-net tijdens de switch — ~€3.000 extra, maar verzekert continuïteit. Deze kost is *niet* meegenomen in de bovenstaande berekeningen en zou de netto-besparing 3 jaar reduceren tot **~€18.207**.

---

**Gerelateerde documenten:**
- [`Masterplan_Stage.md`](Masterplan_Stage.md)
- [`Manatal_Feature_Pariteit.md`](Manatal_Feature_Pariteit.md)
- [`As_Is_Proces.md`](As_Is_Proces.md)
- [`SWOT_Analyse.md`](SWOT_Analyse.md)

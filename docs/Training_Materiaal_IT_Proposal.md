# Trainings-materiaal IT Proposal — TalentFlow

**Voor:** 9 recruiters van IT Proposal die overstappen van Manatal naar TalentFlow.
**Vorm:** 1-A4 verschillen-tabel + 5 video-walkthrough-scripts + FAQ.
**Tijdsinvestering recruiter:** 30 min walkthrough + 15 min zelfstudie = 45 min totaal.

**Verwante docs:**
- [IT_Proposal_Cutover_Plan.md](IT_Proposal_Cutover_Plan.md)
- [As_Is_Proces.md](As_Is_Proces.md) — huidige Manatal-flow
- [To_Be_Proces.md](To_Be_Proces.md) — TalentFlow doel-flow

---

## Deel 1: 1-pager (A4) — Top 10 Manatal -> TalentFlow verschillen

> **Print dit en hang het naast je scherm tijdens de eerste week.**

### Wat is hetzelfde?
Bijna alles wat je dagelijks doet ziet er hetzelfde uit. Drag-drop pipeline, kandidaat aanmaken, e-mail versturen — zelfde plek, zelfde gevoel.

### Wat is anders? — top 10

| # | Manatal-actie | TalentFlow-equivalent | Tip |
|---|---|---|---|
| 1 | Klik **+ New Candidate** rechtsboven | Klik **Nieuwe kandidaat** rechtsboven (zelfde plek, NL) | Sneltoets `N` |
| 2 | **Sleep kaart** in pipeline | Idem (drag-drop zelfde gedrag) | Auto-save, geen 'opslaan' nodig |
| 3 | **E-mail** vanuit candidate-detail | Knop **E-mail versturen** met template-picker | Templates beheer je in Settings |
| 4 | Tab **AI Recommendations** | Tab **AI Suite** met top-matches + sourcing-tips + JD bias-check | EU AI Act-banner verplicht zichtbaar |
| 5 | **Boolean search** apart van AI | Een veld: typ `react AND typescript NOT junior` of natuurlijke taal `senior react devs in Den Haag` | Beide werken in zelfde zoekbalk |
| 6 | **CSV-export** rechtsbovenin lijst | Knop **Exporteer naar CSV** rechtsbovenin lijst | NL-tekens (é, ø, €) werken in Excel |
| 7 | **Custom fields** in Settings -> Forms | Settings -> Custom Fields, drag-drop in formulier | Renderen direct, geen save nodig |
| 8 | **Workflow** triggers via 'Automations' | Settings -> Workflows; 7 actie-typen, 5 actief, WhatsApp/SMS later | Gebruik template 'Auto-email bij stage' om te starten |
| 9 | **Career page** beheer apart in 'Career Pages' | Tab **Career Page** in TalentFlow, eigen kleuren + logo | Custom domain in Q2 (`carrieres.itproposal.nl`) |
| 10 | **Activity log** rechterzijde candidate | Tab **Activiteit** op candidate-detail | Inclusief AI-events (tokens + provider zichtbaar) |

### Top 5 nieuwe TalentFlow-features (die Manatal niet had of slechter doet)

1. **AI matching met uitleg** — niet alleen score, maar 'sterke punten / gaps' in NL
2. **EU AI Act art. 13 disclosure** standaard zichtbaar bij elke AI-output (compliance-proof)
3. **Audit-trail WORM** — elke wijziging onveranderlijk gelogd, 100% GDPR-compatibel
4. **Open API vanaf dag 1** — geen Enterprise-tier-paywall
5. **NL-eerst** — UI, parser, AI prompts allemaal voor Nederlandse markt geoptimaliseerd

### Bij vragen
- **Slack:** `#talentflow-support` — Kaan of Angelo binnen 2 uur op werkdagen
- **FAQ:** klik **?** rechtsbovenin TalentFlow
- **Walkthrough opnieuw:** plan een 15-min slot in Angelo's agenda

---

## Deel 2: 5 video-walkthrough-scripts (5 min elk)

Scripts voor screencast-opnames. Lever per video: MP4 + transcript + tijdcodes.

### Video 1: Kandidaat sourcen + parsen (5 min)

**Doelgroep:** alle recruiters
**Leerdoel:** een nieuwe kandidaat toevoegen + CV laten parsen + skills nakijken

**Script:**
1. **0:00-0:30** — Welkom. "In deze video laat ik zien hoe je een nieuwe kandidaat toevoegt aan TalentFlow. Het werkt vrijwel identiek aan Manatal, maar met een paar verbeteringen die je tijd besparen."
2. **0:30-1:30** — Login + naar Kandidaten -> Nieuwe kandidaat. "Vul naam + email + telefoon in. Je hoeft niet alles vooraf te weten — de parser vult de rest."
3. **1:30-3:00** — Upload CV. "Sleep een PDF of DOCX naar het upload-vak. Binnen 30 seconden zie je de parser-output: skills, opleidingen, werkervaring. Als parser klaar is, krijg je een toast-melding."
4. **3:00-4:00** — Skills nakijken. "Hier zie je de skills met scores 1-10. Niet eens met een score? Klik op de skill, pas aan. Je correctie traint onze parser bij voor jouw tenant."
5. **4:00-5:00** — Tags + source toevoegen. "Voeg `source=linkedin` of `source=referral` toe. Dit voedt onze analytics later. Klaar — kandidaat is searchable."

### Video 2: Pipeline + stage management (5 min)

**Doelgroep:** alle recruiters
**Leerdoel:** kandidaten door pipeline bewegen + workflow-effect kennen

**Script:**
1. **0:00-0:30** — Welkom. "We bekijken de pipeline van een open job. Drag-drop werkt identiek aan Manatal."
2. **0:30-2:00** — Open job -> Pipeline tab. "Je ziet 9 stages: Sourced, Screened, Submitted, Interview-1, Interview-2, Offer, Placed, Rejected, On-hold. Elke kaart toont kandidaat-naam, time-in-stage badge en source."
3. **2:00-3:30** — Sleep kaart. "Sleep van Sourced naar Screened. Auto-save. Audit-event geschreven. Als er een workflow op deze stage zit (bijv. auto-email), zie je een blauwe puls — workflow draait."
4. **3:30-4:30** — Bulk-actie. "Selecteer 5 kaarten, klik 'Bulk' -> 'Move to stage' -> kies 'Submitted'. Allemaal in één klik."
5. **4:30-5:00** — Activity-log check. "Klik op kandidaat -> Activiteit. Je ziet alle stage-overgangen + wie het deed + tijdstempel."

### Video 3: E-mail + templates (5 min)

**Doelgroep:** alle recruiters
**Leerdoel:** template-mail versturen + reply ontvangen + thread

**Script:**
1. **0:00-0:30** — Welkom. "E-mail vanuit TalentFlow werkt 1-op-1 zoals Manatal, plus we threaden replies automatisch."
2. **0:30-2:00** — Open kandidaat -> 'E-mail versturen'. "Modal opent, kies template uit dropdown (bijv. 'Uitnodiging interview ronde 1'). Merge-vars `{{candidate.first_name}}` en `{{job.title}}` worden automatisch ingevuld."
3. **2:00-3:30** — Body aanpassen + verzenden. "Pas de tekst aan, klik Verstuur. Toast bevestigt. Activity-log toont 'E-mail verstuurd om HH:MM'."
4. **3:30-4:30** — Reply-flow. "Wanneer kandidaat antwoordt, valt reply binnen 1 minuut op zelfde candidate-thread. Je krijgt een notificatie + ziet 'inbound'-event."
5. **4:30-5:00** — Templates beheren. "Settings -> Templates. Maak nieuwe of pas bestaande aan. Merge-vars staan in de help-tooltip."

### Video 4: AI matching gebruiken (5 min)

**Doelgroep:** alle recruiters + Angelo (champion)
**Leerdoel:** AI Suite tab gebruiken + matches interpreteren + EU AI Act-disclosure

**Script:**
1. **0:00-0:45** — Welkom. "AI matching toont de top-kandidaten voor een job, met uitleg waarom. Belangrijk: AI is een hulpmiddel, niet een beslisser."
2. **0:45-2:00** — Open job -> AI Suite tab. "Je ziet top-10 kandidaten met cosine-score 0-100%. Hoger = betere skill-match. Klik op een match voor uitleg."
3. **2:00-3:30** — Match-uitleg lezen. "Je ziet 'Sterke punten: React (9/10), TypeScript (8/10)' en 'Gaps: senior-niveau, GraphQL'. Gebruik dit als gespreksopener, niet als selectie-criterium."
4. **3:30-4:30** — EU AI Act disclosure. "Onderaan de tab zie je een banner: 'Deze score is gegenereerd door AI (Claude). Klik voor uitleg.' Dit is verplicht onder EU AI Act art. 13. Niet wegklikken."
5. **4:30-5:00** — Feedback-loop. "Vind je de matching slecht? Klik 'Geef feedback'. Onze AI leert per tenant; jouw input verbetert de matching voor IT Proposal specifiek."

### Video 5: Bulk-acties + saved searches (5 min)

**Doelgroep:** ervaren recruiters
**Leerdoel:** efficiency-features benutten

**Script:**
1. **0:00-0:30** — Welkom. "Bulk-acties en saved searches zijn de productiviteits-upgrade van TalentFlow."
2. **0:30-2:00** — Boolean search. "In de zoekbalk: typ `react AND typescript NOT junior`. Of natuurlijke taal: `senior frontend devs Den Haag laatste 6 maanden`. Beide werken."
3. **2:00-3:00** — Saved search. "Klik 'Bewaren als'. Geef naam ('Senior FE DH'). Verschijnt in zijbalk. 1-klik herhalen."
4. **3:00-4:30** — Bulk-actie. "Selecteer 20 kandidaten via checkbox. 'Bulk' menu -> Add tag -> 'sourced-okt'. Of: bulk archiveren, bulk move-to-stage, bulk change-source."
5. **4:30-5:00** — Audit-trail. "Elke bulk-actie schrijft een audit_event met alle ID's. Compliance-proof. Reverse-bare als je per ongeluk verkeerd selecteerde — Slack ons."

---

## Deel 3: FAQ — top 20 vragen

Live vanaf week -1 op interne wiki + linked vanuit help-tooltip in TalentFlow.

### Login + Account
1. **Hoe log ik in?** Ga naar `https://talentflow.app/login`. Gebruik je IT Proposal email + tijdelijk wachtwoord uit je uitnodigingsmail. Reset wachtwoord direct na eerste login.
2. **Mijn wachtwoord werkt niet.** Klik 'Wachtwoord vergeten' op login-pagina. Reset-link komt binnen 1 min in je inbox. Geen mail? Check spam, dan Slack `#talentflow-support`.
3. **Sessie verloopt te snel.** Access-token vervalt na 15 min, maar refresh-cookie houdt je 7 dagen ingelogd op zelfde browser. Hard-refresh werkt — je hoeft niet opnieuw in te loggen.
4. **Kan ik in twee browsers tegelijk?** Ja, sessions zijn onafhankelijk per browser/device.

### Kandidaten
5. **Mijn kandidaten uit Manatal — staan ze in TalentFlow?** Ja, alle 5.540 kandidaten zijn geïmporteerd inclusief CV's, skills, sollicitaties en activity-log.
6. **Een kandidaat ontbreekt.** Check eerst zoekbalk op alternatieve spelling. Als echt missing: Slack `#talentflow-support` met candidate-naam + Manatal-ID.
7. **Hoe upload ik een CV?** Open kandidaat -> CV's-tab -> sleep PDF/DOCX naar upload-vak. Parser draait binnen 30s.
8. **Parser herkent skills niet.** Klik 'Re-parse'. Werkt nog niet? Voeg skills handmatig toe in Skills-tab; jouw input traint de parser.

### Pipeline
9. **Drag-drop werkt niet.** Refresh pagina. Werkt nog niet? Probeer andere browser. Als persistent: Slack-team.
10. **Stage-overgang triggerde geen email.** Check Settings -> Workflows of de workflow actief is voor deze job. Default workflows zijn niet altijd aan.
11. **Kan ik stages aanpassen?** Settings -> Pipeline-templates. 9-stage default werkt voor IT Proposal; wijzig met overleg met Angelo.

### E-mail
12. **Mijn email kwam niet aan.** Check Resend-dashboard (Angelo heeft toegang). Bounces zijn meestal full inbox of typo. Bcc jezelf om verzenden te bevestigen.
13. **Templates aanpassen?** Settings -> E-mail templates. Wijzigen heeft direct effect — geen versie-historie (komt Q2).

### AI features
14. **Wat als AI score laag is bij een goede kandidaat?** Score is een hulpmiddel, niet absoluut. Lees de uitleg-tab; vaak is het een gap die je kunt invullen via interview. Geef feedback aan AI om over tijd te verbeteren.
15. **Mag ik AI-output naar kandidaten kopiëren?** Lees + bewerk altijd. AI hallucineert soms. Onder EU AI Act ben jij verantwoordelijk voor wat je verstuurt.

### Bulk + import
16. **Hoeveel kandidaten kan ik in één bulk doen?** 500 max per actie. Boven dat: doe in batches.
17. **CSV-import fouten?** Download error-rapport vanuit import-status pagina. Meestal: ontbrekend email of duplicate reference. Fix CSV, herupload.

### Compliance
18. **Een kandidaat vraagt om GDPR-export.** Open kandidaat -> Compliance-tab -> 'Genereer GDPR-export'. Binnen 2 min mail naar de kandidaat met volledige data-dump.
19. **Een kandidaat vraagt om verwijdering.** Compliance-tab -> 'Verwijderen aanvragen'. Triggert workflow met 30-dagen-grace-periode (intrekken mogelijk) + permanente delete.

### Bug rapporteren
20. **Ik denk dat ik een bug heb gevonden.** Slack `#talentflow-support` met: stappen om te reproduceren, screenshot, browser-versie. Kaan triageert binnen 2 uur op werkdagen.

---

## Deel 4: Trainings-checklist per recruiter

Aan einde van walkthrough-week: elk recruiter levert in:

- [ ] Eerste login geslaagd
- [ ] Walkthrough 30 min met Angelo gedaan
- [ ] 1-pager A4 ontvangen (digitaal of fysiek)
- [ ] FAQ doorgelezen
- [ ] Test-kandidaat aangemaakt + CV geupload + parser-output gezien
- [ ] Test-mail verstuurd vanuit TalentFlow + ontvangen
- [ ] Drag-drop in pipeline geoefend
- [ ] AI Suite tab geopend + 1 match gelezen
- [ ] Slack-channel `#talentflow-support` lid + bericht gepost
- [ ] Eventuele vragen beantwoord

Lever in via formulier (Google Forms): `https://forms.gle/...` — Angelo verifieert.

---

## Deel 5: Trainings-feedback (na walkthrough-week)

Korte enquête (5 min) per recruiter:

1. Heb je vertrouwen om dagelijks in TalentFlow te werken? (1-5)
2. Welke 3 features mis je nog vergeleken met Manatal?
3. Welke 3 features in TalentFlow vind je beter dan Manatal?
4. Wat zou je in de training anders willen?
5. Heb je nog een 1-op-1 nodig voor go-live?

Resultaat voedt Go/No-go-meeting.

# Go/No-Go Beslis-template — TalentFlow Cutover IT Proposal

**Te gebruiken in week +1 (zie [IT_Proposal_Cutover_Plan.md](IT_Proposal_Cutover_Plan.md) tijdlijn).**
**Doel:** documenteer het cutover-besluit met handtekeningen voor stage-deliverable.

---

## 1. Meeting-metadata

| Veld | Waarde |
|---|---|
| Datum + tijd | _________________________ |
| Locatie | _________________________ |
| Verwachte cutover-datum | _________________________ |
| Voorzitter | Kaan |
| Notulist | Kaan |
| Duur | 60 min (45 min review + 15 min besluit) |

---

## 2. Aanwezigen

| Naam | Rol | Aanwezig | Stem |
|---|---|---|---|
| Kaan | Lead engineer / BIM-stagiair | [ ] | Adviseur (geen veto) |
| Angelo | Recruiter-champion IT Proposal | [ ] | Veto-recht namens recruiters |
| [stagebegeleider] | BIM-stagebegeleider | [ ] | Adviseur (geen veto) |
| [optioneel: management IT Proposal] | _____ | [ ] | Veto-recht commercieel |

**Veto-regels:** als Angelo of management NO-GO zegt, is het NO-GO. Stagebegeleider kan adviseren maar niet vetoën.

---

## 3. Agenda

1. (0-5 min) Welkom + doel meeting
2. (5-20 min) Review pariteit-rapport (Kaan presenteert)
3. (20-35 min) Review performance-test + recruiter-feedback (Angelo presenteert)
4. (35-45 min) GO/NO-GO criteria checklist invullen
5. (45-55 min) Beslissing + handtekeningen
6. (55-60 min) Volgende stappen + cutover-datum-lock

---

## 4. Pariteit-rapport (input van `parity-check.ts`)

| Metric | Doel | Werkelijk | Status |
|---|---|---|---|
| Critical issues | 0 | _____ | [ ] OK [ ] Niet OK |
| Major issues | <10 | _____ | [ ] OK [ ] Niet OK |
| Minor issues | <30 | _____ | [ ] OK [ ] Niet OK |
| Kandidaten geïmporteerd | 5.540 (±0.1%) | _____ | [ ] OK [ ] Niet OK |
| Jobs geïmporteerd | 24 | _____ | [ ] OK [ ] Niet OK |
| Recruiter-accounts actief | 9 | _____ | [ ] OK [ ] Niet OK |
| CV-parser success rate | >=95% | _____ % | [ ] OK [ ] Niet OK |

**Link naar volledig rapport:** `docs/parity-results-YYYY-MM-DD.md`

**Outstanding issues lijst:**
| # | Severity | Beschrijving | Workaround | Owner | Fix-datum |
|---|---|---|---|---|---|
| 1 | _____ | _____ | _____ | _____ | _____ |
| 2 | _____ | _____ | _____ | _____ | _____ |

---

## 5. Performance-test resultaten

| Metric | Doel | Werkelijk | Status |
|---|---|---|---|
| /candidates lijst load (cold) | <3000ms | _____ ms | [ ] OK [ ] Niet OK |
| /candidates lijst load (warm) | <1000ms | _____ ms | [ ] OK [ ] Niet OK |
| Pipeline-kanban scroll FPS | >=50 | _____ fps | [ ] OK [ ] Niet OK |
| Resume parser p95 latency | <30s | _____ s | [ ] OK [ ] Niet OK |
| AI matching p95 latency | <5s | _____ s | [ ] OK [ ] Niet OK |
| Email send -> Resend ack | <10s | _____ s | [ ] OK [ ] Niet OK |
| /health uptime laatste 7d | >=99.9% | _____ % | [ ] OK [ ] Niet OK |
| Sentry errors laatste 24u | <10 | _____ | [ ] OK [ ] Niet OK |
| k6 load-test 50 concurrent | 0 errors | _____ errors | [ ] OK [ ] Niet OK |

---

## 6. Recruiter-feedback samenvatting (shadow-run)

**Bron:** week 0 dagelijkse retro + eind-survey (zie [Training_Materiaal_IT_Proposal.md](Training_Materiaal_IT_Proposal.md) Deel 5).

| Vraag | Score (1-5 gemiddelde) |
|---|---|
| Vertrouwen om dagelijks in TalentFlow te werken | _____ |
| Snelheid vergeleken met Manatal | _____ |
| Bug-frequency tijdens shadow-run | _____ |
| Trainings-kwaliteit | _____ |

**Aantal recruiters die GO zegt (van 9):** _____ / 9
**Drempel voor GO:** >=7 / 9.

**Top 3 feedback-punten (positief):**
1. _________________________________
2. _________________________________
3. _________________________________

**Top 3 feedback-punten (negatief):**
1. _________________________________
2. _________________________________
3. _________________________________

**Plan voor negatieve feedback:**
| # | Punt | Actie | Owner | Deadline |
|---|---|---|---|---|
| 1 | _____ | _____ | _____ | _____ |

---

## 7. GO/NO-GO Criteria Checklist

Vink **alleen aan als bewijs voorhanden**. Geen partial credit.

### A. Pariteit
- [ ] 0 critical pariteit-issues in laatste rapport
- [ ] <=10 major issues met workaround gedocumenteerd
- [ ] Pariteit-rapport gedeeld + reviewed

### B. Performance
- [ ] Kandidaten-lijst van 5.540 < 3s p95 cold
- [ ] Pipeline scrollt >=50fps bij 50+ kaarten in stage
- [ ] /health 99.9% laatste 7 dagen
- [ ] k6 load-test slaagt zonder errors

### C. Backup + restore
- [ ] Backup-cron draait (verifieerbaar in R2)
- [ ] Restore-test van gisteren-backup geslaagd
- [ ] Manatal-export op 3 plaatsen (lokaal SSD, R2, encrypted USB)
- [ ] Rollback-procedure getest in staging (zie [Rollback_Plan.md](Rollback_Plan.md))

### D. Mensen
- [ ] 9 recruiters hebben TalentFlow-account + walkthrough gedaan
- [ ] >=7/9 recruiters geven GO in shadow-run-survey
- [ ] Angelo tekent als recruiter-champion
- [ ] Hypercare-recruiter (Kaan) is +3 dagen full-time beschikbaar

### E. Compliance
- [ ] DPO-review GDPR-flow akkoord
- [ ] Audit-trail WORM-trigger geverifieerd
- [ ] EU AI Act art. 13 disclosure zichtbaar bij AI-features
- [ ] Consent-status per kandidaat correct gemigreerd

### F. Communicatie
- [ ] Cutover-aankondiging gepland voor go-live-dag
- [ ] Slack `#talentflow-support` channel actief
- [ ] DKIM/SPF/DMARC live + warm-up afgerond
- [ ] Email-deliverability >=95% in test-week

### G. Stage-deliverables
- [ ] Stagebegeleider heeft tussenoordeel 'voldoende' afgegeven
- [ ] BIM-portfolio geupdate met cutover-plan + pariteit-rapport
- [ ] Documentatie compleet (cutover-plan, pariteit, rollback, hypercare)

**Totaal aangevinkt:** _____ / 27
**Drempel voor GO:** alle 27 aangevinkt.

---

## 8. NO-GO Triggers (1+ activeert NO-GO)

- [ ] 1+ critical pariteit-issue niet opgelost — beschrijf: _________________
- [ ] >5/9 recruiters zegt 'niet productie-rijp' — beschrijf: _________________
- [ ] Performance < target op meerdere meetmomenten — beschrijf: _________________
- [ ] VPS instabiel laatste 7 dagen — beschrijf: _________________
- [ ] Backup-restore-test gefaald — beschrijf: _________________
- [ ] Email-deliverability < 95% in warm-up — beschrijf: _________________
- [ ] Stagebegeleider geeft tussenoordeel onvoldoende — beschrijf: _________________

---

## 9. Beslissing

**Gekozen optie:** [ ] GO / [ ] NO-GO / [ ] CONDITIONAL-GO

**Indien CONDITIONAL-GO:** lijst van condities die voor cutover-dag opgelost moeten zijn:
1. _________________________________ — owner _____ — deadline _____
2. _________________________________ — owner _____ — deadline _____
3. _________________________________ — owner _____ — deadline _____

**Indien NO-GO:** plan voor 2e besluit-meeting + datum: _____

**Indien GO:** cutover-datum gelocked op: _________________ (zaterdag preferred)

---

## 10. Handtekeningen

| Rol | Naam | Beslissing | Handtekening | Datum |
|---|---|---|---|---|
| Lead engineer | Kaan | Adviseert: ___ | ____________ | _____ |
| Recruiter-champion | Angelo | Stem: ___ | ____________ | _____ |
| Stagebegeleider | _____ | Adviseert: ___ | ____________ | _____ |
| Management IT Proposal (optioneel) | _____ | Stem: ___ | ____________ | _____ |

---

## 11. Volgende stappen

| # | Actie | Owner | Deadline |
|---|---|---|---|
| 1 | Cutover-dag-draaiboek finaliseren met gelockte datum | Kaan | T-3 dagen |
| 2 | Communicatie 'cutover op _____' naar IT Proposal | Angelo | T-3 dagen |
| 3 | Hypercare-rooster bevestigen | Kaan | T-3 dagen |
| 4 | Manatal-pause-aanvraag voorbereiden | Angelo | T-2 dagen |
| 5 | Final delta-export procedure dry-run | Kaan | T-1 dag |

---

## 12. Notulen / aanvullende notities

_(Vrije ruimte voor discussie-punten, opmerkingen, action-items die niet in bovenstaande secties passen.)_

_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________

---

**Document opgeslagen als:** `docs/go-nogo-results-YYYY-MM-DD.md` (nieuwe kopie van dit template per meeting).

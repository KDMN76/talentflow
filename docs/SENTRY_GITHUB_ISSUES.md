# Sentry-bugs → GitHub Issues (trackbare to-do's)

Doel: elke nieuwe Sentry-fout wordt **automatisch een GitHub-issue** in
`KDMN76/talentflow`, zodat een bug een actie-item wordt (met assignee + labels) en
**automatisch sluit** zodra je 'm fixt. Sentry zelf blijft de bron (stacktrace,
breadcrumbs, regressie-detectie); GitHub wordt je to-do-lijst.

> De koppeling zet je aan in het Sentry-dashboard (vereist je Sentry-login +
> GitHub-org-admin). Dit zijn de exacte stappen.

## 1. Sentry ↔ GitHub verbinden (eenmalig)

1. Sentry → **Settings → Integrations → GitHub → Add Installation**.
2. Kies de GitHub-org **KDMN76** en geef toegang tot de repo **talentflow**
   (Only select repositories → `talentflow`).
3. Na installatie: open in Sentry **Settings → Integrations → GitHub → Configure**
   en bevestig dat `KDMN76/talentflow` gekoppeld is.

Dit alleen al geeft je: **suspect commits** (Sentry toont welke commit een fout
waarschijnlijk introduceerde) en **"Resolve in next release"**-koppeling.

## 2. Auto-issue bij elke nieuwe bug (alert rule)

1. Sentry → **Alerts → Create Alert → Issues** (issue alert, niet metric).
2. **When**: `A new issue is created`.
   - (Optioneel rustiger: `The issue is seen more than 1 times in 1h` of
     `…affects more than N users` — voorkomt issues voor eenmalige ruis.)
3. **Then (action)**: `Create a new GitHub issue` →
   - Integration: GitHub (KDMN76/talentflow)
   - Repo: `talentflow`
   - Assignee: (optioneel, bv. jezelf)
   - Labels: `bug`, `sentry`
4. **Environment**: `production` (zo krijg je geen issues van lokale/dev-fouten).
5. Opslaan. Vanaf nu → nieuwe prod-fout = automatisch een GitHub-issue.

> Tip: maak twee aparte rules — één voor de **API** (project `talentflow-api`,
> DSN `SENTRY_DSN_API`) en één voor de **web**-app (project met
> `NEXT_PUBLIC_SENTRY_DSN`). Elk project heeft zijn eigen alerts.

## 3. Automatisch sluiten bij een fix (close the loop)

Omdat GitHub gekoppeld is, leest Sentry je commits. In je fix-commit of PR:

```
Fixes <SENTRY-SHORT-ID>      # bv. Fixes TALENTFLOW-API-1A
```

De short-id staat bovenaan elke Sentry-issue. Bij merge naar de default branch
markeert Sentry de issue als **resolved**; komt de fout terug, dan heropent Sentry
'm automatisch (regression) → nieuw GitHub-issue via de rule uit stap 2.

Andersom: sluit je het GitHub-issue, dan kun je in Sentry de issue handmatig op
**Resolved** zetten (of de twee gekoppeld houden via de issue-link die Sentry in de
GitHub-issue plaatst).

## 4. Labels (eenmalig in GitHub)

Maak in `KDMN76/talentflow` de labels die de alert-rule gebruikt, zodat ze netjes
kleuren:

```bash
gh label create sentry --color B91C1C --description "Automatisch uit Sentry" --repo KDMN76/talentflow
# 'bug' bestaat meestal al als default-label
```

## 5. (Optioneel) zwaardere variant — volledig in eigen beheer

Wil je het niet via het dashboard maar volledig in code (geen Sentry-GitHub-app):
Sentry alert-actie `Send a notification via webhook` → een endpoint in de API
(`POST /api/integrations/sentry/webhook`) dat met een GitHub-PAT zelf een issue
aanmaakt. Vergt: een `GITHUB_TOKEN` (scope `repo`/`issues`) in de prod-env + een
Sentry-webhook-secret. Dupliceert wat de native koppeling gratis doet, dus alleen
nuttig als je geen GitHub-app wilt installeren. Zeg het als je deze wilt — dan bouw
ik het endpoint.

---

**Status**: native koppeling aanbevolen + hierboven gedocumenteerd. De
dashboard-stappen (1+2) moet je met je eigen Sentry-/GitHub-admin uitvoeren; de
rest (commit-conventie, labels) staat klaar.

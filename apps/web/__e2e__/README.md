# Web E2E tests (Playwright)

End-to-end smoke tests for de TalentFlow Next.js app. Tests draaien tegen de
dev-server in **mock-mode** (`NEXT_PUBLIC_USE_MOCK_DATA=true`) zodat we geen
draaiende API of DB nodig hebben.

## Eerste setup (eenmalig)

```bash
cd apps/web
npx playwright install chromium
```

Playwright downloadt automatisch de chromium-browser-binary. Op CI installeer
je via `npx playwright install --with-deps chromium`.

## Lokaal draaien

```bash
cd apps/web
npm run test:e2e          # headless run
npm run test:e2e:ui       # met Playwright UI (debugging + time-travel)
```

`playwright.config.ts` start zelf een dev-server op poort 3000. Als je al een
`npm run dev` open hebt staan wordt die hergebruikt
(`reuseExistingServer: !process.env.CI`).

## Authenticatie

Beschermde routes (alles onder `(dashboard)`) checken voor een token in
`sessionStorage.tf_token`. De helper in `__e2e__/helpers.ts` zet dit token
voor elke pagina-load via `page.addInitScript()` zodat tests direct op
`/dashboard`, `/candidates`, etc. kunnen landen zonder echte login.

```ts
import { authenticate } from './helpers';

test.beforeEach(async ({ page }) => {
  await authenticate(page);
});
```

In mock-mode zou `isMockMode()` op `true` staan en de auth-check overgeslagen
worden — maar we zetten het token alsnog expliciet voor de tests die
production-paden raken (de auth.spec test bijvoorbeeld checkt het redirect-
gedrag van de login-form zelf).

## Specs

| Spec                        | Wat het test                                    |
|-----------------------------|-------------------------------------------------|
| `auth.spec.ts`              | Login pagina rendert, validatie, mock-redirect  |
| `candidates.spec.ts`        | Lijst rendert, navigatie naar detail werkt      |
| `pipeline.spec.ts`          | Pipeline index + kanban kolom-rendering         |
| `workflows.spec.ts`         | Workflows pagina + create-dialog                |
| `email-templates.spec.ts`   | Email-templates pagina + 4 categorieën + editor |

## Tests die conditioneel skippen

Sommige tests `test.skip()`-en wanneer de mock-data variant niet de
benodigde rij oplevert (bv. geen kandidaten in het lijst-scherm). Dit
voorkomt false negatives op smoke-runs. Bij een rode test in CI: bekijk de
trace + screenshot in het HTML-rapport.

## Output / artifacts

* `playwright-report/` — HTML-rapport (open `index.html`)
* `test-results/` — traces + video's bij failures

## Nieuwe tests toevoegen

1. Maak `__e2e__/<feature>.spec.ts`
2. Importeer `authenticate` voor protected routes:
   ```ts
   import { authenticate } from './helpers';

   test.beforeEach(async ({ page }) => {
     await authenticate(page);
   });
   ```
3. Gebruik `getByRole`, `getByLabel` of `getByText` boven raw CSS-selectors
   voor weerbaarheid tegen styling-changes.
4. Houd selectors **Nederlandstalig** — de UI is Nederlands en moet zo
   blijven.

## Troubleshooting

* **`Error: browserType.launch: Executable doesn't exist`** — run
  `npx playwright install chromium`.
* **`webServer.command failed`** — check dat `npm run dev` lokaal werkt
  zonder errors. Mock-mode vereist alleen `NEXT_PUBLIC_USE_MOCK_DATA=true`,
  geen API.
* **Vlakke tijden / slow tests** — verhoog de globale `timeout` in
  `playwright.config.ts` tijdelijk; CI kan trager zijn dan lokaal.

# API unit tests

Vitest-based unit tests for the TalentFlow API service layer.

## Lokaal draaien

```bash
cd apps/api
npm test                  # eenmalige run
npm run test:watch        # watch-mode tijdens development
npm run test:coverage     # met v8 coverage rapport (HTML in ./coverage/)
```

De tests draaien volledig **offline**:

* Geen Postgres nodig — `pg.Pool` wordt vervangen door een mock in
  `__tests__/setup.ts`.
* Geen Redis nodig — `bullmq.Queue` en `ioredis` worden gemockt.
* Geen externe API calls — Anthropic, OpenAI en Resend SDKs zijn vervangen
  door dummy classes.

## Mock-strategie

`__tests__/setup.ts` zet de globale mocks zodat het importeren van
service-modules nooit een echte connectie probeert te openen.

Voor DB-gedrag in individuele tests gebruik je de helper in
`__tests__/helpers/dbMock.ts`:

```ts
import { mockClient, installPoolMock } from './helpers/dbMock';

const client = mockClient({
  __matcher: (sql, params) => {
    if (/INSERT INTO candidates/i.test(sql)) {
      return { rows: [{ id: 'c1' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  },
});

const teardown = installPoolMock(client);
// ... run service code ...
teardown();
```

Drie soorten matchers:

1. **Table-keyed**: `mockClient({ candidates: [...rows] })` — match op
   eerste `FROM/INTO/UPDATE <tabel>` in de query.
2. **Sequence**: `mockClient({ __sequence: [resp1, resp2, ...] })` — voor
   tests waar de query-volgorde belangrijk is.
3. **Custom matcher**: `mockClient({ __matcher: (sql, params) => ... })` —
   volledig in eigen handen.

## Nieuwe tests toevoegen

1. Maak `__tests__/<naam>.test.ts` (of `__tests__/lib/<naam>.test.ts` voor
   pure library-modules).
2. Mock module-level dependencies *vóór* de import van de service onder test:

   ```ts
   vi.mock('../src/modules/workflows/workflowEmitter', () => ({
     emitWorkflowEvent: vi.fn(async () => undefined),
   }));
   import { createCandidate } from '../src/modules/candidates/candidates.service';
   ```

3. Gebruik `mockClient` + `installPoolMock` voor DB-interactie.
4. Test pure helpers (zoals `generateCandidateReference`,
   `formatVectorLiteral`) zonder DB-mock — directe import + assertions.

## Tests voor exports en bulk-actions (Q1.2)

`exports.service.test.ts` en `bulkActions.test.ts` volgen exact dezelfde
mockconventies als de service tests, met twee aandachtspunten:

1. **Mock de list-services**, niet alleen de DB. De export-service delegate
   naar `candidatesService.listCandidates`, `jobsService.listJobs`, etc.
   Test je het CSV-renderpad, mock dan de list-service zelf met
   `vi.mock('../src/modules/candidates/candidates.service', ...)`. Test je
   het audit-pad, gebruik dan `installPoolMock` om de `INSERT INTO
   audit_events` op te vangen.
2. **Controller-laag testen zonder Express-server.** Bouw een simpele
   `makeReqRes(body)` helper die een nep-Request + Response opzet (zie
   `bulkActions.test.ts`). Roep de handler direct aan; verifieer dat
   `next` niet is aangeroepen bij happy path én dat `res.json` met de
   juiste body wordt aangeroepen.

Edge-cases die altijd in een nieuwe export-test horen:

* **CSV-escape voor `,`, `"`, `\n`, `\r`** — gebruik `escapeCsvField` direct.
* **UTF-8 BOM aanwezig** — `expect(csv.charCodeAt(0)).toBe(0xfeff)`.
* **Lege resultset** — header-only CSV + audit-rij wordt nog steeds geschreven.
* **Kolomselectie** — `columns: ['name', 'email']` filtert de header line.
* **xlsx → 501** — MVP ondersteunt alleen CSV.

Voor bulk-actions test je per action-type één happy path + één
foutafhandelingspad (ontbrekende payload, te grote batch, invalide UUID).
RLS-isolatie verifieer je door te checken dat `tenant_id` als WHERE-clause
in de UPDATE staat (`expect(updateSql).toMatch(/tenant_id\s*=\s*\$/);`).

## Coverage thresholds

Vitest faalt automatisch als coverage onder deze grenzen valt:

| Metric     | Threshold |
|------------|-----------|
| Lines      | 60%       |
| Branches   | 50%       |
| Functions  | 60%       |
| Statements | 60%       |

Workers (`src/queue/workers/**`), migrations en de bootstrap
(`src/index.ts`) zijn uitgesloten — die test je via integration tests.

## Conventies

* Eén `describe` per service of pure-helper file.
* Eén `it` per gedragsspecificatie. Houd ze klein en lees ze als
  documentatie van het contract.
* Reset mocks in `beforeEach` met `vi.clearAllMocks()`. Tear down
  pool-overrides in `afterEach`.
* Vermijd snapshot-tests behalve voor stabiele constants (bijv.
  `AI_MATCH_DISCLOSURE_NL`) — anders breken UI-tweaks tests.

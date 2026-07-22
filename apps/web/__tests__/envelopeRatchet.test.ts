/**
 * Envelope-ratchet — bewaakt bugklasse 1 uit de systeem-audit van 2026-07-22:
 * contract-drift tussen web en api doordat axios-calls hand-getypeerd werden
 * tegen een AANNAME over de response-vorm (`api.get<Contract>(...)`) in
 * plaats van de response door `unwrapData`/`unwrapList` (lib/apiEnvelope.ts)
 * te halen. Die aannames bleken structureel fout (15+ hooks kregen de
 * `{ data: ... }`-envelope in plaats van het object) — zie de audit-commit
 * 02d3ddd.
 *
 * CONVENTIE voor alle NIEUWE code:
 *
 *   const { data } = await api.get<unknown>("/things/1");
 *   return unwrapData<Thing>(data);          // of unwrapList<Thing>(data)
 *
 * Dus: generic ALTIJD `unknown`, envelope ALTIJD via de helpers uitpakken.
 *
 * De 284 bestaande getypeerde calls (baseline-snapshot 2026-07-22) zijn
 * bevroren in envelopeRatchet.baseline.json — die worden stap voor stap
 * afgebouwd. Deze test faalt zodra een bestand er getypeerde calls BIJ
 * krijgt, of zodra een nieuw bestand er ook maar één introduceert.
 *
 * Baseline verlagen (na het ombouwen van calls in een bestand): draai de
 * test; de melding onderaan toont welke entries omlaag kunnen. Baseline
 * verhogen is per definitie fout — bouw de call om naar unwrapData/unwrapList.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import baselineJson from './envelopeRatchet.baseline.json';

const WEB_ROOT = join(__dirname, '..');
const SCAN_DIRS = ['hooks', 'lib', 'components', 'app'];
const TYPED_CALL = /\bapi\.(get|post|patch|put|delete)\s*<(?!unknown\b)/g;

const baseline: Record<string, number> = baselineJson;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
      yield full;
    }
  }
}

function scan(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(WEB_ROOT, dir))) {
      const source = readFileSync(file, 'utf-8');
      const matches = source.match(TYPED_CALL);
      if (matches?.length) {
        const rel = relative(WEB_ROOT, file).replace(/\\/g, '/');
        counts[rel] = matches.length;
      }
    }
  }
  return counts;
}

describe('envelope-ratchet — geen nieuwe hand-getypeerde api-calls', () => {
  const current = scan();

  it('geen enkel bestand overschrijdt zijn baseline (nieuwe calls: gebruik api.<m><unknown> + unwrapData/unwrapList)', () => {
    const regressions: string[] = [];
    for (const [file, count] of Object.entries(current)) {
      const allowed = baseline[file] ?? 0;
      if (count > allowed) {
        regressions.push(
          `${file}: ${count} getypeerde api-calls (baseline: ${allowed}). ` +
            `Nieuwe calls moeten api.<methode><unknown> zijn met unwrapData/unwrapList uit lib/apiEnvelope.ts.`
        );
      }
    }
    expect(regressions, regressions.join('\n')).toEqual([]);
  });

  it('baseline bevat geen stale entries (bestand verwijderd of al omgebouwd → baseline verlagen)', () => {
    // Informatief, niet blokkerend voor lagere counts: een LAGERE count dan
    // baseline is vooruitgang. We flaggen alleen entries waarvan het bestand
    // helemaal geen treffers (of geen bestand) meer heeft, zodat de baseline
    // niet vervuilt — die entries kunnen er dan echt uit.
    const stale = Object.keys(baseline).filter((file) => !(file in current));
    expect(
      stale,
      `Deze baseline-entries zijn opgeruimd — verwijder ze uit envelopeRatchet.baseline.json:\n${stale.join('\n')}`
    ).toEqual([]);
  });
});

/**
 * bucketFor — dag-grens in Europe/Amsterdam, niet server-UTC.
 *
 * De HM-scorecard-deadlines worden in buckets (overdue/today/this_week/later)
 * ingedeeld. De grens "vandaag" moet in Amsterdamse tijd worden bepaald: een
 * deadline vlak na middernacht Amsterdam-tijd (bv. 23:30Z = 00:30 CET) hoort
 * niet meer bij "vandaag" van de vorige UTC-dag.
 *
 * Vaste timestamps → verwachte buckets, inclusief winter (CET, +1) en zomer
 * (CEST, +2) zodat de DST-afhandeling bewezen is.
 */

import { describe, it, expect } from 'vitest';
import { bucketFor } from '../../src/modules/hm/hm.service';

describe('hm.service.bucketFor — Europe/Amsterdam dag-grens', () => {
  it('overdue: due vóór now', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    const due = new Date('2026-01-15T11:00:00.000Z');
    expect(bucketFor(due, now)).toBe('overdue');
  });

  it('winter (CET +1): 23:30Z hoort al bij de VOLGENDE Amsterdamse dag', () => {
    // now = 2026-01-15T23:30Z = 2026-01-16 00:30 CET → Amsterdamse dag = 16 jan.
    const now = new Date('2026-01-15T23:30:00.000Z');
    // Einde Amsterdamse dag 16 jan = 2026-01-16T23:59:59.999+01:00 = 22:59:59.999Z.
    // due 20:00Z (16 jan) valt daar ruim vóór → 'today'.
    const due = new Date('2026-01-16T20:00:00.000Z');
    expect(bucketFor(due, now)).toBe('today');
    // Met de oude UTC-logica (einde = 2026-01-15T23:59:59.999Z) was dit 'this_week'.
  });

  it('winter: due nét ná einde Amsterdamse dag → this_week', () => {
    const now = new Date('2026-01-15T23:30:00.000Z');
    // 23:30Z op 16 jan = 00:30 CET op 17 jan → voorbij einde van dag 16.
    const due = new Date('2026-01-16T23:30:00.000Z');
    expect(bucketFor(due, now)).toBe('this_week');
  });

  it('zomer (CEST +2): 23:30Z hoort al bij de VOLGENDE Amsterdamse dag', () => {
    // now = 2026-07-15T23:30Z = 2026-07-16 01:30 CEST → Amsterdamse dag = 16 jul.
    const now = new Date('2026-07-15T23:30:00.000Z');
    // Einde Amsterdamse dag 16 jul = 2026-07-16T23:59:59.999+02:00 = 21:59:59.999Z.
    // due 21:00Z (16 jul) valt daar vóór → 'today'.
    const due = new Date('2026-07-16T21:00:00.000Z');
    expect(bucketFor(due, now)).toBe('today');
  });

  it('this_week: enkele dagen vooruit, buiten vandaag', () => {
    const now = new Date('2026-01-15T10:00:00.000Z');
    const due = new Date('2026-01-18T10:00:00.000Z'); // +3 dagen
    expect(bucketFor(due, now)).toBe('this_week');
  });

  it('later: meer dan 7 dagen vooruit', () => {
    const now = new Date('2026-01-15T10:00:00.000Z');
    const due = new Date('2026-01-25T10:00:00.000Z'); // +10 dagen
    expect(bucketFor(due, now)).toBe('later');
  });
});

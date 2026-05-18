import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { assertResponse } from '@talentflow/contracts';

/**
 * Het JSON-roundtrip-gedrag in `assertResponse()` is INTENTIONAL. Deze tests
 * borgen het patroon zodat een latere lezer (of refactor) hem niet weghaalt
 * met "deze stringify lijkt overbodig".
 *
 * Achtergrond: pg-driver retourneert `timestamptz` / `date` kolommen als
 * JavaScript `Date` objects. Express's `res.json()` serializeert ze
 * automatisch via `Date.prototype.toJSON()` naar ISO-strings. `assertResponse`
 * draait DAARVOOR — zonder roundtrip zou hij Date-objecten zien waar het
 * schema `z.string().datetime()` verwacht. De roundtrip dwingt dezelfde
 * shape af die de client uiteindelijk krijgt.
 *
 * Bug-incident: 2026-05-18 — Sub-fase 2C smoke-test faalde op `GET /api/jobs`
 * met "Expected string, received date" omdat de validator de raw DB-output
 * zag i.p.v. de gestringificeerde respons.
 */

describe('assertResponse — JSON roundtrip is intentional', () => {
  // Tests draaien onder NODE_ENV=test (Vitest standaard) → roundtrip ACTIEF.
  // De productie-skip (NODE_ENV=production) wordt separaat gecheckt.

  it('accepteert Date-instances waar schema z.string().datetime() verwacht', () => {
    const schema = z.object({
      id: z.string().uuid(),
      created_at: z.string().datetime({ offset: true }),
    });

    const rawFromDb = {
      id: '11111111-1111-1111-1111-111111111111',
      created_at: new Date('2026-05-18T08:30:00.000Z'), // Date-instance, geen string
    };

    // Zonder roundtrip: ZodError "Expected string, received date".
    // Met roundtrip: Date → toJSON() → ISO-string → parse OK.
    const result = assertResponse(schema, rawFromDb);

    expect(typeof result.created_at).toBe('string');
    expect(result.created_at).toBe('2026-05-18T08:30:00.000Z');
  });

  it('accepteert geneste Date-velden in arrays (lijst-response-shape)', () => {
    const schema = z.array(
      z.object({
        title: z.string(),
        created_at: z.string().datetime({ offset: true }),
        updated_at: z.string().datetime({ offset: true }),
      })
    );

    const rawListFromDb = [
      {
        title: 'Job 1',
        created_at: new Date('2026-05-18T08:00:00.000Z'),
        updated_at: new Date('2026-05-18T08:05:00.000Z'),
      },
      {
        title: 'Job 2',
        created_at: new Date('2026-05-17T12:00:00.000Z'),
        updated_at: new Date('2026-05-17T12:00:00.000Z'),
      },
    ];

    const result = assertResponse(schema, rawListFromDb);

    expect(result).toHaveLength(2);
    expect(result[0].created_at).toBe('2026-05-18T08:00:00.000Z');
    expect(result[1].updated_at).toBe('2026-05-17T12:00:00.000Z');
  });

  it('blijft fail-fast bij ECHTE schema-mismatch (geen ontsnapping)', () => {
    // Bewijs dat de roundtrip niet "te tolerant" is — onverwachte velden
    // of verkeerde types worden nog steeds afgewezen.
    const schema = z.object({
      status: z.enum(['ok', 'fail']),
    });

    expect(() => assertResponse(schema, { status: 'broken' })).toThrowError();
  });

  it('past de roundtrip ook toe op velden die GEEN Date zijn (idempotent)', () => {
    const schema = z.object({
      n: z.number(),
      s: z.string(),
      b: z.boolean(),
      arr: z.array(z.string()),
      nested: z.object({ x: z.number() }),
      nullable: z.string().nullable(),
    });

    const data = {
      n: 42,
      s: 'hello',
      b: true,
      arr: ['a', 'b'],
      nested: { x: 1 },
      nullable: null,
    };

    expect(assertResponse(schema, data)).toEqual(data);
  });

  it('PRODUCTIE-MODE: schema.parse() wordt overgeslagen (no-op return)', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const schema = z.object({ x: z.number() });
      // Verkeerde data — als parse zou draaien gooit het.
      const garbage = { x: 'not-a-number', extra_field: true } as unknown;
      const result = assertResponse(schema, garbage);
      // No-op: zelfde referentie terug, geen validatie.
      expect(result).toBe(garbage);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});

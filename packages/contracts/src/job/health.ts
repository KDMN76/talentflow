/**
 * Job health-breakdown contract — GET /api/jobs/:id/health.
 *
 * Single source of truth voor de health-score response. Vóór dit schema
 * retourneerde de backend een platte shape (`{ health_score, velocity_score,
 * drop_off_score, recency_score, weights }`) terwijl de frontend
 * `{ score, components: [...] }` verwachtte en `health.components.map(...)`
 * deed → witte-pagina-crash op `/jobs/[id]` (ROADMAP Sectie 1, "Vacature-detail
 * pagina crasht"). Dit schema dwingt de UI-ready shape af aan beide kanten.
 *
 * De `components`-array is de UI-ready ontleding van de score: elke sub-score
 * (velocity/drop_off/recency) komt mét label + uitleg mee zodat de frontend
 * de breakdown-balken direct kan renderen zonder eigen lookup-tabel.
 */

import { z } from "zod";

/** Stabiele sleutels voor de sub-scores; UI mapt hierop voor styling/iconen. */
export const JOB_HEALTH_COMPONENT_KEYS = [
  "velocity",
  "drop_off",
  "recency",
] as const;

const scoreField = z
  .number()
  .int({ message: "score moet integer zijn" })
  .min(0)
  .max(100);

export const JobHealthComponentSchema = z
  .object({
    /** Interne sleutel — UI gebruikt dit voor labels/styling. */
    key: z.enum(JOB_HEALTH_COMPONENT_KEYS),
    /** NL-label, server-geleverd zodat de UI dom blijft. */
    label: z.string().min(1),
    /** 0..100 — al genormaliseerd zodat de balk direct rendert. */
    score: scoreField,
    /** Korte NL-uitleg voor tooltip/beschrijving. */
    description: z.string().min(1),
  })
  .strict();

export type JobHealthComponent = z.infer<typeof JobHealthComponentSchema>;

export const JobHealthSchema = z
  .object({
    job_id: z.string().uuid(),
    /** Gewogen aggregaat 0..100. */
    score: scoreField,
    /** Ontleding van de score in sub-scores (velocity/drop_off/recency). */
    components: z.array(JobHealthComponentSchema),
    /** ISO-datum (yyyy-mm-dd) — server-voorspelde sluitingsdatum, of null. */
    predicted_close_date: z.string().nullable(),
    /** Aantal dagen dat de vacature open staat. */
    days_open: z.number().int().nonnegative(),
    /** Totaal aantal sollicitaties. */
    candidates_total: z.number().int().nonnegative(),
    /** Sollicitaties nog in de funnel (niet afgewezen). */
    candidates_in_funnel: z.number().int().nonnegative(),
    /** ISO-8601 timestamp van berekening. */
    computed_at: z.string().datetime({ offset: true }),
    /** Gewichten per sub-score, voor transparantie in tooltips. */
    weights: z
      .object({
        velocity: z.number(),
        drop_off: z.number(),
        recency: z.number(),
      })
      .strict(),
  })
  .strict();

export type JobHealth = z.infer<typeof JobHealthSchema>;

import type { ZodTypeAny, z } from "zod";

/**
 * Dev/test-mode response-guard.
 *
 * Pakt het binnenkomende response-object en parset het tegen het schema —
 * **alleen** wanneer `NODE_ENV !== 'production'`. In productie is dit een
 * no-op (return as-is) zodat we geen CPU-cycles uitgeven aan validatie van
 * eigen-getypeerd data dat door tests al gedekt is.
 *
 * Bij mismatch in dev/test gooit Zod een rijke `ZodError` met `issues[]`
 * zodat de fout direct in logs en testruns zichtbaar is — zonder dat we
 * de end-user response wijzigen.
 *
 * Gebruikspatroon in Express controllers:
 *
 *   const data = await jobsService.listJobs(...);
 *   res.json(assertResponse(z.array(JobListItemSchema), data));
 */
export function assertResponse<S extends ZodTypeAny>(
  schema: S,
  data: unknown
): z.infer<S> {
  if (process.env.NODE_ENV === "production") {
    return data as z.infer<S>;
  }
  return schema.parse(data);
}

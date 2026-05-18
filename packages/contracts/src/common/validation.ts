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
 *
 * --- JSON-roundtrip is INTENTIONAL — niet verwijderen ---
 *
 * Schemas beschrijven wat de **client** uiteindelijk ontvangt: bv.
 * `created_at: z.string().datetime()`. De pg-driver retourneert echter
 * `timestamptz` / `date` kolommen als JavaScript `Date` objects, NIET als
 * strings. Express's `res.json()` serializeert die later via
 * `Date.prototype.toJSON()` naar ISO-strings — maar `assertResponse` draait
 * VÓÓR die serialisatie.
 *
 * Door eerst `JSON.parse(JSON.stringify(data))` te doen, valideren we
 * exact dezelfde shape die de client krijgt. Zonder roundtrip zou elke
 * GET-endpoint met timestamps in dev/test falen op `expected: "string",
 * received: "date"` — een vals positief.
 *
 * De roundtrip-kost (~ms voor een lijst van honderden rijen) is alleen in
 * dev/test actief. Productie is no-op.
 */
export function assertResponse<S extends ZodTypeAny>(
  schema: S,
  data: unknown
): z.infer<S> {
  if (process.env.NODE_ENV === "production") {
    return data as z.infer<S>;
  }
  // Roundtrip via JSON om te matchen wat de client daadwerkelijk ontvangt
  // (Date → ISO-string via Date.prototype.toJSON). Zie comment hierboven.
  return schema.parse(JSON.parse(JSON.stringify(data)));
}

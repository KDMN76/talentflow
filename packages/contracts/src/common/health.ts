import { z } from "zod";

/**
 * Health-check contract — proof-of-concept voor de shared contracts laag
 * (Sub-fase 2A). Wordt door zowel `apps/api` (response shape van
 * `GET /api/health`) als `apps/web` (runtime response-validatie) gebruikt
 * om te bewijzen dat één Zod-schema beide kanten van de wire kan dekken.
 *
 * Doelbewust niet-triviaal: enum, datetime-string, niet-negatieve integer —
 * voldoende dynamic range om te demonstreren dat verkeerde response-shapes
 * (bv. `status: "broken"`) fail-fast worden afgewezen.
 */
export const HealthCheckSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  timestamp: z.string().datetime({
    message: "timestamp moet ISO 8601 zijn met expliciete timezone (Z of ±hh:mm)",
  }),
  uptime_seconds: z
    .number()
    .int({ message: "uptime_seconds moet integer zijn" })
    .nonnegative({ message: "uptime_seconds mag niet negatief zijn" }),
});

export type HealthCheck = z.infer<typeof HealthCheckSchema>;

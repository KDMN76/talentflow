"use client";

/**
 * Sub-fase 2A — proof-of-concept hook die het shared HealthCheckSchema uit
 * `@talentflow/contracts` runtime-valideert tegen de API-response.
 *
 * Doel: bewijzen dat één Zod-schema beide kanten van de wire dekt. Bij
 * drift (backend geeft `status: "broken"` of vergeet `uptime_seconds`)
 * gooit `parse()` synchroon en wordt de fout zichtbaar in React Query's
 * `error` state ipv stilletjes door te renderen.
 *
 * Wordt nog niet door een production-pagina aangeroepen — pure PoC voor de
 * contracts-laag. Sub-fase 2B/2C maakt dit het standaard-patroon voor alle
 * hooks.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { HealthCheckSchema, type HealthCheck } from "@talentflow/contracts";

export function useHealthCheck() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async (): Promise<HealthCheck> => {
      const { data } = await api.get<unknown>("/health");
      // Fail-fast: bij elke afwijking van het contract gooit Zod een
      // ZodError met exacte path + reden. Geen silent passthrough.
      return HealthCheckSchema.parse(data);
    },
    staleTime: 60_000,
    retry: false,
  });
}

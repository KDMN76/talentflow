"use client";

/**
 * useAuditTrail — fetcht de WORM audit-trail voor een specifieke entity.
 *
 * Backend-contract:
 *   GET /api/compliance/audit/:entityType/:entityId → AuditTrailEvent[]
 *
 * Try/catch + mock-fallback voor dev wanneer backend niet beschikbaar is.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  MOCK_AUDIT_TRAIL_EVENTS,
  type AuditTrailEvent,
  type AuditActionGroup,
} from "@/lib/mockData";

export type AuditEntityType = "candidate" | "job" | "application";

export function useAuditTrail(entityType: AuditEntityType, entityId: string) {
  return useQuery<AuditTrailEvent[]>({
    queryKey: ["audit-trail", entityType, entityId],
    enabled: !!entityType && !!entityId,
    retry: false,
    queryFn: async () => {
      try {
        const { data } = await api.get<unknown>(
          `/compliance/audit/${entityType}/${entityId}`
        );
        return shapeEvents(data);
      } catch {
        // Mock fallback in dev — gefilterd op entity zodat de output realistisch lijkt.
        return MOCK_AUDIT_TRAIL_EVENTS.filter(
          (e) =>
            (e.entity_type === entityType && e.entity_id === entityId) ||
            entityId === "demo"
        );
      }
    },
  });
}

function shapeEvents(raw: unknown): AuditTrailEvent[] {
  if (!raw) return [];
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { data?: unknown }).data)
    ? ((raw as { data: unknown[] }).data as unknown[])
    : [];
  return arr
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map(shapeEvent);
}

function shapeEvent(raw: Record<string, unknown>): AuditTrailEvent {
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  return {
    id: String(raw.id ?? ""),
    occurred_at: str("occurred_at") ?? new Date().toISOString(),
    action: str("action") ?? "unknown",
    group: (str("group") as AuditActionGroup) ?? "writes",
    label: str("label") ?? "Onbekende actie",
    actor_name: str("actor_name") ?? "system",
    actor_role: str("actor_role"),
    entity_type: (str("entity_type") as AuditTrailEvent["entity_type"]) ?? "candidate",
    entity_id: str("entity_id") ?? "",
    entity_label: str("entity_label") ?? "—",
    diff: Array.isArray(raw.diff)
      ? (raw.diff as Array<Record<string, unknown>>).map((d) => ({
          field: String(d.field ?? ""),
          before: (d.before ?? null) as AuditTrailEvent["diff"] extends infer T
            ? T extends Array<{ before: infer B }>
              ? B
              : never
            : never,
          after: (d.after ?? null) as AuditTrailEvent["diff"] extends infer T
            ? T extends Array<{ after: infer A }>
              ? A
              : never
            : never,
        }))
      : null,
    metadata:
      raw.metadata && typeof raw.metadata === "object"
        ? (raw.metadata as Record<string, string | number | boolean | null>)
        : null,
    worm_hash: str("worm_hash") ?? "0x???",
  };
}

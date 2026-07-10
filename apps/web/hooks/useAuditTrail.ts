"use client";

/**
 * useAuditTrail — fetcht de WORM audit-trail voor een specifieke entity.
 *
 * Backend-contract:
 *   GET /api/compliance/audit-events/entity/:entityType/:entityId
 *     → { data: AuditEventRow[] }
 *
 * De API levert een platte rij-shape (created_at / user_name / before / after /
 * diff_summary). De trail-viewer verwacht de rijkere `AuditTrailEvent`-shape
 * (occurred_at / group / label / diff[] / worm_hash). We normaliseren hier
 * defensief zodat de pagina nooit crasht op ontbrekende velden of lege data.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
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
      const { data } = await api.get<unknown>(
        `/compliance/audit-events/entity/${entityType}/${entityId}`
      );
      return shapeEvents(data);
    },
  });
}

function shapeEvents(raw: unknown): AuditTrailEvent[] {
  if (!raw) return [];
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "object" &&
        raw !== null &&
        Array.isArray((raw as { data?: unknown }).data)
      ? ((raw as { data: unknown[] }).data as unknown[])
      : [];
  return arr
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map(shapeEvent);
}

/** Leidt de UI-groep af uit de stable action-key. */
function deriveGroup(action: string): AuditActionGroup {
  const a = (action ?? "").toLowerCase();
  if (a.includes("consent")) return "consent";
  if (a.includes("export") || a.includes("download")) return "exports";
  if (
    a.includes("ai") ||
    a.includes("match") ||
    a.includes("score") ||
    a.includes("talent_fit") ||
    a.includes("embedding")
  )
    return "ai";
  if (
    a.includes("email") ||
    a.includes("whatsapp") ||
    a.includes("sms") ||
    a.includes("communication") ||
    a.includes("message") ||
    a.includes("call")
  )
    return "communications";
  if (a.includes("view") || a.includes("access") || a.includes("read"))
    return "access";
  return "writes";
}

function humanize(action: string): string {
  if (!action) return "Onbekende actie";
  return action
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type DiffValue = string | number | boolean | null;

function coerce(value: unknown): DiffValue {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Bouwt een veld-diff uit before/after-objecten (alleen gewijzigde velden). */
function buildDiff(
  before: unknown,
  after: unknown
): AuditTrailEvent["diff"] {
  const b =
    before && typeof before === "object"
      ? (before as Record<string, unknown>)
      : null;
  const a =
    after && typeof after === "object"
      ? (after as Record<string, unknown>)
      : null;
  if (!b && !a) return null;
  const keys = Array.from(
    new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])
  );
  const rows = keys
    .map((field) => ({
      field,
      before: coerce(b?.[field]),
      after: coerce(a?.[field]),
    }))
    .filter(
      (row) => JSON.stringify(row.before) !== JSON.stringify(row.after)
    );
  return rows.length > 0 ? rows : null;
}

function shapeEvent(raw: Record<string, unknown>): AuditTrailEvent {
  const str = (k: string) =>
    typeof raw[k] === "string" ? (raw[k] as string) : null;
  const action = str("action") ?? "unknown";
  return {
    id: String(raw.id ?? ""),
    occurred_at:
      str("occurred_at") ?? str("created_at") ?? new Date().toISOString(),
    action,
    group: (str("group") as AuditActionGroup) ?? deriveGroup(action),
    label: str("label") ?? str("diff_summary") ?? humanize(action),
    actor_name: str("actor_name") ?? str("user_name") ?? "systeem",
    actor_role: str("actor_role"),
    entity_type:
      (str("entity_type") as AuditTrailEvent["entity_type"]) ?? "candidate",
    entity_id: str("entity_id") ?? "",
    entity_label:
      str("entity_label") ?? str("related_entity_name") ?? "—",
    diff: buildDiff(raw.before, raw.after),
    metadata:
      raw.metadata && typeof raw.metadata === "object"
        ? (raw.metadata as Record<string, string | number | boolean | null>)
        : null,
    worm_hash: str("worm_hash") ?? str("request_id") ?? "—",
  };
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface ActivityItem {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  /** Voor 'application'-activiteiten: de kandidaat/vacature via LEFT JOIN,
   *  zodat de regel deep-gelinkt kan worden (de application zelf heeft geen
   *  eigen pagina). Null voor andere entity-types. */
  app_candidate_id?: string | null;
  app_job_id?: string | null;
}

export interface ActivityPage {
  data: ActivityItem[];
  meta: { total: number; page: number; limit: number; pages: number };
}

/** Filters voor het activiteitenlog (persoon/pagina/actie/datum). */
export interface ActivityFilters {
  userId?: string;
  entityType?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
}

function toParams(f: ActivityFilters): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.userId) p.user_id = f.userId;
  if (f.entityType) p.entity_type = f.entityType;
  if (f.action) p.action = f.action;
  if (f.dateFrom) p.date_from = f.dateFrom;
  if (f.dateTo) p.date_to = f.dateTo;
  return p;
}

/** Paginated volledige activiteitenfeed (GET /dashboard/activity), gefilterd. */
export function useActivityLog(page: number, limit = 25, filters: ActivityFilters = {}) {
  const filterParams = toParams(filters);
  return useQuery<ActivityPage>({
    queryKey: ["activity-log", page, limit, filterParams],
    queryFn: async () => {
      const { data } = await api.get<ActivityPage>("/dashboard/activity", {
        params: { page, limit, ...filterParams },
      });
      return data;
    },
  });
}

/** Velden die `activityHref` nodig heeft — zo werkt hij voor zowel de
 *  volledige ActivityItem als het compactere dashboard-widget-item. */
type LinkableActivity = Pick<
  ActivityItem,
  "entity_type" | "entity_id" | "app_candidate_id" | "app_job_id"
>;

/**
 * Bepaalt waar een activiteitregel naartoe linkt. Kandidaat/vacature linken
 * direct; 'application'-activiteiten (bv. stage_change) via de bijbehorende
 * kandidaat/vacature (LEFT JOIN in de backend). Geen doel → null (niet klikbaar).
 */
export function activityHref(item: LinkableActivity): string | null {
  switch (item.entity_type) {
    case "candidate":
      return `/candidates/${item.entity_id}`;
    case "job":
      return `/jobs/${item.entity_id}`;
    case "application":
      if (item.app_candidate_id) return `/candidates/${item.app_candidate_id}`;
      if (item.app_job_id) return `/jobs/${item.app_job_id}`;
      return null;
    case "career_page":
      return `/career-pages/${item.entity_id}`;
    default:
      return null;
  }
}

/** Query-params helper voor de activity-export (zelfde filters als de lijst). */
export function activityExportParams(filters: ActivityFilters): Record<string, string> {
  return toParams(filters);
}

/**
 * Bouwt een leesbare feed-regel: "{werkwoord}: {objectnaam}" i.p.v. het kale
 * verb (bv. 'created'/'resume_parsed'). De objectnaam komt uit de payload
 * (name/title — die de writers meesturen). Onbekende acties vallen terug op
 * het (vertaalde) verb, zodat er nooit een lege of ruwe regel is. Gedeeld door
 * de /activity-pagina én het dashboard-widget.
 */
export function activityLine(
  item: Pick<ActivityItem, "action" | "payload">,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  const pick = (k: string) =>
    typeof p[k] === "string" && p[k] ? (p[k] as string) : undefined;
  const objectName =
    pick("name") ??
    pick("title") ??
    pick("candidate_name") ??
    pick("job_title") ??
    null;
  const verb = t(`activityLog.action.${item.action}`, {
    defaultValue: item.action,
  });
  return objectName ? `${verb}: ${objectName}` : verb;
}

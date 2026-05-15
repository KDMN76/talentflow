/**
 * WORM audit-trail viewer — diepe entity-trail (Sprint Q2.3, Compliance).
 *
 * Doel: per kandidaat / job / sollicitatie een volledig chronologische, immutable
 * trail laten zien van álles wat er gebeurd is. Aanvullend op de basis-audit-tab
 * die Agent NN bouwt in /gdpr.
 *
 * Features:
 *   - Filter (collapsible groepen): writes / AI / consent / communications /
 *     access / exports
 *   - Diff-viewer per event: voor/na in 2 kolommen (custom — bewust geen lib
 *     omdat we geen line-based diff nodig hebben, alleen field-level voor/na).
 *   - "Per maand inzicht": collapsible buckets per YYYY-MM met counts.
 *   - Export-knop voor deze entity-trail naar PDF (placeholder — toast-only,
 *     real-pdf later via puppeteer worker in apps/api).
 */

"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  Filter,
  FileText,
  Mail,
  Pencil,
  Sparkles,
  ShieldCheck,
  Eye,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useAuditTrail,
  type AuditEntityType,
} from "@/hooks/useAuditTrail";
import type {
  AuditActionGroup,
  AuditTrailEvent,
} from "@/lib/mockData";

const AUDIT_GROUP_LABELS: Record<AuditActionGroup, string> = {
  writes: "Wijzigingen",
  ai: "AI-acties",
  consent: "Toestemmingen",
  communications: "Communicatie",
  access: "Toegang & inzage",
  exports: "Exports",
};

const ALL_GROUPS: AuditActionGroup[] = [
  "writes",
  "ai",
  "consent",
  "communications",
  "access",
  "exports",
];

const GROUP_ICON: Record<AuditActionGroup, React.ComponentType<{ className?: string }>> = {
  writes: Pencil,
  ai: Sparkles,
  consent: ShieldCheck,
  communications: Mail,
  access: Eye,
  exports: FileText,
};

const GROUP_TONE: Record<AuditActionGroup, string> = {
  writes: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300",
  ai: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300",
  consent: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300",
  communications: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300",
  access: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300",
  exports: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300",
};

const ENTITY_LABEL: Record<AuditEntityType, string> = {
  candidate: "Kandidaat",
  job: "Vacature",
  application: "Sollicitatie",
};

export default function AuditTrailViewerPage() {
  const params = useParams();
  const { toast } = useToast();

  const entityType = (params?.entityType as AuditEntityType) ?? "candidate";
  const entityId = (params?.entityId as string) ?? "";

  const { data: events, isLoading, isError, refetch } = useAuditTrail(
    entityType,
    entityId
  );

  const [activeGroups, setActiveGroups] = useState<Set<AuditActionGroup>>(
    new Set(ALL_GROUPS)
  );
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!events) return [];
    return events
      .filter((e) => activeGroups.has(e.group))
      .sort(
        (a, b) =>
          new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
      );
  }, [events, activeGroups]);

  const buckets = useMemo(() => groupByMonth(filtered), [filtered]);

  const groupCounts = useMemo(() => {
    const counts: Record<AuditActionGroup, number> = {
      writes: 0,
      ai: 0,
      consent: 0,
      communications: 0,
      access: 0,
      exports: 0,
    };
    (events ?? []).forEach((e) => {
      counts[e.group] = (counts[e.group] ?? 0) + 1;
    });
    return counts;
  }, [events]);

  const entityLabel = events?.[0]?.entity_label ?? entityId;

  const toggleGroup = (g: AuditActionGroup) => {
    setActiveGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const toggleEvent = (id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMonth = (key: string) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleExport = () => {
    toast({
      title: "PDF-export gestart",
      description:
        "Je audit-trail wordt voorbereid en binnen enkele minuten naar je e-mail verstuurd.",
    });
    // TODO: integreer met POST /compliance/audit/:type/:id/export.pdf
    // Voor nu: placeholder — backend-implementatie volgt later in Sprint Q2.3.
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Back + header */}
      <div className="flex items-center justify-between">
        <Link
          href={
            entityType === "candidate"
              ? `/candidates/${entityId}`
              : entityType === "job"
              ? `/jobs/${entityId}`
              : "/dashboard"
          }
          className="-ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Terug
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={!events || events.length === 0}
          className="h-8 gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          Export naar PDF
        </Button>
      </div>

      <header>
        <p className="text-[11px] font-medium uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          WORM Audit-trail · {ENTITY_LABEL[entityType]}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          {entityLabel}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Volledig chronologisch overzicht van alle wijzigingen, AI-acties,
          toestemmingen en communicatie. Write-once: events zijn onveranderlijk
          en gehasht voor tamper-detectie.
        </p>
      </header>

      {/* Filter bar */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            <Filter className="h-3.5 w-3.5" />
            Filter op type
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_GROUPS.map((g) => {
              const Icon = GROUP_ICON[g];
              const active = activeGroups.has(g);
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => toggleGroup(g)}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    active
                      ? GROUP_TONE[g]
                      : "border-zinc-200 bg-white text-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500",
                  ].join(" ")}
                  aria-pressed={active}
                >
                  <Icon className="h-3 w-3" />
                  {AUDIT_GROUP_LABELS[g]}
                  <span className="font-semibold">({groupCounts[g] ?? 0})</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Loading / error / empty states */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      )}
      {isError && (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-red-500" />
            <div className="flex-1 text-sm">
              <p className="font-medium">Audit-trail kon niet geladen worden</p>
              <p className="text-xs text-muted-foreground">
                Probeer het opnieuw of controleer of de backend bereikbaar is.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Opnieuw
            </Button>
          </CardContent>
        </Card>
      )}
      {!isLoading && !isError && filtered.length === 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Geen events voor deze filter-selectie.
          </CardContent>
        </Card>
      )}

      {/* Per-maand buckets */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {buckets.map((bucket) => {
            const collapsed = collapsedMonths.has(bucket.key);
            return (
              <Card key={bucket.key} className="border-0 shadow-sm">
                <CardContent className="p-0">
                  <button
                    type="button"
                    onClick={() => toggleMonth(bucket.key)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                  >
                    <div className="flex items-center gap-3">
                      {collapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {bucket.label}
                      </h3>
                      <Badge variant="secondary" className="text-[10px]">
                        {bucket.events.length}{" "}
                        {bucket.events.length === 1 ? "event" : "events"}
                      </Badge>
                    </div>
                  </button>

                  {!collapsed && (
                    <ol className="border-t border-zinc-100 dark:border-zinc-800">
                      {bucket.events.map((event) => (
                        <EventRow
                          key={event.id}
                          event={event}
                          expanded={expandedEvents.has(event.id)}
                          onToggle={() => toggleEvent(event.id)}
                        />
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Event-row + diff-viewer
// ───────────────────────────────────────────────────────────────────────────────

function EventRow({
  event,
  expanded,
  onToggle,
}: {
  event: AuditTrailEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = GROUP_ICON[event.group];
  const expandable =
    (event.diff && event.diff.length > 0) ||
    (event.metadata && Object.keys(event.metadata).length > 0);

  return (
    <li className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        className={[
          "flex w-full items-start gap-3 px-4 py-3 text-left",
          expandable ? "hover:bg-zinc-50 dark:hover:bg-zinc-900/40" : "cursor-default",
        ].join(" ")}
      >
        <span
          className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${GROUP_TONE[event.group]}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {event.label}
            </p>
            <span className="font-mono text-[10px] text-zinc-400">
              {event.action}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {event.actor_name}
            </span>
            {event.actor_role ? ` (${event.actor_role})` : ""}
            <span aria-hidden="true"> · </span>
            {formatNlDateTime(event.occurred_at)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <code className="hidden rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 sm:inline-block">
            {event.worm_hash.slice(0, 10)}…
          </code>
          {expandable ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )
          ) : null}
        </div>
      </button>

      {expanded && expandable && (
        <div className="bg-zinc-50/60 px-4 py-3 dark:bg-zinc-900/30">
          {event.diff && event.diff.length > 0 && <DiffViewer diff={event.diff} />}
          {event.metadata && Object.keys(event.metadata).length > 0 && (
            <MetadataViewer metadata={event.metadata} hasDiff={!!event.diff?.length} />
          )}
        </div>
      )}
    </li>
  );
}

function DiffViewer({ diff }: { diff: NonNullable<AuditTrailEvent["diff"]> }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Wijzigingen
      </p>
      <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-xs">
          <thead className="bg-white text-[10px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="border-b border-zinc-200 px-3 py-1.5 text-left font-medium dark:border-zinc-800">
                Veld
              </th>
              <th className="border-b border-r border-zinc-200 px-3 py-1.5 text-left font-medium dark:border-zinc-800">
                Voor
              </th>
              <th className="border-b border-zinc-200 px-3 py-1.5 text-left font-medium dark:border-zinc-800">
                Na
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-zinc-950">
            {diff.map((row, idx) => (
              <tr
                key={`${row.field}-${idx}`}
                className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800"
              >
                <td className="px-3 py-2 align-top font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                  {row.field}
                </td>
                <td className="border-r border-zinc-100 px-3 py-2 align-top dark:border-zinc-800">
                  <DiffCell value={row.before} tone="before" />
                </td>
                <td className="px-3 py-2 align-top">
                  <DiffCell value={row.after} tone="after" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiffCell({
  value,
  tone,
}: {
  value: string | number | boolean | null;
  tone: "before" | "after";
}) {
  if (value === null || value === undefined || value === "") {
    return (
      <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 dark:bg-zinc-800">
        ∅ leeg
      </span>
    );
  }
  const cls =
    tone === "before"
      ? "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300"
      : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300";
  return (
    <span className={`inline-block max-w-full break-words rounded px-1.5 py-0.5 font-mono text-[11px] ${cls}`}>
      {String(value)}
    </span>
  );
}

function MetadataViewer({
  metadata,
  hasDiff,
}: {
  metadata: Record<string, string | number | boolean | null>;
  hasDiff: boolean;
}) {
  return (
    <div className={hasDiff ? "mt-3" : ""}>
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Metadata
      </p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        {Object.entries(metadata).map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="font-mono text-[10px] text-zinc-500">{k}</dt>
            <dd className="break-words text-[12px] text-zinc-800 dark:text-zinc-200">
              {v === null || v === undefined
                ? "—"
                : typeof v === "boolean"
                ? v
                  ? "ja"
                  : "nee"
                : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────

interface MonthBucket {
  key: string; // "2026-05"
  label: string; // "Mei 2026"
  events: AuditTrailEvent[];
}

const MONTH_LABELS_NL = [
  "Januari",
  "Februari",
  "Maart",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Augustus",
  "September",
  "Oktober",
  "November",
  "December",
];

function groupByMonth(events: AuditTrailEvent[]): MonthBucket[] {
  const map = new Map<string, AuditTrailEvent[]>();
  for (const e of events) {
    const d = new Date(e.occurred_at);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const existing = map.get(key);
    if (existing) existing.push(e);
    else map.set(key, [e]);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => {
      const [year, month] = key.split("-");
      const idx = Number(month) - 1;
      return {
        key,
        label: `${MONTH_LABELS_NL[idx] ?? month} ${year}`,
        events: list,
      };
    });
}

function formatNlDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

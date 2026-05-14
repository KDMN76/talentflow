"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileSearch,
  Search,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  useAuditEvents,
  type AuditFilters,
  type AuditEvent,
} from "@/hooks/useCompliance";
import {
  AUDIT_ACTION_LABELS,
  type AuditAction,
} from "@/lib/mockData";
import { cn } from "@/lib/utils";

// ─── Action color (semantic) ────────────────────────────────────────────────

function actionColor(action: AuditAction): string {
  if (action.startsWith("consent.granted")) return "text-emerald-600";
  if (action.startsWith("consent.withdrawn")) return "text-red-600";
  if (
    action === "candidate.anonymized" ||
    action === "retention_policy.deleted"
  )
    return "text-red-600";
  if (action.startsWith("dsar.fulfilled")) return "text-emerald-600";
  if (action.startsWith("dsar.")) return "text-blue-600";
  if (action.startsWith("retention_policy.")) return "text-purple-600";
  if (action.startsWith("user.")) return "text-zinc-600";
  return "text-indigo-600";
}

// ─── Diff renderer ──────────────────────────────────────────────────────────

function DiffPanel({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const keys = Array.from(
    new Set([
      ...Object.keys(before ?? {}),
      ...Object.keys(after ?? {}),
    ])
  );
  if (keys.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">Geen waarde-wijzigingen.</p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold">Veld</th>
            <th className="px-2 py-1.5 text-left font-semibold">Voor</th>
            <th className="px-2 py-1.5 text-left font-semibold">Na</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const b = before?.[k];
            const a = after?.[k];
            const changed = JSON.stringify(b) !== JSON.stringify(a);
            return (
              <tr key={k} className={cn("border-t border-border", changed && "")}>
                <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                  {k}
                </td>
                <td className="px-2 py-1.5 font-mono text-[11px] text-red-600 dark:text-red-400">
                  {b === undefined ? "—" : JSON.stringify(b)}
                </td>
                <td className="px-2 py-1.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                  {a === undefined ? "—" : JSON.stringify(a)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── CSV export ──────────────────────────────────────────────────────────────

function eventsToCsv(events: AuditEvent[]): string {
  const header = [
    "id",
    "timestamp",
    "action",
    "entity_type",
    "entity_id",
    "actor_name",
    "actor_email",
    "ip_address",
    "before",
    "after",
  ];
  const rows = events.map((e) =>
    [
      e.id,
      e.timestamp,
      e.action,
      e.entity_type,
      e.entity_id,
      e.actor_name ?? "",
      e.actor_email ?? "",
      e.ip_address ?? "",
      JSON.stringify(e.before ?? {}),
      JSON.stringify(e.after ?? {}),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

function downloadCsv(events: AuditEvent[]) {
  const csv = eventsToCsv(events);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function AuditRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const hasDiff = !!(event.before || event.after);
  return (
    <>
      <tr
        className={cn(
          "transition-colors",
          hasDiff
            ? "cursor-pointer hover:bg-zinc-50/50 dark:hover:bg-zinc-900/40"
            : ""
        )}
        onClick={() => hasDiff && setOpen((o) => !o)}
      >
        <td className="w-8 px-3 py-2.5 align-top">
          {hasDiff ? (
            open ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )
          ) : (
            <span className="inline-block h-3.5 w-3.5" />
          )}
        </td>
        <td className="px-3 py-2.5 align-top">
          <div className="text-xs font-mono text-muted-foreground">
            {new Date(event.timestamp).toLocaleString("nl-NL", {
              dateStyle: "short",
              timeStyle: "medium",
            })}
          </div>
        </td>
        <td className="px-3 py-2.5 align-top">
          <span
            className={cn(
              "text-xs font-semibold",
              actionColor(event.action)
            )}
          >
            {AUDIT_ACTION_LABELS[event.action] ?? event.action}
          </span>
          <div className="text-[10px] font-mono text-muted-foreground">
            {event.action}
          </div>
        </td>
        <td className="px-3 py-2.5 align-top">
          <div className="text-xs font-medium">{event.entity_type}</div>
          <div className="text-[10px] font-mono text-muted-foreground">
            {event.entity_id}
          </div>
        </td>
        <td className="px-3 py-2.5 align-top">
          <div className="text-xs">{event.actor_name ?? "—"}</div>
          <div className="text-[10px] text-muted-foreground">
            {event.actor_email ?? ""}
          </div>
        </td>
        <td className="px-3 py-2.5 align-top">
          <span className="font-mono text-[11px] text-muted-foreground">
            {event.ip_address ?? "—"}
          </span>
        </td>
      </tr>
      {open && hasDiff && (
        <tr className="bg-zinc-50/40 dark:bg-zinc-900/40">
          <td></td>
          <td colSpan={5} className="px-3 pb-3">
            <DiffPanel before={event.before} after={event.after} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

const ENTITY_TYPES = [
  { value: "all", label: "Alle entiteiten" },
  { value: "candidate", label: "Kandidaat" },
  { value: "dsar_request", label: "DSAR-verzoek" },
  { value: "retention_policy", label: "Bewaarbeleid" },
  { value: "user", label: "Gebruiker" },
];

export function AuditTrailViewer() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState<string>("all");
  const [action, setAction] = useState<AuditAction | "all">("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const filters: AuditFilters = useMemo(() => {
    const f: AuditFilters = {};
    if (entityType !== "all") f.entity_type = entityType;
    if (action !== "all") f.action = action;
    if (search.trim()) f.search = search.trim();
    if (from) f.from = new Date(from).toISOString();
    if (to) f.to = new Date(to + "T23:59:59").toISOString();
    return f;
  }, [search, entityType, action, from, to]);

  const { data, isLoading } = useAuditEvents(filters);

  const handleExport = () => {
    if (!data || data.length === 0) {
      toast({
        title: "Geen events",
        description: "Er zijn geen events om te exporteren.",
      });
      return;
    }
    downloadCsv(data);
    toast({
      title: "CSV gedownload",
      description: `${data.length} events geëxporteerd.`,
    });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek in actie, entiteit, gebruiker…"
            className="pl-9"
          />
        </div>
        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENTITY_TYPES.map((e) => (
              <SelectItem key={e.value} value={e.value}>
                {e.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={action}
          onValueChange={(v) => setAction(v as AuditAction | "all")}
        >
          <SelectTrigger>
            <SelectValue placeholder="Alle acties" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle acties</SelectItem>
            {(Object.keys(AUDIT_ACTION_LABELS) as AuditAction[]).map((a) => (
              <SelectItem key={a} value={a}>
                {AUDIT_ACTION_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={handleExport}
          className="gap-1.5"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:max-w-md">
        <div className="space-y-1">
          <Label htmlFor="audit-from" className="text-xs">
            Vanaf
          </Label>
          <Input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-to" className="text-xs">
            Tot en met
          </Label>
          <Input
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-4 py-2 flex items-center gap-2 text-xs">
          <Shield className="h-3.5 w-3.5 text-indigo-600" />
          <span className="font-semibold">WORM-trail</span>
          <span className="text-muted-foreground">
            — events zijn onveranderbaar en bewaard volgens AVG art. 30.
          </span>
          <span className="ml-auto text-muted-foreground">
            {data?.length ?? 0} events
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-[11px] uppercase tracking-wide text-muted-foreground dark:bg-zinc-900/40">
              <tr>
                <th className="w-8"></th>
                <th className="px-3 py-2 text-left font-semibold">Tijdstip</th>
                <th className="px-3 py-2 text-left font-semibold">Actie</th>
                <th className="px-3 py-2 text-left font-semibold">Entiteit</th>
                <th className="px-3 py-2 text-left font-semibold">Gebruiker</th>
                <th className="px-3 py-2 text-left font-semibold">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="p-3">
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))
              ) : !data || data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-12">
                    <div className="flex flex-col items-center text-center">
                      <FileSearch className="h-10 w-10 text-zinc-300 mb-3" />
                      <p className="font-semibold">Geen events gevonden</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Pas je filters aan om meer events te tonen.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                data.map((event) => <AuditRow key={event.id} event={event} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

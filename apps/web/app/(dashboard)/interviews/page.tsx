"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Calendar,
  Clock,
  Filter,
  MapPin,
  Phone,
  Plus,
  Search,
  Video,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { SchedulerDialog } from "@/components/interviews/SchedulerDialog";
import { useInterviews } from "@/hooks/useInterviews";
import { useTenantUsers } from "@/hooks/useUsers";
import { cn } from "@/lib/utils";
import type {
  Interview,
  InterviewLocationType,
  InterviewStatus,
} from "@/lib/types/interviews";

type TabKey = "upcoming" | "completed" | "cancelled";

const TAB_STATUSES: Record<TabKey, InterviewStatus[]> = {
  upcoming: ["scheduled", "rescheduled"],
  completed: ["completed", "no_show"],
  cancelled: ["cancelled"],
};

// API-statuswaarden blijven de keys; de zichtbare labels komen via t(labelKey).
const STATUS_BADGE: Record<InterviewStatus, { labelKey: string; cls: string }> = {
  scheduled: {
    labelKey: "status.scheduled",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  rescheduled: {
    labelKey: "status.rescheduled",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  completed: {
    labelKey: "status.completed",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  no_show: {
    labelKey: "status.noShow",
    cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  cancelled: {
    labelKey: "status.cancelled",
    cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  },
};

const LOCATION_ICON: Record<InterviewLocationType, typeof Video> = {
  google_meet: Video,
  teams: Video,
  zoom: Video,
  in_person: MapPin,
  phone: Phone,
};

export default function InterviewsPage() {
  const { t } = useTranslation("interviews");
  const [tab, setTab] = useState<TabKey>("upcoming");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [interviewerId, setInterviewerId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filters = useMemo(
    () => ({
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      interviewer_id: interviewerId !== "all" ? interviewerId : undefined,
    }),
    [from, to, interviewerId]
  );

  const { data, isLoading, isError, error } = useInterviews(filters);

  // Populate the interviewer dropdown from the tenant users endpoint. The list
  // endpoint doesn't return participants, but the backend DOES support the
  // `interviewer_id` query param, so filtering is fully functional server-side.
  const { data: teamUsers } = useTenantUsers();
  const interviewerOptions = useMemo(
    () => (teamUsers ?? []).map((u) => ({ id: u.id, name: u.name })),
    [teamUsers]
  );

  const tabbed = useMemo(() => {
    if (!data) return [];
    const allowed = new Set(TAB_STATUSES[tab]);
    return data
      .filter((iv) => allowed.has(iv.status))
      .filter((iv) => {
        if (!search.trim()) return true;
        const needle = search.toLowerCase();
        return (
          (iv.candidate_name?.toLowerCase() ?? "").includes(needle) ||
          (iv.job_title?.toLowerCase() ?? "").includes(needle)
        );
      })
      .sort((a, b) => {
        const aT = new Date(a.scheduled_start).getTime();
        const bT = new Date(b.scheduled_start).getTime();
        return tab === "upcoming" ? aT - bT : bT - aT;
      });
  }, [data, tab, search]);

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { upcoming: 0, completed: 0, cancelled: 0 };
    (data ?? []).forEach((iv) => {
      (Object.keys(TAB_STATUSES) as TabKey[]).forEach((k) => {
        if (TAB_STATUSES[k].includes(iv.status)) c[k]++;
      });
    });
    return c;
  }, [data]);

  const resetFilters = () => {
    setFrom("");
    setTo("");
    setInterviewerId("all");
    setSearch("");
  };

  const hasActiveFilters =
    from !== "" || to !== "" || interviewerId !== "all" || search !== "";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("newInterview")}
          </Button>
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="from">{t("filters.from")}</Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">{t("filters.to")}</Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("filters.interviewer")}</Label>
              <Select value={interviewerId} onValueChange={setInterviewerId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filters.allInterviewers")}</SelectItem>
                  {interviewerOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="search">{t("filters.search")}</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("filters.searchPlaceholder")}
                  className="pl-8"
                />
              </div>
            </div>
          </div>
          {hasActiveFilters && (
            <div className="flex items-center gap-2 text-xs">
              <Filter className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">
                {t("filters.activeResults", { count: tabbed.length })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 ml-auto"
                onClick={resetFilters}
              >
                <X className="h-3 w-3 mr-1" /> {t("filters.reset")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="upcoming">
            {t("tabs.upcoming")}
            <CountChip n={counts.upcoming} />
          </TabsTrigger>
          <TabsTrigger value="completed">
            {t("tabs.completed")}
            <CountChip n={counts.completed} />
          </TabsTrigger>
          <TabsTrigger value="cancelled">
            {t("tabs.cancelled")}
            <CountChip n={counts.cancelled} />
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-rose-600">
              {t("error.loadFailed")}
            </p>
            {error instanceof Error && (
              <p className="mt-1 text-xs text-muted-foreground">
                {error.message}
              </p>
            )}
          </CardContent>
        </Card>
      ) : tabbed.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="h-10 w-10 text-muted-foreground/50 mx-auto" />
            <p className="text-sm font-medium text-muted-foreground mt-3">
              {t("empty.noInterviews", {
                tab: t(`tabs.${tab}`).toLowerCase(),
              })}
            </p>
            {tab === "upcoming" && (
              <Button
                onClick={() => setOpen(true)}
                size="sm"
                className="mt-4"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                {t("empty.scheduleCta")}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tabbed.map((iv) => (
            <InterviewRow key={iv.id} iv={iv} />
          ))}
        </div>
      )}

      <SchedulerDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function CountChip({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 px-1 text-[10px] font-semibold">
      {n}
    </span>
  );
}

function InterviewRow({ iv }: { iv: Interview }) {
  const { t } = useTranslation("interviews");
  const status = STATUS_BADGE[iv.status] ?? STATUS_BADGE.scheduled;
  const LocIcon = (iv.location_type && LOCATION_ICON[iv.location_type]) || Video;
  return (
    <Link
      href={`/interviews/${iv.id}`}
      className="block rounded-lg border border-border bg-background p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
    >
      <div className="flex items-center gap-4">
        <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/40 h-12 w-12 flex flex-col items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
          <span className="text-[10px] font-semibold uppercase">
            {new Date(iv.scheduled_start).toLocaleDateString("nl-NL", {
              month: "short",
            })}
          </span>
          <span className="text-base font-bold leading-none">
            {new Date(iv.scheduled_start).getDate()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {iv.candidate_name}
            </p>
            <Badge
              className={cn(
                "border-transparent rounded-md text-[10px] uppercase tracking-wide",
                status.cls
              )}
            >
              {t(status.labelKey)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {iv.job_title}
          </p>
          <div className="flex items-center gap-4 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDateTime(iv.scheduled_start)} ·{" "}
              {t("row.durationMin", { count: iv.duration_minutes })}
            </span>
            <span className="inline-flex items-center gap-1">
              <LocIcon className="h-3 w-3" />
              {locationLabel(t, iv.location_type)}
            </span>
          </div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0">
          {t("row.view")}
        </Button>
      </div>
    </Link>
  );
}

// Merknamen (Google Meet, Teams, Zoom) blijven onvertaald.
function locationLabel(
  t: TFunction,
  type: InterviewLocationType | null
): string {
  switch (type) {
    case "google_meet":
      return "Google Meet";
    case "teams":
      return "Teams";
    case "zoom":
      return "Zoom";
    case "in_person":
      return t("location.inPerson");
    case "phone":
      return t("location.phone");
    default:
      return "—";
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })} · ${d.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

"use client";

/**
 * AI-toezicht (EU AI Act) — Sprint Q4.6.
 *
 * 1. Review-wachtrij: door AI/workflows voorgestelde afwijzingen die op een
 *    menselijke beslissing wachten (art. 14 — human oversight).
 * 2. Retentie-status van het append-only AI-register (ai_events, WORM):
 *    de EU AI Act vereist minimaal 6 maanden logging (art. 12/19).
 */

import { useTranslation } from "react-i18next";
import { Archive, CalendarClock, Database, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AiOversightQueue } from "@/components/compliance/AiOversightQueue";
import { useAiRetentionStatus } from "@/hooks/useAiOversight";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function RetentionCard() {
  const { t } = useTranslation("aiCompliance");
  const { data, isLoading } = useAiRetentionStatus();

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Archive className="h-4 w-4 text-indigo-500" />
          {t("oversight.retention.title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("oversight.retention.description", {
            months: data?.minimum_retention_months ?? 6,
          })}
        </p>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-zinc-50 dark:bg-zinc-800/40 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  {t("oversight.retention.totalEvents")}
                </p>
                <p className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {data.total_events.toLocaleString("nl-NL")}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-zinc-50 dark:bg-zinc-800/40 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" />
                  {t("oversight.retention.oldestEvent")}
                </p>
                <p className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {data.total_events === 0
                    ? "—"
                    : formatDate(data.oldest_event_at)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-zinc-50 dark:bg-zinc-800/40 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" />
                  {t("oversight.retention.newestEvent")}
                </p>
                <p className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {data.total_events === 0
                    ? "—"
                    : formatDate(data.newest_event_at)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-zinc-50 dark:bg-zinc-800/40 p-3">
                <p className="text-xs text-muted-foreground">
                  {t("oversight.retention.monthsCovered")}
                </p>
                <p className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {data.total_events === 0 ? "—" : data.months_covered}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    / {data.minimum_retention_months}
                  </span>
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              {data.total_events === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("oversight.retention.noEvents")}
                </p>
              )}
              {data.worm_protected && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  {t("oversight.retention.wormProtected")}
                </p>
              )}
              {data.compliant && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  {t("oversight.retention.compliant")}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AiOversightPage() {
  const { t } = useTranslation("aiCompliance");

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("oversight.header.title")}
        description={t("oversight.header.description")}
      />
      <AiOversightQueue />
      <RetentionCard />
    </div>
  );
}

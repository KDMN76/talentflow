"use client";

/**
 * Kandidaat-AI-samenvatting (EU AI Act art. 13 — transparantie).
 *
 * Herbruikbaar: toont per kandidaat welke AI-verwerkingscategorieën zijn
 * toegepast (uit het append-only ai_events-register), met datums en
 * modelnamen — nooit prompts of inhoud. Gebruikt op kandidaat-detail; ook
 * bruikbaar in DSAR-/compliance-views.
 */

import { useTranslation } from "react-i18next";
import { Bot, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpHint } from "@/components/ui/HelpHint";
import { useCandidateAiSummary } from "@/hooks/useAiOversight";

const CATEGORY_BADGE_CLASSES: Record<string, string> = {
  profile_parsing:
    "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  semantic_indexing:
    "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  matching: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  bias_monitoring:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  content_generation:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  interview_ai:
    "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300",
  communication_ai:
    "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  other: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export interface CandidateAiSummaryProps {
  candidateId: string;
  className?: string;
}

export function CandidateAiSummary({
  candidateId,
  className,
}: CandidateAiSummaryProps) {
  const { t } = useTranslation("aiCompliance");
  const { data, isLoading, isError } = useCandidateAiSummary(candidateId);

  // Compliance-informatie is nice-to-have op detailpagina's: bij een fout
  // (bv. 403 voor een rol zonder toegang) tonen we niets i.p.v. een kapot blok.
  if (isError) return null;

  return (
    <Card className={className ?? "border-0 shadow-sm"}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="h-4 w-4 text-indigo-500" />
          {t("candidateSummary.title")}
          <HelpHint text={t("candidateSummary.hint")} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
          </div>
        ) : !data || !data.has_ai_processing ? (
          <p className="text-sm text-muted-foreground py-2">
            {t("candidateSummary.empty")}
          </p>
        ) : (
          <div className="space-y-2">
            {data.entries.map((entry) => (
              <div
                key={entry.feature}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-zinc-50 dark:bg-zinc-800/40 px-3 py-2"
              >
                <Badge
                  variant="secondary"
                  className={
                    CATEGORY_BADGE_CLASSES[entry.category] ??
                    CATEGORY_BADGE_CLASSES.other
                  }
                >
                  {t(`candidateSummary.category.${entry.category}`, {
                    defaultValue: t("candidateSummary.category.other"),
                  })}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t("candidateSummary.eventCount", {
                    count: entry.event_count,
                  })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("candidateSummary.firstUsed")}:{" "}
                  {formatDateTime(entry.first_used_at)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("candidateSummary.lastUsed")}:{" "}
                  {formatDateTime(entry.last_used_at)}
                </span>
                {entry.models.filter(Boolean).length > 0 && (
                  <span className="text-xs text-muted-foreground truncate">
                    {t("candidateSummary.models")}:{" "}
                    {entry.models.filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
            ))}
            <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              {t("candidateSummary.disclosure")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AIBadge } from "@/components/matching/AIBadge";
import { JobMatchesSection } from "@/components/matching/JobMatchesSection";
import { ReactivationAlertsWidget } from "@/components/matching/ReactivationAlertsWidget";
import { SimilarHiresWidget } from "@/components/matching/SimilarHiresWidget";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useJobBiasCheck,
  useJobSourcingSuggestions,
} from "@/hooks/useJobDetail";
import { cn } from "@/lib/utils";
import type { BiasFlag } from "@/lib/types/jobDetail";

const SEVERITY_COPY: Record<BiasFlag["severity"], { label: string; cls: string }> = {
  low: {
    label: "Laag",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  medium: {
    label: "Middel",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  high: {
    label: "Hoog",
    cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  },
};

const FLAG_TYPE_COPY: Record<string, string> = {
  gender_coded: "Geslacht-gecodeerd",
  age_coded: "Leeftijd-gecodeerd",
  vague_requirement: "Vage vereiste",
  exclusive_language: "Uitsluitend taalgebruik",
  salary_undisclosed: "Geen salaris vermeld",
  jargon: "Jargon",
};

export interface JobAISuiteTabProps {
  jobId: string;
  jobTitle: string;
}

export function JobAISuiteTab({ jobId, jobTitle }: JobAISuiteTabProps) {
  return (
    <div className="space-y-6">
      {/* Top kandidaten in database */}
      <JobMatchesSection jobId={jobId} jobTitle={jobTitle} />

      {/* Vergelijkbare past-hires — Talent Fit Model context */}
      <SimilarHiresWidget jobId={jobId} />

      {/* Talent reactivation — bestaande database-kandidaten die opnieuw matchen */}
      <ReactivationAlertsWidget
        variant="job-tab"
        jobId={jobId}
        jobTitle={jobTitle}
      />

      {/* Sourcing suggesties */}
      <SourcingSuggestionsCard jobId={jobId} />

      {/* JD-quality / bias check */}
      <BiasCheckCard jobId={jobId} />
    </div>
  );
}

// ─── Sourcing suggestions ───────────────────────────────────────────────────

function SourcingSuggestionsCard({ jobId }: { jobId: string }) {
  const { data, isLoading } = useJobSourcingSuggestions(jobId);
  const { toast } = useToast();
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleCopy = async (s: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(s);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
      toast({
        title: "Gekopieerd",
        description: "Boolean search staat op je klembord.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Kon niet kopiëren",
        description: "Selecteer en kopieer de tekst handmatig.",
      });
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4 text-blue-500" />
              Sourcing suggesties
              <AIBadge label="Door AI gegenereerde boolean searches — recruiter behoudt het finale oordeel." />
            </CardTitle>
            <CardDescription className="mt-1">
              Plak deze boolean searches in LinkedIn, Indeed of GitHub om
              passieve kandidaten te vinden.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : data && data.length > 0 ? (
          <div className="space-y-2">
            {data.map((suggestion, i) => (
              <div
                key={i}
                className="group rounded-lg border border-border bg-zinc-50/60 dark:bg-zinc-800/40 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <code className="block flex-1 font-mono text-xs text-zinc-700 dark:text-zinc-200 break-all whitespace-pre-wrap">
                    {suggestion}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleCopy(suggestion, i)}
                  >
                    {copiedIdx === i ? (
                      <>
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-emerald-500" />
                        Gekopieerd
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1 h-3.5 w-3.5" />
                        Kopiëren
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nog geen sourcing-suggesties beschikbaar voor deze vacature.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Bias / JD-quality check ────────────────────────────────────────────────

function BiasCheckCard({ jobId }: { jobId: string }) {
  const { data, isLoading } = useJobBiasCheck(jobId);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-purple-500" />
          JD-kwaliteitscheck
          <AIBadge label="Door AI gegenereerde analyse van de vacaturetekst — recruiter behoudt het finale oordeel." />
        </CardTitle>
        <CardDescription className="mt-1">
          Helderheid en inclusiviteit van de vacaturetekst, plus eventuele
          aandachtspunten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Gauge label="Helderheid" value={data.clarity_score} />
              <Gauge label="Inclusiviteit" value={data.inclusivity_score} />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Aandachtspunten ({data.flags.length})
              </p>
              {data.flags.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-6 text-center">
                  <CheckCircle2 className="h-5 w-5 mx-auto text-emerald-500" />
                  <p className="mt-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Geen aandachtspunten gevonden.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {data.flags.map((flag, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-border bg-zinc-50/60 dark:bg-zinc-800/40 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <AlertCircle className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                {flag.label}
                              </span>
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0"
                              >
                                {FLAG_TYPE_COPY[flag.type] ?? flag.type}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground italic">
                              "{flag.excerpt}"
                            </p>
                            <p className="mt-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                              <span className="font-medium">Suggestie: </span>
                              {flag.suggestion}
                            </p>
                          </div>
                        </div>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold shrink-0",
                            SEVERITY_COPY[flag.severity].cls
                          )}
                        >
                          {SEVERITY_COPY[flag.severity].label}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground border-t border-border pt-2 flex items-start gap-1.5">
              <Sparkles className="h-3 w-3 mt-0.5 text-purple-500 shrink-0" />
              <span>{data.ai_disclosure}</span>
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            JD-analyse nog niet beschikbaar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Gauge({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 70
      ? "text-emerald-600 ring-emerald-200 dark:text-emerald-400 dark:ring-emerald-900/60"
      : value >= 40
      ? "text-amber-600 ring-amber-200 dark:text-amber-400 dark:ring-amber-900/60"
      : "text-red-600 ring-red-200 dark:text-red-400 dark:ring-red-900/60";
  const fillColor =
    value >= 70
      ? "stroke-emerald-500"
      : value >= 40
      ? "stroke-amber-500"
      : "stroke-red-500";

  // Circular gauge: 36px radius, circumference ≈ 226.
  const r = 36;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, value)) / 100) * c;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <div className="relative h-20 w-20 shrink-0">
        <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
          <circle
            cx="40"
            cy="40"
            r={r}
            className="fill-none stroke-zinc-200 dark:stroke-zinc-700"
            strokeWidth="6"
          />
          <circle
            cx="40"
            cy="40"
            r={r}
            className={cn("fill-none transition-[stroke-dashoffset]", fillColor)}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
          />
        </svg>
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center text-base font-bold",
            tone.split(" ")[0],
            tone.split(" ")[2] ?? ""
          )}
        >
          {value}
        </div>
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {value >= 70
            ? "Goed"
            : value >= 40
            ? "Kan beter"
            : "Verbetering nodig"}
        </p>
      </div>
    </div>
  );
}

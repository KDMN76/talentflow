"use client";

import Link from "next/link";
import { Briefcase, CalendarCheck2, Users } from "lucide-react";
import { AIBadge } from "@/components/matching/AIBadge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { useSimilarHiresForJob } from "@/hooks/useTalentFit";
import { cn, getInitials } from "@/lib/utils";
import type { SimilarHireDetail } from "@/lib/types/matching";

/**
 * Widget surfacing the top-N past-hires (within the tenant) most similar to
 * the current job. Used inside the job's "AI Suite" tab.
 *
 * The list is meant to be a memory-aid: "you previously hired *these* people
 * for jobs that look like this one — go look at their profiles for sourcing
 * inspiration".
 */
export interface SimilarHiresWidgetProps {
  jobId: string;
  limit?: number;
}

export function SimilarHiresWidget({ jobId, limit = 5 }: SimilarHiresWidgetProps) {
  const { data, isLoading } = useSimilarHiresForJob(jobId, limit);

  const hires = data ?? [];

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-emerald-500" />
          Vergelijkbare past-hires van jou
          <AIBadge label="Past-hires geselecteerd op profiel-similarity. Gebruik dit als context, niet als beslissing." />
        </CardTitle>
        <CardDescription className="mt-1">
          Eerdere hires voor vergelijkbare vacatures — bekijk hun profielen
          voor sourcing-inspiratie.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : hires.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <Users className="h-5 w-5 mx-auto text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Geen vergelijkbare past-hires gevonden
            </p>
            <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
              Zodra je meer kandidaten als &quot;Aangenomen&quot; markeert,
              kunnen we hier relevante voorbeelden tonen.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {hires.map((hire) => (
              <li key={hire.candidate_id}>
                <SimilarHireListItem hire={hire} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SimilarHireListItem({ hire }: { hire: SimilarHireDetail }) {
  const percent = Math.round(hire.cosine_to_query * 100);
  const tone =
    percent >= 85
      ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900"
      : percent >= 70
      ? "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900"
      : "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700";

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-zinc-50/60 dark:bg-zinc-800/30 p-3">
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback className="bg-gradient-to-br from-emerald-400 to-teal-500 text-white text-xs font-bold">
          {getInitials(hire.candidate_name)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {hire.candidate_name}
          </span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wide",
              tone
            )}
          >
            {percent}% match
          </Badge>
        </div>

        {hire.candidate_position && (
          <p className="mt-0.5 text-xs text-muted-foreground truncate">
            {hire.candidate_position}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Briefcase className="h-3 w-3" />
            {hire.job_title}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarCheck2 className="h-3 w-3" />
            {formatDate(hire.hired_at)}
          </span>
        </div>

        {hire.shared_skills.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {hire.shared_skills.slice(0, 3).map((skill) => (
              <Badge
                key={skill}
                variant="secondary"
                className="text-[10px] px-1.5 py-0 bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-400 border-0"
              >
                {skill}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Button
        asChild
        variant="ghost"
        size="sm"
        className="h-8 text-xs shrink-0"
      >
        <Link href={`/candidates/${hire.candidate_id}`}>Bekijk</Link>
      </Button>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

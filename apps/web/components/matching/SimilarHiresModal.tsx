"use client";

import { Briefcase, CalendarCheck2, UserCircle2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AIBadge } from "@/components/matching/AIBadge";
import { useSimilarHires } from "@/hooks/useTalentFit";
import { cn, getInitials } from "@/lib/utils";
import type { SimilarHireDetail } from "@/lib/types/matching";

/**
 * Modal listing the top-N past hires (within the tenant) most similar to a
 * specific candidate — optionally narrowed to a single job's hire history.
 *
 * Triggered from the "Lijkt op X hires" badge on a `MatchCard` and from the
 * dual-score badge expand-action. The "vergelijking" is a profile-embedding
 * similarity from `apps/api/src/modules/matching/talentFit.service.ts`.
 *
 * The footer carries the AI-Act disclosure: similarity is decision *context*,
 * not the decision itself.
 */

export interface SimilarHiresModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateId: string;
  candidateName: string;
  /** When provided, scope the similarity to past-hires for this same job. */
  jobId?: string;
}

export function SimilarHiresModal({
  open,
  onOpenChange,
  candidateId,
  candidateName,
  jobId,
}: SimilarHiresModalProps) {
  const { data, isLoading } = useSimilarHires(open ? candidateId : null, jobId);

  const hires = data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCircle2 className="h-4 w-4 text-purple-500" />
            Vergelijkbaar met {hires.length} eerdere{" "}
            {hires.length === 1 ? "hire" : "hires"} van jou
          </DialogTitle>
          <DialogDescription>
            {candidateName} lijkt — op basis van profile-embedding similarity —
            op kandidaten die je in het verleden hebt aangenomen.
            {jobId
              ? " Beperkt tot historische hires voor vergelijkbare vacatures."
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto pr-1 space-y-2">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : hires.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-10 text-center">
              <UserCircle2 className="h-6 w-6 mx-auto text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Geen vergelijkbare past-hires gevonden
              </p>
              <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
                Zodra er meer historische hires in je tenant staan, kan het
                Talent Fit model relevante voorbeelden tonen.
              </p>
            </div>
          ) : (
            hires.map((hire) => <SimilarHireRow key={hire.candidate_id} hire={hire} />)
          )}
        </div>

        {/* AI disclosure footer */}
        <div className="flex items-start gap-2 rounded-md border border-purple-100 dark:border-purple-900/50 bg-purple-50/60 dark:bg-purple-950/20 px-3 py-2">
          <AIBadge label="Vergelijking op basis van profile-embedding similarity. Gebruik dit als context, niet als beslissing." />
          <p className="text-[11px] italic text-zinc-600 dark:text-zinc-400 leading-snug">
            Vergelijking op basis van profile-embedding similarity. Gebruik dit
            als context bij je beoordeling, niet als beslissing.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function SimilarHireRow({ hire }: { hire: SimilarHireDetail }) {
  const percent = Math.round(hire.cosine_to_query * 100);
  const tone =
    percent >= 85
      ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900"
      : percent >= 70
      ? "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900"
      : "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700";

  return (
    <div className="rounded-lg border border-border bg-zinc-50/60 dark:bg-zinc-800/30 p-3">
      <div className="flex items-start gap-3">
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

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Briefcase className="h-3 w-3" />
              {hire.job_title}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarCheck2 className="h-3 w-3" />
              Aangenomen op {formatHiredDate(hire.hired_at)}
            </span>
          </div>

          {hire.shared_skills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
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
      </div>
    </div>
  );
}

function formatHiredDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

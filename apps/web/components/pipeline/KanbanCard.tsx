"use client";

import { useDraggable } from "@dnd-kit/core";
import { GripVertical, Calendar } from "lucide-react";
import { cn, getInitials, getScoreColor, formatRelativeDate, formatDate } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SkillsGapViewerCompact } from "@/components/skills/SkillsGapViewer";
import type { Application } from "@/lib/mockData";

function resolveCandidate(application: Application) {
  const name = application.candidate?.name ?? application.candidate_name ?? "Onbekend";
  const email = application.candidate?.email ?? application.candidate_email ?? "";
  const aiScore = application.candidate?.ai_score ?? application.ai_score ?? null;
  return { name, email, aiScore };
}

export function KanbanCard({
  application,
  showAbsoluteDate,
}: {
  application: Application;
  showAbsoluteDate?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: application.id,
    data: { application },
  });

  const { name, email, aiScore } = resolveCandidate(application);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group relative rounded-xl border border-border bg-white dark:bg-zinc-900 p-3.5 shadow-sm transition-shadow duration-150 cursor-grab active:cursor-grabbing",
        isDragging ? "opacity-40 pointer-events-none" : "hover:shadow-md"
      )}
      {...attributes}
      {...listeners}
    >
      <div
        className={cn(
          "absolute right-2 top-2 transition-opacity",
          isDragging ? "opacity-0" : "opacity-0 group-hover:opacity-100"
        )}
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>

      <div className="flex items-start gap-3">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-semibold">
            {getInitials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate pr-4">{name}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{email}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span title={formatDate(application.applied_at)}>
            {showAbsoluteDate
              ? formatDate(application.applied_at)
              : formatRelativeDate(application.applied_at)}
          </span>
        </div>
        {aiScore !== null && (
          <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold", getScoreColor(aiScore))}>
            {aiScore}
          </span>
        )}
      </div>

      {application.candidate_id && application.job_id && (
        <div
          className="mt-2 border-t border-border/50 pt-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <SkillsGapViewerCompact
            jobId={application.job_id}
            candidateId={application.candidate_id}
          />
        </div>
      )}
    </div>
  );
}

export function KanbanCardOverlay({
  application,
  showAbsoluteDate,
}: {
  application: Application;
  showAbsoluteDate?: boolean;
}) {
  const { name, email, aiScore } = resolveCandidate(application);

  return (
    <div className="rounded-xl border border-border bg-white dark:bg-zinc-900 p-3.5 shadow-xl shadow-zinc-900/20 dark:shadow-black/40 w-[272px] rotate-1 cursor-grabbing">
      <div className="flex items-start gap-3">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-semibold">
            {getInitials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate pr-4">{name}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{email}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>
            {showAbsoluteDate
              ? formatDate(application.applied_at)
              : formatRelativeDate(application.applied_at)}
          </span>
        </div>
        {aiScore !== null && (
          <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold", getScoreColor(aiScore))}>
            {aiScore}
          </span>
        )}
      </div>
    </div>
  );
}

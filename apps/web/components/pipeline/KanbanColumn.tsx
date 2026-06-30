"use client";

import { useDroppable } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/ui/HelpHint";
import { KanbanCard } from "./KanbanCard";
import type { Application, PipelineStage } from "@/lib/mockData";

interface KanbanColumnProps {
  stage: PipelineStage;
  applications: Application[];
  isOver?: boolean;
  showAbsoluteDate?: boolean;
}

export function KanbanColumn({ stage, applications, isOver, showAbsoluteDate }: KanbanColumnProps) {
  const { t } = useTranslation("pipeline");
  const { setNodeRef, isOver: droppableIsOver } = useDroppable({ id: stage.id });
  const active = isOver || droppableIsOver;

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full shadow-sm" style={{ background: stage.color }} />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{stage.name}</h3>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-bold text-zinc-500 dark:text-zinc-400">
            {applications.length}
          </span>
          <HelpHint text={t("column.countHint")} side="top" />
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-1 flex-col gap-2.5 rounded-xl p-2 min-h-[120px] ring-2 ring-inset transition-colors duration-150",
          active
            ? "bg-indigo-50/80 dark:bg-indigo-950/30 ring-indigo-200 dark:ring-indigo-800"
            : "bg-zinc-50/80 dark:bg-zinc-800/30 ring-transparent"
        )}
      >
        {applications.map((app) => (
          <KanbanCard key={app.id} application={app} showAbsoluteDate={showAbsoluteDate} />
        ))}

        {applications.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-6 text-center">
            <p className="text-xs text-muted-foreground/60">{t("board.dropHere")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

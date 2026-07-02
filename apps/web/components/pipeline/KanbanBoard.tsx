"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type Modifier,
  type CollisionDetection,
  pointerWithin,
  rectIntersection,
} from "@dnd-kit/core";

// Center the dragged overlay on the user's cursor — both horizontally and
// vertically. The cursor sits in the middle of the card throughout the drag,
// regardless of where the user originally clicked.
const snapToCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const event = activatorEvent as PointerEvent;
  const offsetX = event.clientX - draggingNodeRect.left;
  const offsetY = event.clientY - draggingNodeRect.top;
  return {
    ...transform,
    x: transform.x + offsetX - draggingNodeRect.width / 2,
    y: transform.y + offsetY - draggingNodeRect.height / 2,
  };
};

// Drop where the cursor IS, not where the (modifier-shifted) overlay is.
// Falls back to rectangle intersection when the cursor is in the gap
// between columns.
const cursorCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};
import { Search, Calendar, LayoutGrid, List } from "lucide-react";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCardOverlay } from "./KanbanCard";
import { PipelineListView } from "./PipelineListView";
import { useMoveApplication } from "@/hooks/usePipeline";
import { useToast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Application, PipelineStage } from "@/lib/mockData";

interface KanbanBoardProps {
  stages: PipelineStage[];
  applications: Application[];
  jobId: string;
}

export function KanbanBoard({ stages, applications, jobId }: KanbanBoardProps) {
  const { t } = useTranslation("pipeline");
  const [activeApplication, setActiveApplication] =
    useState<Application | null>(null);
  const [overStageId, setOverStageId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAbsoluteDate, setShowAbsoluteDate] = useState(false);
  const [view, setView] = useState<"board" | "list">("board");

  const { toast } = useToast();
  const moveApplication = useMoveApplication();

  // Always-visible horizontal scrollbar above the board, synced two-way with
  // the board's own scroll position. The dummy div inside `topScrollRef` gets
  // the board's scrollWidth so both scrollbars cover the same range.
  const boardRef = useRef<HTMLDivElement | null>(null);
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const [boardScrollWidth, setBoardScrollWidth] = useState(0);

  useEffect(() => {
    if (view !== "board") return;
    const board = boardRef.current;
    if (!board) return;

    const measure = () => setBoardScrollWidth(board.scrollWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(board);
    // Observe the columns too: the board element itself does not resize when
    // columns are added/removed, but its scrollWidth does.
    Array.from(board.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [view, stages.length]);

  // Two-way sync. Loop-guard: only assign when the positions actually differ,
  // so the echoed scroll event from the other pane is a no-op instead of an
  // infinite ping-pong.
  const syncScroll = useCallback(
    (source: HTMLDivElement | null, target: HTMLDivElement | null) => {
      if (!source || !target) return;
      if (Math.abs(target.scrollLeft - source.scrollLeft) > 1) {
        target.scrollLeft = source.scrollLeft;
      }
    },
    []
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3,
      },
    })
  );

  // Candidate quick-search filters which cards render (drag logic keeps using
  // the full list so moves still resolve while a filter is active).
  const q = search.trim().toLowerCase();
  const visibleApplications = q
    ? applications.filter((a) => {
        const name = (a.candidate?.name ?? a.candidate_name ?? "").toLowerCase();
        const email = (a.candidate?.email ?? a.candidate_email ?? "").toLowerCase();
        return name.includes(q) || email.includes(q);
      })
    : applications;

  const getApplicationsForStage = (stageId: string) =>
    visibleApplications.filter((a) => a.stage_id === stageId);

  const handleDragStart = (event: DragStartEvent) => {
    const app = applications.find((a) => a.id === event.active.id);
    if (app) setActiveApplication(app);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (over) {
      // over could be a column (stage) or a card (application)
      const overId = over.id as string;
      // check if it's a stage id
      const isStage = stages.some((s) => s.id === overId);
      if (isStage) {
        setOverStageId(overId);
      } else {
        // find which stage this card belongs to
        const overApp = applications.find((a) => a.id === overId);
        if (overApp) setOverStageId(overApp.stage_id);
      }
    } else {
      setOverStageId(null);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveApplication(null);
    setOverStageId(null);

    if (!over) return;

    const applicationId = active.id as string;
    const app = applications.find((a) => a.id === applicationId);
    if (!app) return;

    // determine target stage
    const overId = over.id as string;
    const isStage = stages.some((s) => s.id === overId);
    let targetStageId: string;

    if (isStage) {
      targetStageId = overId;
    } else {
      const overApp = applications.find((a) => a.id === overId);
      if (!overApp) return;
      targetStageId = overApp.stage_id;
    }

    if (app.stage_id === targetStageId) return;

    try {
      await moveApplication.mutateAsync({
        applicationId,
        stageId: targetStageId,
        jobId,
      });
    } catch {
      toast({
        variant: "destructive",
        title: t("toast.moveFailed.title"),
        description: t("toast.moveFailed.description"),
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("filters.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          variant={showAbsoluteDate ? "default" : "outline"}
          size="sm"
          onClick={() => setShowAbsoluteDate((v) => !v)}
        >
          <Calendar className="mr-1.5 h-4 w-4" />
          {t("filters.absoluteDate")}
        </Button>
        <div className="ml-auto flex gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setView("board")}
            aria-label={t("view.board")}
            className={`rounded-md p-1.5 transition-colors ${
              view === "board"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-label={t("view.list")}
            className={`rounded-md p-1.5 transition-colors ${
              view === "list"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {view === "list" ? (
        <PipelineListView
          applications={visibleApplications}
          stages={stages}
          jobId={jobId}
          showAbsoluteDate={showAbsoluteDate}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={cursorCollision}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* Always-visible top scrollbar (mirrors the board's scroll range) */}
          <div
            ref={topScrollRef}
            onScroll={() => syncScroll(topScrollRef.current, boardRef.current)}
            className="kanban-scroll overflow-x-scroll overflow-y-hidden"
            aria-hidden="true"
          >
            <div style={{ width: boardScrollWidth }} className="h-px" />
          </div>

          <div
            ref={boardRef}
            onScroll={() => syncScroll(boardRef.current, topScrollRef.current)}
            className="kanban-scroll flex gap-5 overflow-x-scroll pb-4"
          >
            {stages.map((stage) => (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                applications={getApplicationsForStage(stage.id)}
                isOver={overStageId === stage.id}
                showAbsoluteDate={showAbsoluteDate}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null} modifiers={[snapToCursor]}>
            {activeApplication ? (
              <KanbanCardOverlay
                application={activeApplication}
                showAbsoluteDate={showAbsoluteDate}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

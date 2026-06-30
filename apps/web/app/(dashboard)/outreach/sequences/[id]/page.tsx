"use client";

/**
 * Sprint Q4.5 — Nurture sequence builder.
 *
 * Drag-drop reorder of steps via @dnd-kit/sortable. Each step card shows the
 * channel icon, "Wacht X dagen", subject + body preview, AI-personalize
 * toggle, stop_on_reply toggle. Click edit → modal.
 *
 * Sidebar: enrollment counts (active / paused / replied / completed) +
 * synthetic per-step reply-rate KPI.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Bot,
  Calendar,
  Clock,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { AiDisclosureBadge } from "@/components/ai/AiDisclosureBadge";
import {
  useAddStep,
  useDeleteStep,
  useEnrollments,
  useReorderSteps,
  useSequence,
  useUpdateStep,
} from "@/hooks/useNurture";
import {
  CHANNEL_ICON,
  CHANNEL_LABEL,
} from "@/components/sourcing/visualHelpers";
import type {
  NurtureStep,
  OutreachChannel,
} from "@/lib/types/outreach";

const CHANNELS: OutreachChannel[] = [
  "linkedin_inmail",
  "linkedin_connection",
  "email",
  "sms",
  "whatsapp",
];

export default function SequenceBuilderPage() {
  const { t } = useTranslation("outreach");
  const params = useParams();
  const seqId = params?.id as string;
  const { data, isLoading } = useSequence(seqId);
  const { data: enrollments } = useEnrollments({ sequence_id: seqId });
  const reorder = useReorderSteps();
  const addStep = useAddStep();
  const { toast } = useToast();
  const [editStep, setEditStep] = useState<NurtureStep | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const stats = useMemo(() => {
    const e = enrollments ?? [];
    return {
      total: e.length,
      pending: e.filter((x) => x.status === "pending_approval").length,
      active: e.filter((x) => x.status === "active").length,
      paused: e.filter((x) => x.status === "paused").length,
      replied: e.filter((x) => x.status === "replied").length,
      completed: e.filter((x) => x.status === "completed").length,
      stopped: e.filter((x) => x.status === "stopped").length,
    };
  }, [enrollments]);

  if (isLoading || !data) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-12 w-1/3 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  const { sequence, steps } = data;

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = steps.findIndex((s) => s.id === active.id);
    const newIdx = steps.findIndex((s) => s.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(steps, oldIdx, newIdx);
    await reorder.mutateAsync({
      sequenceId: sequence.id,
      orderedIds: reordered.map((s) => s.id),
    });
    toast({ title: t("builder.toasts.reordered") });
  };

  const handleAddStep = async () => {
    const created = await addStep.mutateAsync({
      sequenceId: sequence.id,
      step_order: steps.length + 1,
      channel: "email",
      delay_days: steps.length === 0 ? 0 : 7,
      ai_personalize: true,
      template_subject: "Nieuwe stap",
      template_body: "Hi {first_name},\n\nKorte vraag — ben je open voor een rol?\n\nGroet,\n{recruiter_name}",
      stop_on_reply: true,
    });
    toast({ title: t("builder.toasts.stepAdded") });
    setEditStep(created);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/outreach/sequences"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        {t("builder.backToSequences")}
      </Link>

      <PageHeader
        title={sequence.name}
        description={sequence.description ?? t("builder.noDescription")}
        actions={<AiDisclosureBadge />}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Steps column */}
        <section className="space-y-3">
          {steps.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <p className="text-sm font-medium">{t("builder.steps.empty.title")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("builder.steps.empty.description")}
                </p>
                <Button onClick={handleAddStep} className="mt-2">
                  <Plus className="mr-1.5 h-4 w-4" />
                  {t("builder.steps.addStep")}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={steps.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <ol className="space-y-3">
                  {steps.map((step) => (
                    <SortableStepCard
                      key={step.id}
                      step={step}
                      sequenceId={sequence.id}
                      onEdit={() => setEditStep(step)}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          )}

          <Button
            variant="outline"
            className="w-full border-dashed"
            onClick={handleAddStep}
            disabled={addStep.isPending}
          >
            {addStep.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-4 w-4" />
            )}
            {t("builder.steps.addStep")}
          </Button>
        </section>

        {/* Sidebar */}
        <aside className="space-y-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                {t("builder.enrollments.title")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Stat label={t("builder.enrollments.total")} value={stats.total} />
                <Stat
                  label={t("builder.enrollments.active")}
                  value={stats.active}
                  color="text-emerald-600"
                />
                <Stat
                  label={t("builder.enrollments.paused")}
                  value={stats.paused}
                  color="text-amber-600"
                />
                <Stat
                  label={t("builder.enrollments.replied")}
                  value={stats.replied}
                  color="text-indigo-600"
                />
                <Stat
                  label={t("builder.enrollments.completed")}
                  value={stats.completed}
                  color="text-zinc-500"
                />
                <Stat
                  label={t("builder.enrollments.stopped")}
                  value={stats.stopped}
                  color="text-red-500"
                />
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="space-y-2 p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                {t("builder.replyRate.title")}
              </div>
              {steps.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("builder.replyRate.noData")}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {steps.map((s, i) => {
                    // Synthetic but deterministic reply-rate distribution.
                    const rate = Math.max(
                      4,
                      Math.round(28 - i * 5 + (s.ai_personalize ? 4 : 0))
                    );
                    return (
                      <li
                        key={s.id}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="text-zinc-700 dark:text-zinc-300">
                          {t("builder.replyRate.step", { number: i + 1 })}
                        </span>
                        <div className="flex flex-1 items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                              style={{ width: `${Math.min(100, rate * 2)}%` }}
                            />
                          </div>
                          <span className="w-9 text-right text-muted-foreground">
                            {rate}%
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      <StepEditDialog
        step={editStep}
        sequenceId={sequence.id}
        onClose={() => setEditStep(null)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-zinc-50/60 p-2 dark:bg-zinc-800/30">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-lg font-bold ${color ?? "text-zinc-900 dark:text-zinc-100"}`}>
        {value}
      </p>
    </div>
  );
}

function SortableStepCard({
  step,
  sequenceId,
  onEdit,
}: {
  step: NurtureStep;
  sequenceId: string;
  onEdit: () => void;
}) {
  const { t } = useTranslation("outreach");
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const update = useUpdateStep();
  const remove = useDeleteStep();
  const { toast } = useToast();

  const Icon = CHANNEL_ICON[step.channel];

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style}>
      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-start gap-3 p-4">
          <button
            type="button"
            className="cursor-grab pt-1 text-zinc-400 hover:text-zinc-700 active:cursor-grabbing"
            {...attributes}
            {...listeners}
            aria-label={t("builder.stepCard.moveAria")}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-xs font-semibold text-white">
            {step.step_order}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                <Icon className="h-3 w-3" />
                {CHANNEL_LABEL[step.channel]}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                <Clock className="h-3 w-3" />
                {t("builder.stepCard.waitDays", { count: step.delay_days })}
              </span>
              {step.ai_personalize && (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                  <Bot className="h-3 w-3" />
                  {t("builder.stepCard.aiPersonalizes")}
                </span>
              )}
            </div>
            {step.template_subject && (
              <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                {step.template_subject}
              </p>
            )}
            {step.template_body && (
              <p className="line-clamp-2 text-[11px] text-muted-foreground">
                {step.template_body}
              </p>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <label className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                <Switch
                  checked={step.stop_on_reply}
                  onCheckedChange={async (val) => {
                    await update.mutateAsync({
                      sequenceId,
                      stepId: step.id,
                      patch: { stop_on_reply: val },
                    });
                  }}
                />
                {t("builder.stepCard.stopOnReply")}
              </label>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  onClick={onEdit}
                >
                  {t("builder.stepCard.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-muted-foreground hover:text-red-600"
                  onClick={async () => {
                    await remove.mutateAsync({ sequenceId, stepId: step.id });
                    toast({ title: t("builder.toasts.stepDeleted") });
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function StepEditDialog({
  step,
  sequenceId,
  onClose,
}: {
  step: NurtureStep | null;
  sequenceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("outreach");
  const update = useUpdateStep();
  const { toast } = useToast();

  const [draft, setDraft] = useState<NurtureStep | null>(step);

  // Sync local draft when the step prop changes.
  if (step && (!draft || draft.id !== step.id)) {
    setDraft(step);
  }

  if (!step || !draft) return null;

  return (
    <Dialog
      open={!!step}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("builder.editDialog.title", { order: step.step_order })}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="step-channel">{t("builder.editDialog.channelLabel")}</Label>
            <Select
              value={draft.channel}
              onValueChange={(v) =>
                setDraft({ ...draft, channel: v as OutreachChannel })
              }
            >
              <SelectTrigger id="step-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CHANNEL_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="step-delay">{t("builder.editDialog.delayLabel")}</Label>
            <Input
              id="step-delay"
              type="number"
              min={0}
              value={draft.delay_days}
              onChange={(e) =>
                setDraft({ ...draft, delay_days: Number(e.target.value) })
              }
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="step-subject">{t("builder.editDialog.subjectLabel")}</Label>
            <Input
              id="step-subject"
              value={draft.template_subject ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, template_subject: e.target.value })
              }
              placeholder={t("builder.editDialog.subjectPlaceholder")}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="step-body">{t("builder.editDialog.bodyLabel")}</Label>
            <Textarea
              id="step-body"
              rows={6}
              value={draft.template_body ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, template_body: e.target.value })
              }
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("builder.editDialog.variablesHint", {
                firstName: "{first_name}",
                recruiterName: "{recruiter_name}",
                personalizedOpener: "{personalized_opener}",
              })}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
            <Switch
              checked={draft.ai_personalize}
              onCheckedChange={(val) =>
                setDraft({ ...draft, ai_personalize: val })
              }
            />
            {t("builder.editDialog.aiPersonalizes")}
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
            <Switch
              checked={draft.stop_on_reply}
              onCheckedChange={(val) =>
                setDraft({ ...draft, stop_on_reply: val })
              }
            />
            {t("builder.editDialog.stopOnReply")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            {t("builder.editDialog.cancel")}
          </Button>
          <Button
            disabled={update.isPending}
            onClick={async () => {
              await update.mutateAsync({
                sequenceId,
                stepId: step.id,
                patch: {
                  channel: draft.channel,
                  delay_days: draft.delay_days,
                  template_subject: draft.template_subject,
                  template_body: draft.template_body,
                  ai_personalize: draft.ai_personalize,
                  stop_on_reply: draft.stop_on_reply,
                },
              });
              toast({ title: t("builder.toasts.stepUpdated") });
              onClose();
            }}
          >
            {update.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            {t("builder.editDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

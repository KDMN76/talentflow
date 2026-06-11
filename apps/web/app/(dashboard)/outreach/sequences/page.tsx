"use client";

/**
 * Sprint Q4.5 — Nurture sequence list.
 *
 * Card grid per sequence with name, step count, active toggle, and click →
 * `[id]/page.tsx` for the builder.
 */

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowRight, Loader2, Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  useArchiveSequence,
  useCreateSequence,
  useSequences,
  useUpdateSequence,
} from "@/hooks/useNurture";

export default function SequencesListPage() {
  const { t } = useTranslation("outreach");
  const { data, isLoading } = useSequences();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("sequences.title")}
        description={t("sequences.description")}
        actions={
          <div className="flex items-center gap-2">
            <AiDisclosureBadge />
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t("sequences.newSequence")}
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-500 dark:bg-indigo-950/40">
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium">{t("sequences.empty.title")}</p>
            <p className="text-xs text-muted-foreground">
              {t("sequences.empty.description")}
            </p>
            <Button onClick={() => setCreateOpen(true)} className="mt-2">
              <Plus className="mr-1.5 h-4 w-4" />
              {t("sequences.newSequence")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((seq) => (
            <SequenceCard key={seq.id} sequence={seq} />
          ))}
        </div>
      )}

      <CreateSequenceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function SequenceCard({
  sequence,
}: {
  sequence: import("@/lib/types/outreach").NurtureSequence;
}) {
  const { t } = useTranslation("outreach");
  const update = useUpdateSequence();
  const archive = useArchiveSequence();
  const { toast } = useToast();
  return (
    <Card className="group border-0 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {sequence.name}
            </p>
            <p className="line-clamp-2 text-[11px] text-muted-foreground">
              {sequence.description ?? t("sequences.noDescription")}
            </p>
          </div>
          <Switch
            checked={sequence.active}
            onCheckedChange={async (val) => {
              if (val) {
                await update.mutateAsync({
                  id: sequence.id,
                  patch: { active: true },
                });
                toast({ title: t("sequences.toasts.activated") });
              } else {
                await archive.mutateAsync(sequence.id);
                toast({ title: t("sequences.toasts.paused") });
              }
            }}
          />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {t("sequences.steps", { count: sequence.total_steps })}
          </span>
          {sequence.active ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {t("sequences.active")}
            </span>
          ) : (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {t("sequences.archived")}
            </span>
          )}
        </div>
        <Link
          href={`/outreach/sequences/${sequence.id}`}
          className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
        >
          {t("sequences.openBuilder")}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}

function CreateSequenceDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("outreach");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useCreateSequence();
  const { toast } = useToast();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sequences.createDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="seq-name">{t("sequences.createDialog.nameLabel")}</Label>
            <Input
              id="seq-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("sequences.createDialog.namePlaceholder")}
            />
          </div>
          <div>
            <Label htmlFor="seq-desc">
              {t("sequences.createDialog.descriptionLabel")}
            </Label>
            <Textarea
              id="seq-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("sequences.createDialog.cancel")}
          </Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={async () => {
              await create.mutateAsync({
                name: name.trim(),
                description: description.trim() || undefined,
              });
              toast({ title: t("sequences.toasts.created") });
              setName("");
              setDescription("");
              onClose();
            }}
          >
            {create.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            {t("sequences.createDialog.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

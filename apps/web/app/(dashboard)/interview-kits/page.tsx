"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  Edit3,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useCreateInterviewKit,
  useDeleteInterviewKit,
  useInterviewKits,
} from "@/hooks/useInterviewKits";
import { useJobs } from "@/hooks/useJobs";
import { useScorecardTemplates } from "@/hooks/useScorecards";
import type { InterviewKit } from "@/lib/types/interviews";

export default function InterviewKitsPage() {
  const { t } = useTranslation("interviewKits");
  const router = useRouter();
  const { toast } = useToast();
  const { data: kits, isLoading, isError, error } = useInterviewKits();
  const { data: jobs } = useJobs();
  const { data: scorecardTemplates } = useScorecardTemplates();
  const create = useCreateInterviewKit();
  const remove = useDeleteInterviewKit();
  const [createOpen, setCreateOpen] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [jobId, setJobId] = useState<string>("none");
  const [scorecardId, setScorecardId] = useState<string>("none");

  const handleCreate = async () => {
    if (!name.trim()) return;
    const kit = await create.mutateAsync({
      name: name.trim(),
      description: description.trim() || null,
      job_id: jobId === "none" ? null : jobId,
      scorecard_template_id: scorecardId === "none" ? null : scorecardId,
      questions: [],
    });
    toast({ title: t("list.toasts.created"), description: kit.name });
    setCreateOpen(false);
    setName("");
    setDescription("");
    setJobId("none");
    setScorecardId("none");
    router.push(`/interview-kits/${kit.id}`);
  };

  const handleDelete = async (kit: InterviewKit) => {
    if (!confirm(t("list.confirmDelete", { name: kit.name }))) return;
    await remove.mutateAsync(kit.id);
    toast({ title: t("list.toasts.deleted"), description: kit.name });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("list.header.title")}
        description={t("list.header.description")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("list.newKit")}
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-rose-600">
              {t("list.error.title")}
            </p>
            {error instanceof Error && (
              <p className="mt-1 text-xs text-muted-foreground">
                {error.message}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (kits ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/50 mx-auto" />
            <p className="text-sm font-medium text-muted-foreground mt-3">
              {t("list.empty.description")}
            </p>
            <Button onClick={() => setCreateOpen(true)} size="sm" className="mt-4">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {t("list.empty.createFirst")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(kits ?? []).map((kit) => (
            <KitCard
              key={kit.id}
              kit={kit}
              onDelete={() => handleDelete(kit)}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("list.createDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("list.createDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="kit-name">{t("list.createDialog.nameLabel")}</Label>
              <Input
                id="kit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("list.createDialog.namePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kit-desc">
                {t("list.createDialog.descriptionLabel")}
              </Label>
              <Input
                id="kit-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("list.createDialog.descriptionPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("list.createDialog.jobLabel")}</Label>
              <Select value={jobId} onValueChange={setJobId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {t("list.createDialog.jobGeneric")}
                  </SelectItem>
                  {(jobs ?? []).map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("list.createDialog.scorecardLabel")}</Label>
              <Select value={scorecardId} onValueChange={setScorecardId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {t("list.createDialog.scorecardNone")}
                  </SelectItem>
                  {(scorecardTemplates ?? []).map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("list.createDialog.cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || create.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {create.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t("list.createDialog.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KitCard({
  kit,
  onDelete,
}: {
  kit: InterviewKit;
  onDelete: () => void;
}) {
  const { t } = useTranslation("interviewKits");
  const totalDuration = kit.questions.reduce(
    (sum, q) => sum + q.expected_duration_minutes,
    0
  );
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-purple-500" />
            {kit.name}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Link href={`/interview-kits/${kit.id}`}>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {kit.description && (
          <CardDescription className="line-clamp-2">
            {kit.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {kit.job_id && kit.job_title ? (
            <Badge variant="info" className="text-[10px]">
              <Briefcase className="h-2.5 w-2.5 mr-1" />
              {kit.job_title}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              {t("list.card.generic")}
            </Badge>
          )}
          {kit.scorecard_template_name && (
            <Badge variant="secondary" className="text-[10px]">
              <Sparkles className="h-2.5 w-2.5 mr-1" />
              {kit.scorecard_template_name}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("list.card.questions", { count: kit.questions.length })} ·{" "}
          {totalDuration > 0
            ? t("list.card.duration", { count: totalDuration })
            : t("list.card.noDuration")}
        </p>
      </CardContent>
    </Card>
  );
}

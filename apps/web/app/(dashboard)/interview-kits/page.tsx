"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { mockJobs, mockScorecardTemplates } from "@/lib/mockData";
import type { InterviewKit } from "@/lib/types/interviews";

export default function InterviewKitsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data: kits, isLoading } = useInterviewKits();
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
    toast({ title: "Kit aangemaakt", description: kit.name });
    setCreateOpen(false);
    setName("");
    setDescription("");
    setJobId("none");
    setScorecardId("none");
    router.push(`/interview-kits/${kit.id}`);
  };

  const handleDelete = async (kit: InterviewKit) => {
    if (!confirm(`Weet je zeker dat je "${kit.name}" wilt verwijderen?`)) return;
    await remove.mutateAsync(kit.id);
    toast({ title: "Kit verwijderd", description: kit.name });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interview kits"
        description="Beheer herbruikbare interview-kits — vragen, follow-ups en gekoppelde scorecard-templates."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nieuwe kit
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : (kits ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/50 mx-auto" />
            <p className="text-sm font-medium text-muted-foreground mt-3">
              Nog geen interview-kits.
            </p>
            <Button onClick={() => setCreateOpen(true)} size="sm" className="mt-4">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Maak je eerste kit
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
            <DialogTitle>Nieuwe interview kit</DialogTitle>
            <DialogDescription>
              Vul de basisinfo in. Vragen voeg je toe op de detailpagina.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="kit-name">Naam *</Label>
              <Input
                id="kit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="bv. Senior FE Tech Interview"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kit-desc">Beschrijving</Label>
              <Input
                id="kit-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Korte uitleg waar deze kit voor bedoeld is"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Vacature (optioneel)</Label>
              <Select value={jobId} onValueChange={setJobId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Generiek (geen vacature)</SelectItem>
                  {mockJobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Scorecard-template (optioneel)</Label>
              <Select value={scorecardId} onValueChange={setScorecardId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Geen template</SelectItem>
                  {mockScorecardTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Annuleren
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || create.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {create.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Aanmaken
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
              Generiek
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
          {kit.questions.length}{" "}
          {kit.questions.length === 1 ? "vraag" : "vragen"} ·{" "}
          {totalDuration > 0 ? `~${totalDuration} min` : "geen duur"}
        </p>
      </CardContent>
    </Card>
  );
}

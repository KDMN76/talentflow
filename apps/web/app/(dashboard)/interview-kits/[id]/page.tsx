"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Clock,
  GripVertical,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  useInterviewKit,
  useUpdateInterviewKit,
} from "@/hooks/useInterviewKits";
import { useJobs } from "@/hooks/useJobs";
import { useScorecardTemplates } from "@/hooks/useScorecards";
import type {
  InterviewQuestion,
  InterviewQuestionCategory,
} from "@/lib/types/interviews";

const CATEGORIES: Array<{
  value: InterviewQuestionCategory;
  label: string;
  cls: string;
}> = [
  {
    value: "behavioral",
    label: "Behavioral",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  {
    value: "technical",
    label: "Technisch",
    cls: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
  },
  {
    value: "culture",
    label: "Cultuur",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  {
    value: "experience",
    label: "Ervaring",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  {
    value: "scenario",
    label: "Scenario",
    cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  },
];

interface DraftQuestion {
  id: string;
  text: string;
  category: InterviewQuestionCategory;
  suggested_followups: string[];
  evaluation_criteria: string;
  expected_duration_minutes: number;
}

function questionToDraft(q: InterviewQuestion): DraftQuestion {
  return {
    id: q.id,
    text: q.text,
    category: q.category,
    suggested_followups: [...q.suggested_followups],
    evaluation_criteria: q.evaluation_criteria ?? "",
    expected_duration_minutes: q.expected_duration_minutes,
  };
}

export default function InterviewKitDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const { data: kit, isLoading } = useInterviewKit(params.id);
  const { data: jobs } = useJobs();
  const { data: scorecardTemplates } = useScorecardTemplates();
  const update = useUpdateInterviewKit(params.id);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [jobId, setJobId] = useState<string>("none");
  const [scorecardId, setScorecardId] = useState<string>("none");
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);

  // Hydrate when kit arrives.
  useEffect(() => {
    if (!kit) return;
    setName(kit.name);
    setDescription(kit.description ?? "");
    setJobId(kit.job_id ?? "none");
    setScorecardId(kit.scorecard_template_id ?? "none");
    setQuestions(kit.questions.map(questionToDraft));
  }, [kit]);

  const totalDuration = useMemo(
    () =>
      questions.reduce((sum, q) => sum + (q.expected_duration_minutes || 0), 0),
    [questions]
  );

  const addQuestion = () =>
    setQuestions((cur) => [
      ...cur,
      {
        id: `q-new-${Date.now()}-${cur.length}`,
        text: "",
        category: "behavioral",
        suggested_followups: [],
        evaluation_criteria: "",
        expected_duration_minutes: 10,
      },
    ]);

  const removeQuestion = (id: string) =>
    setQuestions((cur) => cur.filter((q) => q.id !== id));

  const updateQuestion = (id: string, patch: Partial<DraftQuestion>) =>
    setQuestions((cur) =>
      cur.map((q) => (q.id === id ? { ...q, ...patch } : q))
    );

  const move = (id: string, dir: -1 | 1) => {
    setQuestions((cur) => {
      const idx = cur.findIndex((q) => q.id === id);
      if (idx === -1) return cur;
      const j = idx + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({
        variant: "destructive",
        title: "Naam is verplicht",
      });
      return;
    }
    await update.mutateAsync({
      name: name.trim(),
      description: description.trim() || null,
      job_id: jobId === "none" ? null : jobId,
      scorecard_template_id: scorecardId === "none" ? null : scorecardId,
      questions: questions.map((q) => ({
        id: q.id,
        text: q.text,
        category: q.category,
        suggested_followups: q.suggested_followups.filter((f) => f.trim()),
        evaluation_criteria: q.evaluation_criteria || null,
        expected_duration_minutes: q.expected_duration_minutes,
      })),
    });
    toast({ title: "Kit opgeslagen", description: name });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!kit) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">Kit niet gevonden.</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => router.push("/interview-kits")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Terug naar overzicht
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/interview-kits"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-zinc-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Terug naar kits
      </Link>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{name || "Naamloze kit"}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {questions.length} vragen · ~{totalDuration} min totaal
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={update.isPending}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          {update.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Opslaan
        </Button>
      </div>

      {/* Basics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basisgegevens</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="kit-name">Naam</Label>
            <Input
              id="kit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="kit-desc">Beschrijving</Label>
            <Input
              id="kit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Korte uitleg over wanneer deze kit te gebruiken"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Vacature</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Generiek</SelectItem>
                {(jobs ?? []).map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Scorecard-template</Label>
            <Select value={scorecardId} onValueChange={setScorecardId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Geen template</SelectItem>
                {(scorecardTemplates ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Questions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Vragen ({questions.length})</CardTitle>
          <Button onClick={addQuestion} size="sm">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Vraag toevoegen
          </Button>
        </CardHeader>
        <CardContent>
          {questions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nog geen vragen. Klik op "Vraag toevoegen" om te beginnen.
            </div>
          ) : (
            <div className="space-y-3">
              {questions.map((q, i) => (
                <QuestionEditor
                  key={q.id}
                  q={q}
                  index={i}
                  total={questions.length}
                  onChange={(patch) => updateQuestion(q.id, patch)}
                  onRemove={() => removeQuestion(q.id)}
                  onMoveUp={() => move(q.id, -1)}
                  onMoveDown={() => move(q.id, 1)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function QuestionEditor({
  q,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  q: DraftQuestion;
  index: number;
  total: number;
  onChange: (p: Partial<DraftQuestion>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [followupDraft, setFollowupDraft] = useState("");
  const cat = CATEGORIES.find((c) => c.value === q.category);

  const addFollowup = () => {
    const v = followupDraft.trim();
    if (!v) return;
    onChange({ suggested_followups: [...q.suggested_followups, v] });
    setFollowupDraft("");
  };

  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center text-muted-foreground pt-1.5 shrink-0">
          <GripVertical className="h-4 w-4 opacity-50" />
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="hover:text-zinc-900 disabled:opacity-30"
            aria-label="Omhoog"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="hover:text-zinc-900 disabled:opacity-30"
            aria-label="Omlaag"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>
        <span className="rounded-md bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 h-7 w-7 flex items-center justify-center text-xs font-bold shrink-0">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0 space-y-2.5">
          <textarea
            value={q.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Wat is je vraag?"
            rows={2}
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Categorie</Label>
              <Select
                value={q.category}
                onValueChange={(v) =>
                  onChange({ category: v as InterviewQuestionCategory })
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Verwachte duur (min)</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={q.expected_duration_minutes}
                onChange={(e) =>
                  onChange({
                    expected_duration_minutes: Number(e.target.value) || 0,
                  })
                }
                className="h-9"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Beoordelingscriteria</Label>
            <Input
              value={q.evaluation_criteria}
              onChange={(e) => onChange({ evaluation_criteria: e.target.value })}
              placeholder="bv. Diepgang, helderheid van uitleg, structuur"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Suggested follow-ups</Label>
            <div className="flex gap-2">
              <Input
                value={followupDraft}
                onChange={(e) => setFollowupDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addFollowup();
                  }
                }}
                placeholder="Voeg een vervolgvraag toe en druk op Enter"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addFollowup}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            {q.suggested_followups.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {q.suggested_followups.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-md bg-zinc-50 dark:bg-zinc-900/40 px-2.5 py-1.5 text-xs"
                  >
                    <span className="text-indigo-500">↳</span>
                    <span className="flex-1 min-w-0">{f}</span>
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          suggested_followups: q.suggested_followups.filter(
                            (_, j) => j !== i
                          ),
                        })
                      }
                      className="text-muted-foreground hover:text-rose-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {cat && (
            <Badge
              className={`text-[10px] uppercase ${cat.cls} border-transparent`}
            >
              {cat.label}
            </Badge>
          )}
          <span className="inline-flex items-center text-[10px] text-muted-foreground gap-1">
            <Clock className="h-3 w-3" />~{q.expected_duration_minutes}m
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

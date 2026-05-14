"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Star, MessageSquare, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateScorecard,
  useScorecardTemplates,
  useScorecardsForApplication,
} from "@/hooks/useScorecards";
import { useToast } from "@/components/ui/use-toast";
import { cn, getInitials } from "@/lib/utils";
import type {
  Scorecard,
  ScorecardCriterion,
  ScorecardRecommendation,
  ScorecardTemplate,
} from "@/lib/types/atsExtensions";

const RECOMMENDATIONS: Array<{ value: ScorecardRecommendation; label: string; tone: string }> = [
  { value: "strong_yes", label: "Strong Yes", tone: "bg-emerald-600 hover:bg-emerald-700 text-white" },
  { value: "yes", label: "Yes", tone: "bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" },
  { value: "neutral", label: "Neutral", tone: "bg-zinc-100 hover:bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300" },
  { value: "no", label: "No", tone: "bg-rose-100 hover:bg-rose-200 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300" },
  { value: "strong_no", label: "Strong No", tone: "bg-rose-600 hover:bg-rose-700 text-white" },
];

const REC_DOT: Record<ScorecardRecommendation, string> = {
  strong_yes: "bg-emerald-600",
  yes: "bg-emerald-400",
  neutral: "bg-zinc-400",
  no: "bg-rose-400",
  strong_no: "bg-rose-600",
};

interface ScorecardFormProps {
  applicationId: string;
  jobId?: string;
  stageId?: string;
}

export function ScorecardForm({ applicationId, jobId, stageId }: ScorecardFormProps) {
  const { toast } = useToast();
  const existing = useScorecardsForApplication(applicationId);
  const templates = useScorecardTemplates({ jobId, stageId });
  const create = useCreateScorecard(applicationId);

  const tmpls = templates.data ?? [];
  const [templateId, setTemplateId] = useState<string>("");
  const [criteria, setCriteria] = useState<ScorecardCriterion[]>([]);
  const [recommendation, setRecommendation] = useState<ScorecardRecommendation>("neutral");
  const [notes, setNotes] = useState("");

  // Default-select the first template once they load.
  useEffect(() => {
    if (templateId === "" && tmpls.length > 0) {
      setTemplateId(tmpls[0].id);
    }
  }, [tmpls, templateId]);

  // When the chosen template changes, rebuild the criteria scaffold.
  useEffect(() => {
    const tmpl = tmpls.find((t) => t.id === templateId);
    if (!tmpl) return;
    setCriteria(
      tmpl.criteria.map((c) => ({
        key: c.key,
        label: c.label,
        description: c.description ?? null,
        score: null,
      }))
    );
  }, [templateId, tmpls]);

  const overallScore = useMemo(() => {
    const scored = criteria.filter((c): c is ScorecardCriterion & { score: number } => c.score != null);
    if (scored.length === 0) return 0;
    return Number(
      (scored.reduce((sum, c) => sum + c.score, 0) / scored.length).toFixed(2)
    );
  }, [criteria]);

  const allScored = criteria.length > 0 && criteria.every((c) => c.score != null);

  const handleScore = (key: string, score: number) => {
    setCriteria((cur) => cur.map((c) => (c.key === key ? { ...c, score } : c)));
  };

  const handleSubmit = async () => {
    if (!allScored) return;
    try {
      await create.mutateAsync({
        template_id: templateId || null,
        criteria: criteria.map((c) => ({ key: c.key, label: c.label, score: c.score })),
        overall_score: overallScore,
        recommendation,
        notes: notes.trim() || null,
      });
      toast({
        title: "Scorecard opgeslagen",
        description: `Aanbeveling: ${RECOMMENDATIONS.find((r) => r.value === recommendation)?.label}`,
      });
      setNotes("");
      setCriteria((cur) => cur.map((c) => ({ ...c, score: null })));
      setRecommendation("neutral");
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Kon scorecard niet opslaan.",
      });
    }
  };

  const others = existing.data ?? [];

  return (
    <div className="space-y-5">
      {/* My scorecard form */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" />
            Jouw scorecard
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {tmpls.length > 0 && (
            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue placeholder="Kies een template" />
                </SelectTrigger>
                <SelectContent>
                  {tmpls.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-3">
            {criteria.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {c.label}
                    </p>
                    {c.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
                    )}
                  </div>
                </div>
                <ScoreScale value={c.score} onChange={(v) => handleScore(c.key, v)} />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3">
            <span className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
              Gemiddelde score
            </span>
            <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {overallScore.toFixed(2)}
            </span>
          </div>

          <div className="space-y-2">
            <Label>Aanbeveling</Label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {RECOMMENDATIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRecommendation(r.value)}
                  className={cn(
                    "rounded-md px-2 py-2 text-xs font-semibold transition-all border-2",
                    recommendation === r.value
                      ? `${r.tone} border-transparent shadow-sm`
                      : "bg-background border-border text-muted-foreground hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sc-notes">Notities</Label>
            <textarea
              id="sc-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Korte motivatie van je beoordeling..."
              className="flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-none"
            />
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={!allScored || create.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 border-0"
            >
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Scorecard opslaan
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Existing scorecards from other interviewers */}
      {others.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-indigo-500" />
              Beoordelingen van andere interviewers ({others.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {others.map((sc) => (
              <ExistingScorecard key={sc.id} sc={sc} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Agreement matrix */}
      {others.length >= 2 && criteria.length > 0 && (
        <AgreementMatrix
          others={others}
          myCriteria={criteria}
          template={tmpls.find((t) => t.id === templateId) ?? null}
        />
      )}
    </div>
  );
}

function ScoreScale({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      {[1, 2, 3, 4, 5].map((n) => {
        const selected = value === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              "h-9 w-9 rounded-md border-2 text-sm font-semibold transition-all",
              selected
                ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                : "bg-background border-border text-muted-foreground hover:border-indigo-300"
            )}
            aria-label={`Score ${n}`}
          >
            {n}
          </button>
        );
      })}
      <span className="ml-2 text-xs text-muted-foreground">
        {value === null ? "Nog niet beoordeeld" : `${value}/5`}
      </span>
    </div>
  );
}

function ExistingScorecard({ sc }: { sc: Scorecard }) {
  const rec = RECOMMENDATIONS.find((r) => r.value === sc.recommendation);
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-3">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-semibold">
            {getInitials(sc.user_name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{sc.user_name}</p>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] uppercase tracking-wide font-bold rounded-md",
                rec?.tone ?? "bg-zinc-100 text-zinc-700"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", REC_DOT[sc.recommendation])} />
              {rec?.label ?? sc.recommendation}
            </span>
            <span className="ml-auto text-sm font-bold text-indigo-600 dark:text-indigo-400">
              {sc.overall_score.toFixed(1)}/5
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {sc.criteria.map((c) => (
              <div key={c.key} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-zinc-50 dark:bg-zinc-800/50">
                <span className="truncate text-muted-foreground">{c.label}</span>
                <span className="font-semibold ml-2">{c.score ?? "—"}</span>
              </div>
            ))}
          </div>
          {sc.notes && (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <p className="leading-relaxed">{sc.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Agreement Matrix
 * ────────────────
 * Toont per criterium een rij met cellen voor elke interviewer (incl. mij).
 * Visueel:
 *  - cijfer + 1..5 stippen, ingekleurd op 5-punts scale
 *  - bij divergentie ≥ 2 punten met de groepsgemiddelde: oranje rand + ⚠
 *  - mijn-cell krijgt een blauwe ring zodat je hem terugvindt
 *  - top-row: gemiddelde overall + spread (max-min)
 */
function AgreementMatrix({
  others,
  myCriteria,
  template,
}: {
  others: Scorecard[];
  myCriteria: ScorecardCriterion[];
  template: ScorecardTemplate | null;
}) {
  // Build the canonical criterion-list. Prefer the template (so order is
  // deterministic). Fall back to the union of keys across all sources.
  const criterionList: Array<{ key: string; label: string }> = template
    ? template.criteria.map((c) => ({ key: c.key, label: c.label }))
    : Array.from(
        new Map(
          [
            ...myCriteria.map((c) => [c.key, c.label] as const),
            ...others.flatMap((s) => s.criteria.map((c) => [c.key, c.label] as const)),
          ]
        ).entries()
      ).map(([key, label]) => ({ key, label }));

  const reviewers = [
    { user_name: "Jij", scorecard: { criteria: myCriteria } as Pick<Scorecard, "criteria"> },
    ...others.map((s) => ({ user_name: s.user_name, scorecard: s })),
  ];

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-amber-500" />
          Agreement matrix
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Vergelijk per criterium hoe interviewers hebben gescoord. Cellen met een
          afwijking van ≥ 2 punten ten opzichte van het gemiddelde worden
          gemarkeerd.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-muted-foreground font-medium px-2 py-2">
                Criterium
              </th>
              {reviewers.map((r, i) => (
                <th
                  key={i}
                  className={cn(
                    "text-center text-muted-foreground font-medium px-2 py-2",
                    i === 0 && "text-indigo-600 dark:text-indigo-400 font-semibold"
                  )}
                >
                  {r.user_name}
                </th>
              ))}
              <th className="text-center text-muted-foreground font-medium px-2 py-2">
                Gem.
              </th>
              <th className="text-center text-muted-foreground font-medium px-2 py-2">
                Spread
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {criterionList.map(({ key, label }) => {
              const scores = reviewers.map((r) => {
                const found = r.scorecard.criteria.find((c) => c.key === key);
                return found?.score ?? null;
              });
              const valid = scores.filter((s): s is number => typeof s === "number");
              const avg = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
              const spread = valid.length > 0 ? Math.max(...valid) - Math.min(...valid) : 0;
              return (
                <tr key={key}>
                  <td className="px-2 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                    {label}
                  </td>
                  {scores.map((s, i) => {
                    const diverges = s !== null && Math.abs(s - avg) >= 2 && valid.length >= 2;
                    return (
                      <td key={i} className="px-2 py-2 text-center">
                        {s === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold",
                              i === 0 && "ring-2 ring-indigo-400 ring-offset-1 dark:ring-offset-zinc-900",
                              diverges
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                                : s >= 4
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  : s <= 2
                                    ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            )}
                          >
                            {s}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-center font-semibold text-indigo-600 dark:text-indigo-400">
                    {avg > 0 ? avg.toFixed(1) : "—"}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold",
                        spread >= 2
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          : spread === 1
                            ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      )}
                    >
                      {spread > 0 ? `±${spread}` : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

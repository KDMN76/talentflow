"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, RefreshCcw, Search, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  useCandidateSkillProfile,
  useEscoSearch,
  useJobSkillProfile,
  useSyncCandidateEsco,
  useSyncJobEsco,
  useUpdateCandidateSkillProfile,
} from "@/hooks/useSkills";
import { cn } from "@/lib/utils";
import type {
  EscoCategory,
  EscoSkill,
  JobSkillRequirementLevel,
  ProfileSkill,
} from "@/lib/types/skills";

// ─── Shared helpers ──────────────────────────────────────────────────────────

const CATEGORY_COPY: Record<
  EscoCategory,
  { label: string; cls: string }
> = {
  technical: {
    label: "Technisch",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  tool: {
    label: "Tool",
    cls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  },
  soft: {
    label: "Soft skill",
    cls: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
  },
  language: {
    label: "Taal",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  certification: {
    label: "Certificering",
    cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  },
  domain: {
    label: "Domein",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
};

export function CategoryBadge({ category }: { category: EscoCategory }) {
  const cfg = CATEGORY_COPY[category] ?? CATEGORY_COPY.technical;
  return (
    <Badge
      variant="secondary"
      className={cn("text-[10px] px-1.5 py-0 border-0", cfg.cls)}
    >
      {cfg.label}
    </Badge>
  );
}

function ConfidenceDot({ confidence }: { confidence: number }) {
  const exact = confidence >= 0.95;
  return (
    <span
      title={
        exact
          ? "Exacte ESCO-match"
          : `Embedding-match (${Math.round(confidence * 100)}% similarity)`
      }
      aria-label={
        exact
          ? "Exacte ESCO-match"
          : `Embedding-match ${Math.round(confidence * 100)}%`
      }
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        exact ? "bg-emerald-500" : "bg-zinc-400"
      )}
    />
  );
}

// ─── ESCO autocomplete input ─────────────────────────────────────────────────

export interface EscoAutocompleteProps {
  placeholder?: string;
  excludeIds?: Set<string>;
  onPick: (skill: EscoSkill) => void;
}

export function EscoAutocomplete({
  placeholder = "Zoek skill in ESCO-database...",
  excludeIds,
  onPick,
}: EscoAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // 250ms debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function handler(ev: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(ev.target as Node)
      ) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, []);

  const { data: results, isFetching } = useEscoSearch({
    q: debounced,
    limit: 12,
  });

  const filtered = useMemo(() => {
    if (!results) return [];
    if (!excludeIds) return results;
    return results.filter((r) => !excludeIds.has(r.id));
  }, [results, excludeIds]);

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          className="pl-9"
        />
      </div>
      {open && (debounced.length > 0 || isFetching) && (
        <div
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
        >
          {isFetching && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Zoeken...
            </div>
          )}
          {!isFetching && filtered.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              Geen ESCO-matches voor &ldquo;{debounced}&rdquo;.
            </div>
          )}
          {!isFetching &&
            filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                role="option"
                onClick={() => {
                  onPick(s);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {s.preferred_label}
                    </span>
                    <CategoryBadge category={s.category} />
                  </div>
                  {s.description && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {s.description}
                    </p>
                  )}
                </div>
                <Plus className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Candidate skill-profile editor ──────────────────────────────────────────

export interface SkillProfileEditorProps {
  candidateId: string;
}

export function SkillProfileEditor({ candidateId }: SkillProfileEditorProps) {
  const { data, isLoading } = useCandidateSkillProfile(candidateId);
  const updateProfile = useUpdateCandidateSkillProfile();
  const syncEsco = useSyncCandidateEsco();
  const { toast } = useToast();

  // Local draft state derived from server profile.
  const [draft, setDraft] = useState<ProfileSkill[]>([]);
  useEffect(() => {
    if (data) setDraft(data.skills);
  }, [data]);

  const dirty = useMemo(() => {
    if (!data) return false;
    if (data.skills.length !== draft.length) return true;
    return data.skills.some((srv, i) => {
      const local = draft[i];
      if (!local) return true;
      return (
        srv.id !== local.id || srv.proficiency !== local.proficiency
      );
    });
  }, [data, draft]);

  const excludedIds = useMemo(
    () =>
      new Set(
        draft.map((s) => s.esco_id).filter((id): id is string => !!id)
      ),
    [draft]
  );

  const handleAddEsco = (skill: EscoSkill) => {
    const next: ProfileSkill = {
      id: `local-${skill.id}-${Date.now()}`,
      esco_id: skill.id,
      esco_uri: skill.esco_uri,
      preferred_label: skill.preferred_label,
      category: skill.category,
      proficiency: 5,
      source: "esco_match",
      confidence: 1,
    };
    setDraft((cur) => [...cur, next]);
  };

  const handleRemove = (id: string) => {
    setDraft((cur) => cur.filter((s) => s.id !== id));
  };

  const handleProficiency = (id: string, value: number) => {
    setDraft((cur) =>
      cur.map((s) => (s.id === id ? { ...s, proficiency: value } : s))
    );
  };

  const handleSave = async () => {
    try {
      await updateProfile.mutateAsync({ candidateId, skills: draft });
      toast({
        title: "Skill-profiel opgeslagen",
        description: `${draft.length} skills bijgewerkt.`,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Skill-profiel kon niet worden opgeslagen.",
      });
    }
  };

  const handleResync = async () => {
    try {
      await syncEsco.mutateAsync(candidateId);
      toast({
        title: "Skills opnieuw gemapped",
        description: "Skills zijn opnieuw gekoppeld aan de ESCO-database.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Re-sync mislukt.",
      });
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Skill-profiel</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Skills gemapped naar de Europese ESCO-taxonomie.
            {data?.last_synced_at && (
              <>
                {" "}
                Laatste sync:{" "}
                {new Date(data.last_synced_at).toLocaleDateString("nl-NL")}.
              </>
            )}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleResync}
          disabled={syncEsco.isPending}
          className="shrink-0"
        >
          {syncEsco.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Re-sync ESCO
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <Skeleton className="h-32 w-full" />}

        {!isLoading && draft.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            Nog geen skills — voeg er hieronder een toe.
          </p>
        )}

        {!isLoading && draft.length > 0 && (
          <div className="space-y-2">
            {draft.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-md border border-border/60 bg-background px-3 py-2.5"
              >
                <ConfidenceDot confidence={s.confidence} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {s.preferred_label}
                    </span>
                    <CategoryBadge category={s.category} />
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Label className="text-[10px] text-muted-foreground">
                    Niveau
                  </Label>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={s.proficiency}
                    onChange={(e) =>
                      handleProficiency(s.id, Number(e.target.value))
                    }
                    className="h-1.5 w-24 accent-indigo-600"
                    aria-label={`Niveau voor ${s.preferred_label}`}
                  />
                  <span className="text-xs font-semibold tabular-nums w-7 text-right">
                    {s.proficiency}/10
                  </span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(s.id)}
                  title="Verwijderen"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2 pt-2 border-t border-border">
          <Label className="text-xs">Skill toevoegen</Label>
          <EscoAutocomplete onPick={handleAddEsco} excludeIds={excludedIds} />
        </div>

        {dirty && (
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => data && setDraft(data.skills)}
              disabled={updateProfile.isPending}
            >
              Annuleren
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updateProfile.isPending}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
            >
              {updateProfile.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Opslaan
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Job skills editor (controlled) ──────────────────────────────────────────
//
// JobForm is a "create" form so we keep this as a stand-alone controlled
// component that can be embedded in either a create- or edit-flow. It
// pre-populates from the server when a `jobId` is supplied (edit mode).

export interface JobSkillsEditorProps {
  /** When provided, fetches the existing profile for pre-population. */
  jobId?: string;
  required: ProfileSkill[];
  niceToHave: ProfileSkill[];
  onChange: (next: {
    required: ProfileSkill[];
    niceToHave: ProfileSkill[];
  }) => void;
  onResync?: () => void;
}

export function JobSkillsEditor({
  jobId,
  required,
  niceToHave,
  onChange,
  onResync,
}: JobSkillsEditorProps) {
  const { data, isLoading } = useJobSkillProfile(jobId);
  const syncEsco = useSyncJobEsco();
  const { toast } = useToast();

  // Initial population (only once when remote profile arrives).
  const populatedRef = useRef(false);
  useEffect(() => {
    if (!data || populatedRef.current) return;
    populatedRef.current = true;
    if (required.length === 0 && niceToHave.length === 0) {
      const reqs = data.skills
        .filter((s) => s.requirement === "required")
        .map<ProfileSkill>((s) => ({
          id: s.id,
          esco_id: s.esco_id,
          esco_uri: s.esco_uri,
          preferred_label: s.preferred_label,
          category: s.category,
          proficiency: s.min_proficiency,
          source: s.source,
          confidence: s.confidence,
        }));
      const nice = data.skills
        .filter((s) => s.requirement === "nice_to_have")
        .map<ProfileSkill>((s) => ({
          id: s.id,
          esco_id: s.esco_id,
          esco_uri: s.esco_uri,
          preferred_label: s.preferred_label,
          category: s.category,
          proficiency: s.min_proficiency,
          source: s.source,
          confidence: s.confidence,
        }));
      onChange({ required: reqs, niceToHave: nice });
    }
  }, [data, required.length, niceToHave.length, onChange]);

  const excludedIds = useMemo(() => {
    return new Set(
      [...required, ...niceToHave]
        .map((s) => s.esco_id)
        .filter((id): id is string => !!id)
    );
  }, [required, niceToHave]);

  const handleAdd = (
    bucket: JobSkillRequirementLevel,
    skill: EscoSkill
  ) => {
    const next: ProfileSkill = {
      id: `local-${skill.id}-${Date.now()}`,
      esco_id: skill.id,
      esco_uri: skill.esco_uri,
      preferred_label: skill.preferred_label,
      category: skill.category,
      proficiency: bucket === "required" ? 7 : 5,
      source: "esco_match",
      confidence: 1,
    };
    if (bucket === "required") {
      onChange({ required: [...required, next], niceToHave });
    } else {
      onChange({ required, niceToHave: [...niceToHave, next] });
    }
  };

  const handleRemove = (
    bucket: JobSkillRequirementLevel,
    id: string
  ) => {
    if (bucket === "required") {
      onChange({
        required: required.filter((s) => s.id !== id),
        niceToHave,
      });
    } else {
      onChange({
        required,
        niceToHave: niceToHave.filter((s) => s.id !== id),
      });
    }
  };

  const handleProficiency = (
    bucket: JobSkillRequirementLevel,
    id: string,
    value: number
  ) => {
    if (bucket === "required") {
      onChange({
        required: required.map((s) =>
          s.id === id ? { ...s, proficiency: value } : s
        ),
        niceToHave,
      });
    } else {
      onChange({
        required,
        niceToHave: niceToHave.map((s) =>
          s.id === id ? { ...s, proficiency: value } : s
        ),
      });
    }
  };

  const handleResync = async () => {
    if (!jobId) return;
    try {
      await syncEsco.mutateAsync(jobId);
      toast({
        title: "Skills opnieuw gemapped",
        description: "Vacature-skills zijn opnieuw gekoppeld aan ESCO.",
      });
      onResync?.();
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Re-sync mislukt.",
      });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Skill-vereisten</p>
          <p className="text-xs text-muted-foreground">
            Gekoppeld aan ESCO — kandidaten worden hier op gematcht.
          </p>
        </div>
        {jobId && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleResync}
            disabled={syncEsco.isPending}
            className="shrink-0"
          >
            {syncEsco.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Re-sync
          </Button>
        )}
      </div>

      {isLoading && <Skeleton className="h-24 w-full" />}

      <SkillBucketEditor
        title="Verplichte skills"
        skills={required}
        bucket="required"
        excludedIds={excludedIds}
        onAdd={handleAdd}
        onRemove={handleRemove}
        onProficiencyChange={handleProficiency}
      />
      <SkillBucketEditor
        title="Nice-to-haves"
        skills={niceToHave}
        bucket="nice_to_have"
        excludedIds={excludedIds}
        onAdd={handleAdd}
        onRemove={handleRemove}
        onProficiencyChange={handleProficiency}
      />
    </div>
  );
}

interface SkillBucketEditorProps {
  title: string;
  skills: ProfileSkill[];
  bucket: JobSkillRequirementLevel;
  excludedIds: Set<string>;
  onAdd: (bucket: JobSkillRequirementLevel, skill: EscoSkill) => void;
  onRemove: (bucket: JobSkillRequirementLevel, id: string) => void;
  onProficiencyChange: (
    bucket: JobSkillRequirementLevel,
    id: string,
    value: number
  ) => void;
}

function SkillBucketEditor({
  title,
  skills,
  bucket,
  excludedIds,
  onAdd,
  onRemove,
  onProficiencyChange,
}: SkillBucketEditorProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {title} ({skills.length})
      </Label>
      {skills.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          Nog geen skills toegevoegd.
        </p>
      )}
      {skills.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">
                {s.preferred_label}
              </span>
              <CategoryBadge category={s.category} />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-muted-foreground">Min</span>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={s.proficiency}
              onChange={(e) =>
                onProficiencyChange(bucket, s.id, Number(e.target.value))
              }
              className="h-1.5 w-20 accent-indigo-600"
              aria-label={`Min-niveau voor ${s.preferred_label}`}
            />
            <span className="text-xs tabular-nums w-7 text-right">
              {s.proficiency}/10
            </span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(bucket, s.id)}
            title="Verwijderen"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <EscoAutocomplete
        placeholder={`Skill toevoegen aan ${title.toLowerCase()}...`}
        excludeIds={excludedIds}
        onPick={(skill) => onAdd(bucket, skill)}
      />
    </div>
  );
}

// ─── Category filter dropdown (re-usable) ────────────────────────────────────

export interface CategoryFilterProps {
  value: EscoCategory | "all";
  onChange: (v: EscoCategory | "all") => void;
}

export function CategoryFilter({ value, onChange }: CategoryFilterProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as EscoCategory | "all")}>
      <SelectTrigger className="w-44">
        <SelectValue placeholder="Categorie" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Alle categorieën</SelectItem>
        {(Object.keys(CATEGORY_COPY) as EscoCategory[]).map((c) => (
          <SelectItem key={c} value={c}>
            {CATEGORY_COPY[c].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

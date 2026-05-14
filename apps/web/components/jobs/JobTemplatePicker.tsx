"use client";

import { useRouter } from "next/navigation";
import { Loader2, FileStack, Plus, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useJobTemplates, useInstantiateTemplate } from "@/hooks/useJobTemplates";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

interface JobTemplatePickerProps {
  /** Called with the template's job_data so the parent can pre-fill its form. */
  onPick: (jobData: Record<string, unknown>, templateId: string | null) => void;
  /**
   * When true, picking a template also navigates to the freshly-instantiated
   * job's detail page (skipping the form). Defaults to `false` — picker
   * just pre-fills the parent form.
   */
  instantiateOnPick?: boolean;
}

export function JobTemplatePicker({ onPick, instantiateOnPick = false }: JobTemplatePickerProps) {
  const { data: templates, isLoading } = useJobTemplates();
  const instantiate = useInstantiateTemplate();
  const router = useRouter();
  const { toast } = useToast();

  const handlePick = async (id: string, jobData: Record<string, unknown>) => {
    if (!instantiateOnPick) {
      onPick(jobData, id);
      return;
    }
    try {
      const job = await instantiate.mutateAsync({ templateId: id });
      toast({
        title: "Vacature aangemaakt",
        description: `"${job.title}" is op basis van template aangemaakt.`,
      });
      router.push(`/jobs/${job.id}`);
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Kon vacature niet aanmaken vanuit template.",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground">
        <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
        Templates laden...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-indigo-500" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
          Begin vanuit een template
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Empty / blank starter */}
        <button
          type="button"
          onClick={() => onPick({}, null)}
          className={cn(
            "rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700",
            "p-4 text-left transition-all hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
          )}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <Plus className="h-4 w-4 text-zinc-500" />
            </div>
            <span className="text-sm font-semibold">Lege template</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Begin met een blanco vacature en vul alle velden zelf in.
          </p>
        </button>

        {(templates ?? []).map((tmpl) => (
          <button
            key={tmpl.id}
            type="button"
            onClick={() => handlePick(tmpl.id, tmpl.job_data as Record<string, unknown>)}
            className="text-left"
          >
            <Card className="border-2 border-transparent hover:border-indigo-300 transition-all hover:shadow-md cursor-pointer h-full">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                    <FileStack className="h-4 w-4 text-white" />
                  </div>
                  <span className="text-sm font-semibold truncate">{tmpl.name}</span>
                </div>
                {tmpl.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {tmpl.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(tmpl.job_data?.department as string | undefined) && (
                    <span className="text-[10px] uppercase tracking-wide bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                      {tmpl.job_data.department as string}
                    </span>
                  )}
                  {(tmpl.job_data?.employment_type as string | undefined) && (
                    <span className="text-[10px] uppercase tracking-wide bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                      {tmpl.job_data.employment_type as string}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {instantiate.isPending && (
        <div className="text-center text-xs text-muted-foreground py-2">
          <Loader2 className="inline h-3.5 w-3.5 animate-spin mr-1.5" />
          Vacature aanmaken...
        </div>
      )}
    </div>
  );
}

/**
 * Compact "Save as template" trigger — opens a small dialog inline.
 * Used on the job-detail page next to the existing actions.
 */
export { SaveAsTemplateButton } from "./SaveAsTemplateButton";

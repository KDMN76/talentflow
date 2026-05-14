"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  useDiscardJdDraft,
  useJdDrafts,
} from "@/hooks/useJdGenerator";
import { cn } from "@/lib/utils";
import type {
  JdDraft,
  JdDraftStatus,
} from "@/lib/types/jdGenerator";

const STATUS_OPTIONS: Array<{ value: "all" | JdDraftStatus; label: string }> = [
  { value: "all", label: "Alle statussen" },
  { value: "draft", label: "Concept" },
  { value: "published", label: "Gepubliceerd" },
  { value: "discarded", label: "Verwijderd" },
];

const STATUS_BADGE: Record<
  JdDraftStatus,
  { variant: "default" | "secondary" | "success" | "destructive"; label: string }
> = {
  draft: { variant: "secondary", label: "Concept" },
  published: { variant: "success", label: "Gepubliceerd" },
  discarded: { variant: "destructive", label: "Verwijderd" },
};

export default function JdDraftsPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<"all" | JdDraftStatus>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading } = useJdDrafts({
    status,
    date_from: dateFrom || null,
    date_to: dateTo || null,
  });
  const discard = useDiscardJdDraft();

  const drafts = useMemo(() => data ?? [], [data]);

  const handleDiscard = async (id: string) => {
    if (!confirm("Weet je zeker dat je deze draft wilt verwijderen?")) return;
    try {
      await discard.mutateAsync(id);
      toast({
        title: "Draft verwijderd",
        description: "De draft is gemarkeerd als verwijderd.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Verwijderen mislukte.",
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="AI Drafts"
        description="Eerder gegenereerde vacatureteksten — kies een draft om af te maken of te publiceren."
        actions={
          <Button
            asChild
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
          >
            <Link href="/jobs/new/ai-generator">
              <Wand2 className="mr-2 h-4 w-4" />
              Nieuwe draft
            </Link>
          </Button>
        }
      />

      <Card className="border-0 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5 min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground">
                Status
              </label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as typeof status)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Vanaf
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Tot
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[160px]"
              />
            </div>
            {(status !== "all" || dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatus("all");
                  setDateFrom("");
                  setDateTo("");
                }}
              >
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : drafts.length === 0 ? (
        <EmptyState />
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/40 border-b border-border">
                <tr className="text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Datum
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Functie
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Geselecteerd
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">
                    Acties
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {drafts.map((draft) => (
                  <DraftRow
                    key={draft.id}
                    draft={draft}
                    onDiscard={() => handleDiscard(draft.id)}
                    isDiscarding={discard.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function DraftRow({
  draft,
  onDiscard,
  isDiscarding,
}: {
  draft: JdDraft;
  onDiscard: () => void;
  isDiscarding: boolean;
}) {
  const created = new Date(draft.created_at).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const selectedVariant = draft.variants.find(
    (v) => v.id === draft.selected_variant_id
  );

  return (
    <tr className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30 transition-colors">
      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
        {created}
      </td>
      <td className="px-4 py-3">
        <p className="font-semibold text-zinc-900 dark:text-zinc-100">
          {draft.role}
        </p>
        <p className="text-xs text-muted-foreground">
          {draft.variants.length} varianten · {draft.input.language}
        </p>
      </td>
      <td className="px-4 py-3">
        <Badge variant={STATUS_BADGE[draft.status].variant}>
          {STATUS_BADGE[draft.status].label}
        </Badge>
      </td>
      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
        {selectedVariant ? (
          <span className="truncate max-w-[260px] block">
            {selectedVariant.title}
          </span>
        ) : (
          <span className="text-muted-foreground italic">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {draft.status === "published" && draft.published_job_id ? (
            <Button asChild variant="ghost" size="sm" className="text-xs">
              <Link href={`/jobs/${draft.published_job_id}`}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Bekijk vacature
              </Link>
            </Button>
          ) : draft.status === "draft" ? (
            <Button asChild variant="ghost" size="sm" className="text-xs">
              <Link
                href={`/jobs/new/ai-generator?draft=${draft.id}`}
              >
                <Sparkles
                  className={cn(
                    "mr-1.5 h-3.5 w-3.5",
                    "text-purple-500"
                  )}
                />
                {draft.selected_variant_id ? "Bewerken" : "Vervolg"}
              </Link>
            </Button>
          ) : null}
          {draft.status !== "discarded" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={onDiscard}
              disabled={isDiscarding}
            >
              {isDiscarding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function EmptyState() {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="py-16 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-purple-50 dark:bg-purple-950/40 flex items-center justify-center">
          <Wand2 className="h-5 w-5 text-purple-500" />
        </div>
        <p className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Nog geen AI-drafts
        </p>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          Genereer je eerste vacaturetekst met de AI-generator. De AI maakt
          drie varianten — jij kiest, bewerkt en publiceert.
        </p>
        <Button
          asChild
          className="mt-4 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
        >
          <Link href="/jobs/new/ai-generator">
            <Plus className="mr-2 h-4 w-4" />
            Nieuwe AI-draft
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

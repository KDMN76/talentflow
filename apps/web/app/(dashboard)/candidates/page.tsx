"use client";

import { useState, useEffect } from "react";
import { Plus, UserSquare2, LayoutGrid, List, Upload } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CandidateCard } from "@/components/candidates/CandidateCard";
import { CandidateForm } from "@/components/candidates/CandidateForm";
import { BooleanSearchInput } from "@/components/candidates/BooleanSearchInput";
import { SavedSearchesDropdown } from "@/components/candidates/SavedSearchesDropdown";
import { BulkImportDialog } from "@/components/candidates/BulkImportDialog";
import { BulkActionsToolbar } from "@/components/candidates/BulkActionsToolbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useCandidates } from "@/hooks/useCandidates";
import { cn, getInitials, getScoreColor, formatRelativeDate } from "@/lib/utils";
import Link from "next/link";

const SOURCE_FILTERS = ["Alle", "LinkedIn", "Indeed", "Referral", "Behance", "Handmatig"];

export default function CandidatesPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("Alle");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: candidates, isLoading } = useCandidates(debouncedSearch || undefined);

  const filtered = candidates?.filter((c) => {
    if (sourceFilter === "Alle") return true;
    if (sourceFilter === "Handmatig") return c.source === "Manual" || c.source === "manual_import";
    return (c.source ?? "").toLowerCase() === sourceFilter.toLowerCase();
  });

  const allSelected = !!filtered && filtered.length > 0 && filtered.every((c) => selectedIds.includes(c.id));

  const toggleAll = () => {
    if (!filtered) return;
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((c) => c.id));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Kandidaten"
        description={`${candidates?.length ?? 0} kandidaten totaal`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="mr-2 h-4 w-4" />
              CSV-import
            </Button>
            <Button
              onClick={() => setDialogOpen(true)}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-sm border-0"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nieuwe kandidaat
            </Button>
          </div>
        }
      />

      {/* Search + saved searches + view toggle */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 max-w-xl">
            <BooleanSearchInput
              value={search}
              onChange={setSearch}
              onSearch={(v) => setDebouncedSearch(v)}
            />
          </div>
          <div className="flex items-center gap-2">
            <SavedSearchesDropdown
              entityType="candidates"
              onPick={(q) => {
                setSearch(q);
                setDebouncedSearch(q);
              }}
            />
            <div className="flex gap-1 p-1 bg-muted rounded-lg">
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  viewMode === "grid"
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  viewMode === "list"
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Source filter chips */}
      <div className="flex flex-wrap gap-2">
        {SOURCE_FILTERS.map((source) => (
          <button
            key={source}
            onClick={() => setSourceFilter(source)}
            className={cn(
              "inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-150 border",
              sourceFilter === source
                ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-950/50 dark:border-indigo-800 dark:text-indigo-400"
                : "bg-background border-border text-muted-foreground hover:text-foreground hover:bg-zinc-50"
            )}
          >
            {source}
          </button>
        ))}
      </div>

      {/* Bulk-actions toolbar */}
      <BulkActionsToolbar
        selectedIds={selectedIds}
        onClear={() => setSelectedIds([])}
      />

      {/* Results */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : filtered?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <UserSquare2 className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Geen kandidaten gevonden
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Pas je zoekopdracht aan of voeg een nieuwe kandidaat toe.
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered?.map((candidate) => (
            <div key={candidate.id} className="relative group">
              <input
                type="checkbox"
                checked={selectedIds.includes(candidate.id)}
                onChange={() => toggleOne(candidate.id)}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "absolute top-3 left-3 z-10 h-4 w-4 rounded accent-indigo-600 cursor-pointer transition-opacity",
                  selectedIds.includes(candidate.id)
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100"
                )}
              />
              <CandidateCard candidate={candidate} />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-white dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-zinc-50/50 dark:bg-zinc-800/50">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3">Naam</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Skills</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Bron</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Score</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Toegevoegd</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered?.map((candidate) => {
                const skills = candidate.skills ?? [];
                const isSelected = selectedIds.includes(candidate.id);
                return (
                <tr
                  key={candidate.id}
                  className={cn(
                    "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group",
                    isSelected && "bg-indigo-50/50 dark:bg-indigo-950/20"
                  )}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                      checked={isSelected}
                      onChange={() => toggleOne(candidate.id)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/candidates/${candidate.id}`} className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-semibold">
                          {getInitials(candidate.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 transition-colors">
                          {candidate.name}
                        </p>
                        <p className="text-xs text-muted-foreground">{candidate.email ?? ""}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {skills.slice(0, 2).map((s) => (
                        <Badge key={s} variant="secondary" className="text-xs font-normal">{s}</Badge>
                      ))}
                      {skills.length > 2 && <Badge variant="outline" className="text-xs">+{skills.length - 2}</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-muted-foreground">{candidate.source ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {candidate.ai_score !== null ? (
                      <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold", getScoreColor(candidate.ai_score))}>
                        {candidate.ai_score}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="text-xs text-muted-foreground">{formatRelativeDate(candidate.created_at)}</span>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New candidate dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <CandidateForm onSuccess={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Bulk import dialog */}
      <BulkImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

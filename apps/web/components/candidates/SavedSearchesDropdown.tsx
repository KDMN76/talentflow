"use client";

import { useState } from "react";
import { Bookmark, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDeleteSavedSearch, useSavedSearches } from "@/hooks/useSavedSearches";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import type { SavedSearchEntityType } from "@/lib/types/atsExtensions";

interface SavedSearchesDropdownProps {
  entityType?: SavedSearchEntityType;
  /** Called with the chosen query — typically wired to BooleanSearchInput's onChange. */
  onPick: (query: string) => void;
}

export function SavedSearchesDropdown({
  entityType = "candidates",
  onPick,
}: SavedSearchesDropdownProps) {
  const { data, isLoading } = useSavedSearches(entityType);
  const deleteSaved = useDeleteSavedSearch();
  const { toast } = useToast();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const items = data ?? [];

  const handleConfirmDelete = async () => {
    if (!confirmId) return;
    try {
      await deleteSaved.mutateAsync(confirmId);
      toast({ title: "Zoekopdracht verwijderd" });
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Kon zoekopdracht niet verwijderen.",
      });
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Bookmark className="h-3.5 w-3.5" />
            Opgeslagen
            {items.length > 0 && (
              <span className="ml-1 rounded-full bg-indigo-100 px-1.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                {items.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 p-0">
          <DropdownMenuLabel className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
            Opgeslagen zoekopdrachten
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-0" />
          {isLoading ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              <Loader2 className="inline h-3.5 w-3.5 animate-spin mr-1.5" />
              Laden...
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Nog geen opgeslagen zoekopdrachten.
              <br />
              Voer een query in en klik op &quot;Opslaan&quot;.
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {items.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "group flex items-start gap-2 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onPick(s.query)}
                    className="flex-1 text-left min-w-0"
                  >
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {s.name}
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground truncate">
                      {s.query}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmId(s.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-rose-600 p-0.5 rounded transition-all"
                    title="Verwijderen"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmId !== null} onOpenChange={(open) => !open && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Zoekopdracht verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Deze actie kan niet ongedaan worden gemaakt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Verwijderen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

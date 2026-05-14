"use client";

import { useState } from "react";
import {
  Archive,
  Tag,
  TagsIcon,
  Globe,
  X,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  useBulkAddTag,
  useBulkArchive,
  useBulkChangeSource,
  useBulkMoveToStage,
  useBulkRemoveTag,
} from "@/hooks/useBulkActions";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

const SOURCES = ["linkedin", "indeed", "referral", "career_page", "manual_import", "csv_import"];

interface BulkActionsToolbarProps {
  selectedIds: string[];
  onClear: () => void;
  /** Optional pipeline-stage list — when provided, "Verplaats naar fase" is enabled. */
  stages?: Array<{ id: string; name: string }>;
}

type ActiveAction = null | "tag-add" | "tag-remove" | "source" | "stage" | "archive";

export function BulkActionsToolbar({ selectedIds, onClear, stages }: BulkActionsToolbarProps) {
  const { toast } = useToast();
  const [active, setActive] = useState<ActiveAction>(null);
  const [tagValue, setTagValue] = useState("");
  const [sourceValue, setSourceValue] = useState("linkedin");
  const [stageValue, setStageValue] = useState<string>("");

  const archive = useBulkArchive();
  const addTag = useBulkAddTag();
  const removeTag = useBulkRemoveTag();
  const changeSource = useBulkChangeSource();
  const moveStage = useBulkMoveToStage();

  if (selectedIds.length === 0) return null;

  const handleArchive = async () => {
    try {
      const result = await archive.mutateAsync(selectedIds);
      toast({
        title: "Gearchiveerd",
        description: `${result.affected} kandida${result.affected === 1 ? "at" : "ten"} gearchiveerd.`,
      });
      setActive(null);
      onClear();
    } catch {
      toast({ variant: "destructive", title: "Fout", description: "Archiveren mislukt." });
    }
  };

  const handleAddTag = async () => {
    if (!tagValue.trim()) return;
    try {
      const result = await addTag.mutateAsync({ ids: selectedIds, tag: tagValue.trim() });
      toast({
        title: "Tag toegevoegd",
        description: `Tag "${tagValue.trim()}" toegevoegd aan ${result.affected} kandidaten.`,
      });
      setTagValue("");
      setActive(null);
      onClear();
    } catch {
      toast({ variant: "destructive", title: "Fout", description: "Tag toevoegen mislukt." });
    }
  };

  const handleRemoveTag = async () => {
    if (!tagValue.trim()) return;
    try {
      const result = await removeTag.mutateAsync({ ids: selectedIds, tag: tagValue.trim() });
      toast({
        title: "Tag verwijderd",
        description: `Tag "${tagValue.trim()}" verwijderd van ${result.affected} kandidaten.`,
      });
      setTagValue("");
      setActive(null);
      onClear();
    } catch {
      toast({ variant: "destructive", title: "Fout", description: "Tag verwijderen mislukt." });
    }
  };

  const handleChangeSource = async () => {
    try {
      const result = await changeSource.mutateAsync({ ids: selectedIds, source: sourceValue });
      toast({
        title: "Bron gewijzigd",
        description: `${result.affected} kandidaten bijgewerkt naar bron "${sourceValue}".`,
      });
      setActive(null);
      onClear();
    } catch {
      toast({ variant: "destructive", title: "Fout", description: "Bron wijzigen mislukt." });
    }
  };

  const handleMoveStage = async () => {
    if (!stageValue) return;
    try {
      const result = await moveStage.mutateAsync({ ids: selectedIds, stage_id: stageValue });
      toast({
        title: "Verplaatst",
        description: `${result.affected} kandidaten verplaatst naar nieuwe fase.`,
      });
      setStageValue("");
      setActive(null);
      onClear();
    } catch {
      toast({ variant: "destructive", title: "Fout", description: "Verplaatsen mislukt." });
    }
  };

  const isPending =
    archive.isPending ||
    addTag.isPending ||
    removeTag.isPending ||
    changeSource.isPending ||
    moveStage.isPending;

  return (
    <>
      <div className={cn(
        "sticky top-2 z-20 flex items-center justify-between gap-3 rounded-xl border border-indigo-200 dark:border-indigo-900/50",
        "bg-indigo-50/95 dark:bg-indigo-950/40 backdrop-blur px-4 py-2.5 shadow-sm"
      )}>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-7 w-7 p-0 hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
            title="Selectie opheffen"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
          <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
            {selectedIds.length} geselecteerd
          </span>
          <span className="hidden sm:inline-block h-4 w-px bg-indigo-200 dark:bg-indigo-800" />
          <div className="flex flex-wrap gap-1.5">
            {stages && stages.length > 0 && (
              <ToolbarBtn
                onClick={() => setActive("stage")}
                icon={<ChevronDown className="h-3.5 w-3.5" />}
                label="Verplaats naar fase"
              />
            )}
            <ToolbarBtn
              onClick={() => setActive("tag-add")}
              icon={<Tag className="h-3.5 w-3.5" />}
              label="Tag toevoegen"
            />
            <ToolbarBtn
              onClick={() => setActive("tag-remove")}
              icon={<TagsIcon className="h-3.5 w-3.5" />}
              label="Tag verwijderen"
            />
            <ToolbarBtn
              onClick={() => setActive("source")}
              icon={<Globe className="h-3.5 w-3.5" />}
              label="Bron wijzigen"
            />
            <ToolbarBtn
              onClick={() => setActive("archive")}
              icon={<Archive className="h-3.5 w-3.5" />}
              label="Archiveren"
              tone="rose"
            />
          </div>
        </div>
        {isPending && (
          <span className="text-xs text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Verwerken...
          </span>
        )}
      </div>

      {/* Tag-add dialog */}
      <Dialog open={active === "tag-add"} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tag toevoegen aan {selectedIds.length} kandida{selectedIds.length === 1 ? "at" : "ten"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="bulk-tag-add">Tag</Label>
            <Input
              id="bulk-tag-add"
              autoFocus
              value={tagValue}
              onChange={(e) => setTagValue(e.target.value)}
              placeholder="Bijv. high-priority"
              onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Annuleren</Button>
            </DialogClose>
            <Button onClick={handleAddTag} disabled={!tagValue.trim() || addTag.isPending} className="bg-indigo-600 hover:bg-indigo-700 border-0">
              {addTag.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Toevoegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag-remove dialog */}
      <Dialog open={active === "tag-remove"} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tag verwijderen</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="bulk-tag-rm">Tag</Label>
            <Input
              id="bulk-tag-rm"
              autoFocus
              value={tagValue}
              onChange={(e) => setTagValue(e.target.value)}
              placeholder="Bijv. high-priority"
              onKeyDown={(e) => e.key === "Enter" && handleRemoveTag()}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Annuleren</Button>
            </DialogClose>
            <Button onClick={handleRemoveTag} disabled={!tagValue.trim() || removeTag.isPending} className="bg-rose-600 hover:bg-rose-700 border-0">
              {removeTag.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verwijderen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Source dialog */}
      <Dialog open={active === "source"} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Bron wijzigen</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label>Nieuwe bron</Label>
            <Select value={sourceValue} onValueChange={setSourceValue}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Annuleren</Button>
            </DialogClose>
            <Button onClick={handleChangeSource} disabled={changeSource.isPending} className="bg-indigo-600 hover:bg-indigo-700 border-0">
              {changeSource.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Wijzigen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stage dialog */}
      <Dialog open={active === "stage"} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Verplaatsen naar fase</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label>Doel-fase</Label>
            <Select value={stageValue} onValueChange={setStageValue}>
              <SelectTrigger>
                <SelectValue placeholder="Kies fase" />
              </SelectTrigger>
              <SelectContent>
                {(stages ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Annuleren</Button>
            </DialogClose>
            <Button onClick={handleMoveStage} disabled={!stageValue || moveStage.isPending} className="bg-indigo-600 hover:bg-indigo-700 border-0">
              {moveStage.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verplaatsen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirm */}
      <AlertDialog open={active === "archive"} onOpenChange={(o) => !o && setActive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedIds.length} kandida{selectedIds.length === 1 ? "at" : "ten"} archiveren?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Gearchiveerde kandidaten verschijnen niet meer in de standaard lijst.
              Je kunt ze later herstellen via het filter &quot;Gearchiveerd&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive} className="bg-rose-600 hover:bg-rose-700">
              Archiveren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ToolbarBtn({
  onClick,
  icon,
  label,
  tone = "indigo",
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone?: "indigo" | "rose";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors border",
        tone === "rose"
          ? "border-rose-200 bg-white text-rose-700 hover:bg-rose-50 dark:bg-zinc-900 dark:border-rose-900/50 dark:text-rose-400"
          : "border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 dark:bg-zinc-900 dark:border-indigo-900/50 dark:text-indigo-300"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

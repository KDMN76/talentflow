"use client";

import { useState } from "react";
import { BookmarkPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { useCreateJobTemplate } from "@/hooks/useJobTemplates";
import { useToast } from "@/components/ui/use-toast";
import type { Job } from "@/lib/mockData";

interface SaveAsTemplateButtonProps {
  job: Job;
  /** Optional renderProp — caller can supply a custom trigger element. */
  variant?: "outline" | "ghost";
  size?: "sm" | "default";
}

/**
 * "Sla op als template" knop. Pakt de huidige vacature en snapshot't de
 * relevante velden naar een nieuwe `JobTemplate`.
 */
export function SaveAsTemplateButton({ job, variant = "outline", size = "sm" }: SaveAsTemplateButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(job.title);
  const [description, setDescription] = useState("");
  const create = useCreateJobTemplate();
  const { toast } = useToast();

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      const jobRec = job as unknown as Record<string, unknown>;
      const job_data: Record<string, unknown> = {
        title: jobRec.title,
        department: jobRec.department,
        location: jobRec.location,
        description: jobRec.description,
        employment_type: jobRec.employment_type,
        salary_min: jobRec.salary_min,
        salary_max: jobRec.salary_max,
        requirements: jobRec.requirements ?? [],
      };
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        job_data,
      });
      toast({
        title: "Template opgeslagen",
        description: `"${name.trim()}" is beschikbaar als template voor nieuwe vacatures.`,
      });
      setOpen(false);
      setName(job.title);
      setDescription("");
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Kon template niet opslaan.",
      });
    }
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} className="gap-2">
        <BookmarkPlus className="h-3.5 w-3.5" />
        Sla op als template
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vacature opslaan als template</DialogTitle>
            <DialogDescription>
              Maak een herbruikbare template van deze vacature. Velden zoals
              titel, beschrijving en vereisten worden meegenomen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="tmpl-name">Templatenaam</Label>
              <Input
                id="tmpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tmpl-desc">Omschrijving (optioneel)</Label>
              <textarea
                id="tmpl-desc"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Korte omschrijving van wanneer je deze template gebruikt..."
                className="flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Annuleren</Button>
            </DialogClose>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || create.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 border-0"
            >
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Opslaan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

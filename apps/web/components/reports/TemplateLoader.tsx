"use client";

/**
 * TemplateLoader — modal that lets users pick one of the 5 system templates.
 * Replaces the entire current config (with confirm step inside the modal).
 */

import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import type { SystemTemplate } from "@/lib/types/reports";
import { cn } from "@/lib/utils";

export interface TemplateLoaderProps {
  open: boolean;
  templates: SystemTemplate[] | undefined;
  onClose: () => void;
  onApply: (template: SystemTemplate) => void;
}

export function TemplateLoader({
  open,
  templates,
  onClose,
  onApply,
}: TemplateLoaderProps) {
  const [selected, setSelected] = useState<SystemTemplate | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSelected(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Kies een template
          </DialogTitle>
          <DialogDescription>
            Dit vervangt de huidige configuratie van het rapport.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(templates ?? []).map((tpl) => {
            const isActive = selected?.key === tpl.key;
            return (
              <button
                key={tpl.key}
                type="button"
                onClick={() => setSelected(tpl)}
                className={cn(
                  "rounded-lg border bg-white p-4 text-left transition-all hover:border-purple-300 hover:shadow-md dark:bg-zinc-950",
                  isActive
                    ? "border-purple-500 ring-2 ring-purple-500/30"
                    : "border-zinc-200 dark:border-zinc-800"
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {tpl.name}
                  </p>
                  <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
                    {tpl.config.blocks.length} blokken
                  </span>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  {tpl.description}
                </p>
                {/* Mini-preview: stack of mini-bars */}
                <div className="flex h-12 items-end gap-1">
                  {tpl.config.blocks.slice(0, 6).map((b, i) => {
                    const heightPct = 30 + ((i * 17) % 60);
                    const colors = [
                      "bg-indigo-400",
                      "bg-purple-400",
                      "bg-cyan-400",
                      "bg-emerald-400",
                      "bg-amber-400",
                      "bg-rose-400",
                    ];
                    return (
                      <div
                        key={b.id}
                        className={cn("flex-1 rounded-sm", colors[i % colors.length])}
                        style={{ height: `${heightPct}%` }}
                        title={b.block.type}
                      />
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuleren
          </Button>
          <Button
            disabled={!selected}
            onClick={() => {
              if (selected) {
                onApply(selected);
                setSelected(null);
              }
            }}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
          >
            Vervang config
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

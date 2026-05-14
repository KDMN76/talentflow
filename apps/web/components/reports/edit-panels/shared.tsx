"use client";

/**
 * Small primitives shared across edit-panels: section headings, labelled
 * fields, multi-select chips, and a single-select wrapper.
 */

import { ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function SingleSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function MultiSelectChips({
  values,
  onChange,
  options,
  emptyLabel = "Geen",
}: {
  values: string[];
  onChange: (next: string[]) => void;
  options: SelectOption[];
  emptyLabel?: string;
}) {
  const toggle = (v: string) => {
    if (values.includes(v)) onChange(values.filter((x) => x !== v));
    else onChange([...values, v]);
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.length === 0 && (
        <span className="text-[11px] text-muted-foreground">{emptyLabel}</span>
      )}
      {options.map((o) => {
        const active = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
              active
                ? "border-indigo-500 bg-indigo-500 text-white shadow-sm"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
            )}
          >
            {active ? <Check className="h-2.5 w-2.5" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function StagesEditor({
  stages,
  onChange,
}: {
  stages: string[];
  onChange: (next: string[]) => void;
}) {
  const update = (i: number, val: string) => {
    const next = [...stages];
    next[i] = val;
    onChange(next);
  };

  const remove = (i: number) => {
    onChange(stages.filter((_, idx) => idx !== i));
  };

  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...stages];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  };

  const moveDown = (i: number) => {
    if (i >= stages.length - 1) return;
    const next = [...stages];
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    onChange(next);
  };

  const add = () => onChange([...stages, `Stage ${stages.length + 1}`]);

  return (
    <div className="space-y-1.5">
      {stages.map((stage, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-5 text-[10px] tabular-nums text-muted-foreground">
            {i + 1}.
          </span>
          <input
            type="text"
            value={stage}
            onChange={(e) => update(i, e.target.value)}
            className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 dark:border-zinc-800 dark:bg-zinc-950"
          />
          <button
            type="button"
            onClick={() => moveUp(i)}
            disabled={i === 0}
            className="text-[10px] text-zinc-400 hover:text-zinc-700 disabled:opacity-30"
            aria-label="Omhoog"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => moveDown(i)}
            disabled={i >= stages.length - 1}
            className="text-[10px] text-zinc-400 hover:text-zinc-700 disabled:opacity-30"
            aria-label="Omlaag"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-zinc-400 hover:text-red-600"
            aria-label="Verwijder"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="w-full rounded-md border border-dashed border-zinc-300 py-1.5 text-[11px] text-muted-foreground hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700"
      >
        + Stage toevoegen
      </button>
    </div>
  );
}
